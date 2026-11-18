-- ============================================================
-- FINALZAP: schema mestre em português (tabelas, índices, triggers)
-- Origem: ../supabase/finalzap_*.sql, corrigido (FIN-7 / FIN-13 S1-S3, S6, S11, S12).
-- Idempotente e ADITIVO: CREATE ... IF NOT EXISTS + ALTER que só acrescenta ou relaxa; nada é
-- apagado. Compatível com o banco real, que já tinha estas tabelas (vazias, exceto 1 perfil admin).
-- Ordem: este arquivo -> 20261116000002_funcoes_pt.sql -> 20261116000003_hotmart.sql
--        -> 20261117000001_seguranca_rls.sql (policies).
-- Aqui a RLS é só LIGADA: sem policy, o painel não enxerga nada até a migração
-- de segurança rodar; service_role (n8n, webhooks) ignora a RLS.
--
-- Convenções de status (mantidas de propósito, o código já usa cada uma):
--   assinaturas:    Ativo | Inativo | Cancelado | Inadimplente
--   contas_a_pagar: pendente | paga | cancelada
--   custos_fixos:   pendente | pago | cancelado
-- ============================================================

-- gen_random_uuid() é nativo (PG 13+); NULLS NOT DISTINCT exige PG 15+ (Supabase atual).

-- ------------------------------------------------------------
-- Funções-base usadas por índices e triggers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Telefone canônico BR. Espelha lib/hotmart/telefone.ts: só dígitos, sem zeros de tronco, DDI 55,
-- 9º dígito acrescentado em celular de 8 dígitos (55 + DDD + [6-9]xxxxxxx). Inválido/NULL -> NULL
-- (NULL nunca casa com ninguém em comparações). IMMUTABLE para poder indexar.
CREATE OR REPLACE FUNCTION public.normalizar_telefone_br(p_telefone TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d TEXT := regexp_replace(regexp_replace(COALESCE(p_telefone, ''), '\D', '', 'g'), '^0+', '');
BEGIN
  IF length(d) IN (10, 11) THEN d := '55' || d; END IF;
  IF length(d) = 12 AND left(d, 2) = '55' AND substr(d, 5, 1) ~ '[6-9]' THEN
    d := left(d, 4) || '9' || substr(d, 5);
  END IF;
  IF length(d) IN (12, 13) AND left(d, 2) = '55' THEN RETURN d; END IF;
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- perfis: um por cliente, ligado ao login (auth.users) pelo auth_id
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.perfis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  telefone TEXT NOT NULL UNIQUE,
  nome TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perfis_auth_id ON public.perfis(auth_id);
CREATE INDEX IF NOT EXISTS idx_perfis_telefone_norm ON public.perfis(public.normalizar_telefone_br(telefone));
-- Um perfil por telefone mesmo com/sem 9º dígito (NULL = telefone inválido, não conflita).
CREATE UNIQUE INDEX IF NOT EXISTS perfis_telefone_norm_uq ON public.perfis(public.normalizar_telefone_br(telefone));

-- ------------------------------------------------------------
-- assinaturas: controle de acesso (Hotmart)
-- telefone é NULL quando o payload da Hotmart não traz telefone (NULL nunca casa com ninguém).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT,
  nome TEXT,
  email TEXT,
  hotmart_id TEXT,
  hotmart_assinante_codigo TEXT UNIQUE,
  plano TEXT DEFAULT 'Mensal' CHECK (plano IN ('Mensal', 'Anual')),
  status TEXT NOT NULL DEFAULT 'Ativo' CHECK (status IN ('Ativo', 'Inativo', 'Cancelado', 'Inadimplente')),
  data_inicio DATE,
  data_vencimento TIMESTAMPTZ,
  metodo_pagamento TEXT,
  ultimo_evento_em TIMESTAMPTZ,
  convite_enviado_em TIMESTAMPTZ,
  convite_erro TEXT,
  convite_reenviado_por UUID,
  convite_reenviado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assinaturas_telefone_norm ON public.assinaturas(public.normalizar_telefone_br(telefone)) WHERE telefone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assinaturas_status ON public.assinaturas(status);
CREATE INDEX IF NOT EXISTS idx_assinaturas_hotmart ON public.assinaturas(hotmart_id);

-- ------------------------------------------------------------
-- movimentacoes: receitas e despesas (BRL)
-- mes é calculado pelo trigger a partir de data (nunca diverge).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.movimentacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  moeda TEXT NOT NULL DEFAULT 'BRL' CHECK (moeda = 'BRL'),
  categoria TEXT NOT NULL,
  descricao TEXT,
  data DATE NOT NULL DEFAULT (timezone('America/Sao_Paulo', now()))::date,
  mes TEXT NOT NULL CHECK (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  fonte TEXT DEFAULT 'whatsapp' CHECK (fonte IN ('whatsapp', 'painel', 'recorrente', 'conta_paga')),
  idempotency_key TEXT UNIQUE, -- o UNIQUE já cria o índice; NULL pode repetir
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_telefone_mes ON public.movimentacoes(telefone, mes);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_telefone_data ON public.movimentacoes(telefone, data);

CREATE OR REPLACE FUNCTION public.movimentacoes_define_mes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.mes := to_char(NEW.data, 'YYYY-MM');
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- orcamentos: limite por categoria; mes NULL = vale para todos os meses.
-- O índice único NULLS NOT DISTINCT (PG 15+) faz o NULL contar na unicidade e mantém o
-- onConflict 'telefone, categoria, mes' do painel funcionando. (O banco real já tem 2 índices
-- parciais equivalentes; ficam, são redundantes e inofensivos.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orcamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  categoria TEXT NOT NULL,
  limite_mensal NUMERIC(12,2) NOT NULL CHECK (limite_mensal > 0),
  mes TEXT CHECK (mes IS NULL OR mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS orcamentos_telefone_categoria_mes_uq
  ON public.orcamentos (telefone, categoria, mes) NULLS NOT DISTINCT;

-- ------------------------------------------------------------
-- contas_a_pagar
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contas_a_pagar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  vencimento DATE NOT NULL,
  categoria TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CONSTRAINT contas_a_pagar_status_check CHECK (status IN ('pendente', 'paga', 'cancelada')),
  pago_em DATE,
  movimentacao_id UUID REFERENCES public.movimentacoes(id) ON DELETE SET NULL,
  lembrete_enviado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contas_telefone_status ON public.contas_a_pagar(telefone, status);
-- Varredura diária de lembretes: só as pendentes, por vencimento.
CREATE INDEX IF NOT EXISTS idx_contas_pendentes_vencimento ON public.contas_a_pagar(vencimento) WHERE status = 'pendente';

-- ------------------------------------------------------------
-- lancamentos_recorrentes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lancamentos_recorrentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL,
  frequencia TEXT NOT NULL DEFAULT 'mensal' CHECK (frequencia IN ('semanal', 'quinzenal', 'mensal', 'anual')),
  proxima_execucao DATE NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recorrentes_telefone ON public.lancamentos_recorrentes(telefone);
CREATE INDEX IF NOT EXISTS idx_recorrentes_proxima ON public.lancamentos_recorrentes(proxima_execucao) WHERE ativo;

-- ------------------------------------------------------------
-- logs_lembrete: auditoria dos lembretes enviados
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.logs_lembrete (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  conta_id UUID REFERENCES public.contas_a_pagar(id) ON DELETE CASCADE,
  tipo_lembrete TEXT NOT NULL CHECK (tipo_lembrete IN ('vencimento_proximo', 'conta_vencida', 'lembrete_personalizado', 'boas_vindas')),
  data_envio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('enviado', 'falhou', 'pendente')),
  erro TEXT,
  detalhes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_logs_telefone ON public.logs_lembrete(telefone);
CREATE INDEX IF NOT EXISTS idx_logs_conta ON public.logs_lembrete(conta_id);

-- ------------------------------------------------------------
-- uso_servico: tokens/mensagens por serviço externo (painel admin)
-- referencia: id único do evento (a Meta reenvia webhooks; não duplica a cobrança)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.uso_servico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  servico TEXT NOT NULL CHECK (servico IN ('openai', 'whatsapp', 'pluggy', 'outro')),
  modelo TEXT,
  tokens_entrada INTEGER DEFAULT 0,
  tokens_saida INTEGER DEFAULT 0,
  mensagens_enviadas INTEGER DEFAULT 0,
  mensagens_recebidas INTEGER DEFAULT 0,
  custo_usd NUMERIC(12,4) DEFAULT 0,
  custo_brl NUMERIC(12,2) DEFAULT 0,
  data DATE NOT NULL DEFAULT (timezone('America/Sao_Paulo', now()))::date,
  referencia TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.uso_servico ADD COLUMN IF NOT EXISTS referencia TEXT; -- banco real não tinha
CREATE UNIQUE INDEX IF NOT EXISTS uso_servico_referencia_uq ON public.uso_servico(referencia);
CREATE INDEX IF NOT EXISTS idx_uso_servico_telefone_data ON public.uso_servico(telefone, data);
CREATE INDEX IF NOT EXISTS idx_uso_servico_servico_data ON public.uso_servico(servico, data);

-- ------------------------------------------------------------
-- custos_fixos: custos do negócio (servidor, ferramentas, marketing...)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.custos_fixos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  categoria TEXT NOT NULL CHECK (categoria IN ('servidor', 'ferramenta', 'marketing', 'telefone', 'outro')),
  vencimento DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
  pago_em DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custos_fixos_telefone ON public.custos_fixos(telefone);
CREATE INDEX IF NOT EXISTS idx_custos_fixos_status_venc ON public.custos_fixos(status, vencimento);

-- ------------------------------------------------------------
-- hotmart_eventos: idempotência do webhook. RLS ligada e sem policy: só service_role.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hotmart_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave TEXT NOT NULL UNIQUE,
  tipo TEXT,
  transacao TEXT,
  assinante_codigo TEXT,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB
);

-- ------------------------------------------------------------
-- Ajustes aditivos em tabelas que já existiam no banco real (sem dados nelas)
-- ------------------------------------------------------------
ALTER TABLE public.contas_a_pagar ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ;
ALTER TABLE public.contas_a_pagar ALTER COLUMN categoria DROP NOT NULL;      -- relaxa, não perde dado
ALTER TABLE public.contas_a_pagar ALTER COLUMN status SET DEFAULT 'pendente';
ALTER TABLE public.movimentacoes ALTER COLUMN data SET DEFAULT (timezone('America/Sao_Paulo', now()))::date;
ALTER TABLE public.uso_servico ALTER COLUMN data SET DEFAULT (timezone('America/Sao_Paulo', now()))::date;

DO $$
BEGIN
  -- Status canônico em minúsculas. Só troca o CHECK se nenhuma linha viola o novo (senão avisa).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contas_a_pagar_status_check'
                   AND pg_get_constraintdef(oid) LIKE '%''pendente''%') THEN
    IF EXISTS (SELECT 1 FROM public.contas_a_pagar) THEN
      UPDATE public.contas_a_pagar SET status = CASE lower(status) WHEN 'pago' THEN 'paga' ELSE lower(status) END;
    END IF;
    ALTER TABLE public.contas_a_pagar DROP CONSTRAINT IF EXISTS contas_a_pagar_status_check;
    ALTER TABLE public.contas_a_pagar ADD CONSTRAINT contas_a_pagar_status_check
      CHECK (status IN ('pendente', 'paga', 'cancelada'));
  END IF;
  -- mes estrito (o antigo aceitava 2026-13); coexiste com o antigo, que não é removido.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimentacoes_mes_fmt_check') THEN
    ALTER TABLE public.movimentacoes ADD CONSTRAINT movimentacoes_mes_fmt_check
      CHECK (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;
  END IF;
END $$;

-- Aceita o status legado (Pendente/Pago/Cancelada) e grava o canônico (o BEFORE roda antes do CHECK).
CREATE OR REPLACE FUNCTION public.contas_normaliza_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status := CASE lower(NEW.status) WHEN 'pago' THEN 'paga' ELSE lower(NEW.status) END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_contas_status ON public.contas_a_pagar;
CREATE TRIGGER tr_contas_status BEFORE INSERT OR UPDATE OF status ON public.contas_a_pagar
  FOR EACH ROW EXECUTE FUNCTION public.contas_normaliza_status();

-- ------------------------------------------------------------
-- Triggers updated_at / mes (DROP + CREATE: CREATE TRIGGER não tem IF NOT EXISTS)
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['perfis', 'assinaturas', 'movimentacoes', 'orcamentos',
                           'contas_a_pagar', 'lancamentos_recorrentes', 'custos_fixos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_updated ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_updated BEFORE UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS tr_movimentacoes_mes ON public.movimentacoes;
CREATE TRIGGER tr_movimentacoes_mes BEFORE INSERT OR UPDATE OF data ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.movimentacoes_define_mes();

-- ------------------------------------------------------------
-- RLS ligada em tudo (policies: 20261117000001_seguranca_rls.sql)
-- ------------------------------------------------------------
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_a_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamentos_recorrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_lembrete ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uso_servico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custos_fixos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotmart_eventos ENABLE ROW LEVEL SECURITY;
