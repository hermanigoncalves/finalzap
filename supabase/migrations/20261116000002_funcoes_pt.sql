-- ============================================================
-- FINALZAP: funções (RPC) sobre o schema mestre em português
-- Origem: ../supabase/finalzap_functions.sql e finalzap_*.sql, reescritas (FIN-7 / FIN-13 S2-S5, N4-N11).
-- Idempotente. Rodar DEPOIS de 20261116000001_tabelas_pt.sql.
--
-- Segurança: todas SECURITY INVOKER com search_path fixo (a RLS vale para quem chama).
-- EXECUTE só para service_role (n8n/webhooks); `authenticated` só em marcar_conta_paga_com_despesa
-- (painel) e nas auxiliares puras que ela usa. anon e PUBLIC: nada.
-- Telefone: sempre normalizado; se já existe perfil equivalente, usa o telefone gravado nele
-- (assim a RLS por telefone_do_usuario() enxerga o que o n8n gravou). Telefone inválido/NULL
-- vira NULL e nunca casa com nada.
-- Retorno: jsonb sempre com as DUAS grafias {success, sucesso, message, mensagem, ...}: o código
-- antigo/painel lê as em português e o n8n/webhook lê as em inglês.
--
-- Estas funções são código, não dados: as versões antigas do banco real retornavam json e tinham
-- outra assinatura, então são removidas (DROP FUNCTION) antes de recriar; senão o PostgREST
-- responderia "ambíguo" por sobrecarga. Nenhuma tabela/coluna é tocada aqui.
-- ============================================================

DROP FUNCTION IF EXISTS public.registrar_movimentacao(text, text, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.definir_orcamento(text, text, numeric);
DROP FUNCTION IF EXISTS public.cadastrar_conta_a_pagar(text, text, numeric, text, date);
DROP FUNCTION IF EXISTS public.marcar_conta_paga_com_despesa(uuid, text);
DROP FUNCTION IF EXISTS public.obter_dados_usuario(text);
DROP FUNCTION IF EXISTS public.consultar_saldo_por_usuario(text);
DROP FUNCTION IF EXISTS public.filtrar_movimentacoes_periodo(text, text, text);
DROP FUNCTION IF EXISTS public.consultar_orcamento_mes(text, text, text);
DROP FUNCTION IF EXISTS public.verificar_assinatura_ativa(text);

-- ------------------------------------------------------------
-- Auxiliares
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fz_resultado(p_ok BOOLEAN, p_msg TEXT, p_extra JSONB DEFAULT '{}')
RETURNS JSONB
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object('success', p_ok, 'sucesso', p_ok, 'message', p_msg, 'mensagem', p_msg) || p_extra
$$;

CREATE OR REPLACE FUNCTION public.telefone_canonico(p_telefone TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN public.normalizar_telefone_br(p_telefone) IS NULL THEN NULL ELSE COALESCE(
    (SELECT telefone FROM public.perfis
      WHERE public.normalizar_telefone_br(telefone) = public.normalizar_telefone_br(p_telefone)
      LIMIT 1),
    public.normalizar_telefone_br(p_telefone)) END
$$;

-- ------------------------------------------------------------
-- verificar_assinatura_ativa (N4)
-- Regra definida: status 'Ativo' com data_vencimento nula conta como ativa.
-- assinaturas.telefone NULL (Hotmart sem telefone) nunca casa: NULL = NULL não é verdadeiro.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_assinatura_ativa(p_telefone TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.normalizar_telefone_br(p_telefone) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.assinaturas a
       WHERE public.normalizar_telefone_br(a.telefone) = public.normalizar_telefone_br(p_telefone)
         AND a.status = 'Ativo'
         AND (a.data_vencimento IS NULL OR a.data_vencimento > now()))
$$;

-- ------------------------------------------------------------
-- registrar_movimentacao (N6, N7)
-- Idempotente por p_idempotency_key (n8n/webhook: 'wa:<id da mensagem>[:hash]').
-- Chave repetida = success true + duplicado true (não é erro). Sem chave: sempre insere.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_movimentacao(
  p_telefone TEXT,
  p_tipo TEXT,
  p_valor NUMERIC,
  p_categoria TEXT,
  p_descricao TEXT DEFAULT NULL,
  p_data DATE DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_fonte TEXT DEFAULT 'whatsapp'
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tel TEXT := public.telefone_canonico(p_telefone);
  v_valor NUMERIC := round(p_valor, 2);
  v_key TEXT := NULLIF(btrim(p_idempotency_key), '');
  v_id UUID;
BEGIN
  IF v_tel IS NULL THEN
    RETURN public.fz_resultado(false, 'Telefone inválido.');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('receita', 'despesa') THEN
    RETURN public.fz_resultado(false, 'Tipo deve ser receita ou despesa.');
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 OR v_valor >= 10000000000 THEN
    RETURN public.fz_resultado(false, 'Valor deve ser maior que zero.');
  END IF;
  IF NULLIF(btrim(p_categoria), '') IS NULL THEN
    RETURN public.fz_resultado(false, 'Informe a categoria.');
  END IF;
  IF p_fonte IS NULL OR p_fonte NOT IN ('whatsapp', 'painel', 'recorrente', 'conta_paga') THEN
    RETURN public.fz_resultado(false, 'Fonte inválida.');
  END IF;

  INSERT INTO public.movimentacoes (telefone, tipo, valor, categoria, descricao, data, fonte, idempotency_key)
  VALUES (v_tel, p_tipo, v_valor, btrim(p_categoria), NULLIF(btrim(p_descricao), ''),
          COALESCE(p_data, (timezone('America/Sao_Paulo', now()))::date), p_fonte, v_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id; -- mes é preenchido pelo trigger a partir de data

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.movimentacoes WHERE idempotency_key = v_key;
    RETURN public.fz_resultado(true, 'Já registrado.',
      jsonb_build_object('duplicado', true, 'ja_existia', true, 'id', v_id, 'movimentacao_id', v_id));
  END IF;
  RETURN public.fz_resultado(true, 'Movimentação registrada.',
    jsonb_build_object('duplicado', false, 'ja_existia', false, 'id', v_id, 'movimentacao_id', v_id,
                       'valor', v_valor, 'tipo', p_tipo));
END;
$$;

-- ------------------------------------------------------------
-- definir_orcamento (N9): upsert por (telefone, categoria, mes); mes NULL = todos os meses
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.definir_orcamento(
  p_telefone TEXT,
  p_categoria TEXT,
  p_limite NUMERIC,
  p_mes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tel TEXT := public.telefone_canonico(p_telefone);
  v_limite NUMERIC := round(p_limite, 2);
  v_mes TEXT := NULLIF(btrim(p_mes), '');
  v_id UUID;
BEGIN
  IF v_tel IS NULL THEN
    RETURN public.fz_resultado(false, 'Telefone inválido.');
  END IF;
  IF NULLIF(btrim(p_categoria), '') IS NULL THEN
    RETURN public.fz_resultado(false, 'Informe a categoria.');
  END IF;
  IF v_limite IS NULL OR v_limite <= 0 OR v_limite >= 10000000000 THEN
    RETURN public.fz_resultado(false, 'O limite deve ser maior que zero.');
  END IF;
  IF v_mes IS NOT NULL AND v_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RETURN public.fz_resultado(false, 'Mês inválido. Use AAAA-MM.');
  END IF;

  -- Índice único NULLS NOT DISTINCT (telefone, categoria, mes): mes NULL também deduplica.
  INSERT INTO public.orcamentos (telefone, categoria, limite_mensal, mes)
  VALUES (v_tel, btrim(p_categoria), v_limite, v_mes)
  ON CONFLICT (telefone, categoria, mes)
  DO UPDATE SET limite_mensal = EXCLUDED.limite_mensal
  RETURNING id INTO v_id;

  RETURN public.fz_resultado(true, 'Orçamento definido.', jsonb_build_object(
    'orcamento_id', v_id, 'categoria', btrim(p_categoria), 'limite_mensal', v_limite, 'mes', v_mes));
END;
$$;

-- ------------------------------------------------------------
-- cadastrar_conta_a_pagar (N11): valida a data (texto do modelo) e deduplica pendente igual
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cadastrar_conta_a_pagar(
  p_telefone TEXT,
  p_descricao TEXT,
  p_valor NUMERIC,
  p_vencimento TEXT,
  p_categoria TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tel TEXT := public.telefone_canonico(p_telefone);
  v_desc TEXT := NULLIF(btrim(p_descricao), '');
  v_valor NUMERIC := round(p_valor, 2);
  v_venc DATE;
  v_id UUID;
BEGIN
  IF v_tel IS NULL THEN
    RETURN public.fz_resultado(false, 'Telefone inválido.');
  END IF;
  IF v_desc IS NULL THEN
    RETURN public.fz_resultado(false, 'Informe a descrição.');
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 OR v_valor >= 10000000000 THEN
    RETURN public.fz_resultado(false, 'Valor deve ser maior que zero.');
  END IF;
  IF p_vencimento IS NULL OR btrim(p_vencimento) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN public.fz_resultado(false, 'Data de vencimento inválida. Use AAAA-MM-DD.');
  END IF;
  BEGIN
    v_venc := btrim(p_vencimento)::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN public.fz_resultado(false, 'Data de vencimento inválida. Use AAAA-MM-DD.');
  END;

  -- Serializa chamadas iguais (agente repetindo a ferramenta) para a checagem abaixo valer.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tel || '|' || lower(v_desc) || '|' || v_venc::text || '|' || v_valor::text, 0));

  SELECT id INTO v_id FROM public.contas_a_pagar
   WHERE telefone = v_tel AND lower(descricao) = lower(v_desc)
     AND vencimento = v_venc AND valor = v_valor AND status = 'pendente'
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN public.fz_resultado(true, 'Conta já cadastrada.', jsonb_build_object('duplicado', true, 'conta_id', v_id));
  END IF;

  INSERT INTO public.contas_a_pagar (telefone, descricao, valor, vencimento, categoria, status)
  VALUES (v_tel, v_desc, v_valor, v_venc, NULLIF(btrim(p_categoria), ''), 'pendente')
  RETURNING id INTO v_id;

  RETURN public.fz_resultado(true, 'Conta cadastrada.', jsonb_build_object('duplicado', false, 'conta_id', v_id));
END;
$$;

-- ------------------------------------------------------------
-- marcar_conta_paga_com_despesa (S4)
-- INVOKER (não DEFINER): no painel a RLS garante que só o dono acha a conta (telefone passado
-- por outro usuário não encontra nada); o n8n (service_role) passa o telefone do remetente.
-- Trava a linha (FOR UPDATE), recusa cancelada, não duplica a despesa (idempotency_key por conta).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_conta_paga_com_despesa(
  p_conta_id UUID,
  p_telefone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conta public.contas_a_pagar%ROWTYPE;
  v_mov_id UUID;
  v_hoje DATE := (timezone('America/Sao_Paulo', now()))::date;
  v_key TEXT := 'conta_' || p_conta_id::text;
BEGIN
  SELECT * INTO v_conta FROM public.contas_a_pagar
   WHERE id = p_conta_id
     AND public.normalizar_telefone_br(telefone) = public.normalizar_telefone_br(p_telefone)
     AND public.normalizar_telefone_br(p_telefone) IS NOT NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.fz_resultado(false, 'Conta não encontrada.');
  ELSIF v_conta.status = 'cancelada' THEN
    RETURN public.fz_resultado(false, 'Conta cancelada não pode ser paga.');
  ELSIF v_conta.status = 'paga' THEN
    RETURN public.fz_resultado(true, 'Conta já estava paga.',
      jsonb_build_object('movimentacao_id', v_conta.movimentacao_id, 'ja_era_paga', true));
  END IF;

  INSERT INTO public.movimentacoes (telefone, tipo, valor, categoria, descricao, data, fonte, idempotency_key)
  VALUES (v_conta.telefone, 'despesa', v_conta.valor, COALESCE(v_conta.categoria, 'Contas'),
          'Conta paga: ' || v_conta.descricao, v_hoje, 'conta_paga', v_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_mov_id;
  IF v_mov_id IS NULL THEN
    SELECT id INTO v_mov_id FROM public.movimentacoes WHERE idempotency_key = v_key;
  END IF;

  UPDATE public.contas_a_pagar
     SET status = 'paga', pago_em = v_hoje, movimentacao_id = v_mov_id
   WHERE id = v_conta.id;

  RETURN public.fz_resultado(true, 'Conta marcada como paga e despesa lançada.',
    jsonb_build_object('movimentacao_id', v_mov_id, 'ja_era_paga', false));
END;
$$;

-- ------------------------------------------------------------
-- resumo_mensal (N10): totais, por categoria e orçamento x gasto do mês (AAAA-MM; padrão: mês atual em SP)
-- Orçamento do mês específico vale mais que o de mes NULL na mesma categoria.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resumo_mensal(p_telefone TEXT, p_mes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_tel TEXT := public.telefone_canonico(p_telefone);
  v_mes TEXT := COALESCE(NULLIF(btrim(p_mes), ''), to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM'));
  v_rec NUMERIC; v_desp NUMERIC; v_cat JSONB; v_orc JSONB;
BEGIN
  IF v_tel IS NULL THEN
    RETURN public.fz_resultado(false, 'Telefone inválido.');
  END IF;
  IF v_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RETURN public.fz_resultado(false, 'Mês inválido. Use AAAA-MM.');
  END IF;

  SELECT COALESCE(sum(valor) FILTER (WHERE tipo = 'receita'), 0),
         COALESCE(sum(valor) FILTER (WHERE tipo = 'despesa'), 0)
    INTO v_rec, v_desp
    FROM public.movimentacoes WHERE telefone = v_tel AND mes = v_mes;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('categoria', categoria, 'tipo', tipo, 'total', total)
                            ORDER BY tipo, total DESC), '[]')
    INTO v_cat
    FROM (SELECT categoria, tipo, sum(valor) AS total FROM public.movimentacoes
           WHERE telefone = v_tel AND mes = v_mes GROUP BY categoria, tipo) c;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'categoria', o.categoria, 'limite', o.limite_mensal, 'gasto', g.gasto,
           'restante', o.limite_mensal - g.gasto) ORDER BY o.categoria), '[]')
    INTO v_orc
    FROM (SELECT DISTINCT ON (lower(categoria)) categoria, limite_mensal
            FROM public.orcamentos
           WHERE telefone = v_tel AND (mes = v_mes OR mes IS NULL)
           ORDER BY lower(categoria), (mes IS NULL)) o
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(m.valor), 0) AS gasto FROM public.movimentacoes m
       WHERE m.telefone = v_tel AND m.mes = v_mes AND m.tipo = 'despesa'
         AND lower(m.categoria) = lower(o.categoria)) g;

  RETURN public.fz_resultado(true, 'OK', jsonb_build_object('mes', v_mes, 'moeda', 'BRL',
    'receitas', v_rec, 'despesas', v_desp, 'saldo', v_rec - v_desp,
    'por_categoria', v_cat, 'orcamentos', v_orc));
END;
$$;

-- ------------------------------------------------------------
-- saldo_total: receitas - despesas de todos os tempos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saldo_total(p_telefone TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_tel TEXT := public.telefone_canonico(p_telefone);
  v_rec NUMERIC; v_desp NUMERIC;
BEGIN
  IF v_tel IS NULL THEN
    RETURN public.fz_resultado(false, 'Telefone inválido.');
  END IF;
  SELECT COALESCE(sum(valor) FILTER (WHERE tipo = 'receita'), 0),
         COALESCE(sum(valor) FILTER (WHERE tipo = 'despesa'), 0)
    INTO v_rec, v_desp FROM public.movimentacoes WHERE telefone = v_tel;
  RETURN public.fz_resultado(true, 'OK', jsonb_build_object('moeda', 'BRL',
    'receitas', v_rec, 'despesas', v_desp, 'saldo', v_rec - v_desp));
END;
$$;

-- ------------------------------------------------------------
-- consultar_saldo_por_usuario / obter_dados_usuario / filtrar_movimentacoes_periodo
-- (reescritas sobre movimentacoes/perfis; antes liam accounts/profiles)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultar_saldo_por_usuario(p_telefone TEXT)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT s || jsonb_build_object('telefone', public.telefone_canonico(p_telefone))
  FROM (SELECT public.saldo_total(p_telefone) AS s) x
$$;

CREATE OR REPLACE FUNCTION public.obter_dados_usuario(p_telefone TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_dados JSONB;
BEGIN
  SELECT jsonb_build_object('id', id, 'nome', nome, 'email', email, 'telefone', telefone, 'role', role)
    INTO v_dados FROM public.perfis
   WHERE public.normalizar_telefone_br(telefone) = public.normalizar_telefone_br(p_telefone)
     AND public.normalizar_telefone_br(p_telefone) IS NOT NULL
   LIMIT 1;
  IF v_dados IS NULL THEN
    RETURN public.fz_resultado(false, 'Usuário não encontrado.');
  END IF;
  RETURN public.fz_resultado(true, 'OK', jsonb_build_object('dados', v_dados));
END;
$$;

CREATE OR REPLACE FUNCTION public.filtrar_movimentacoes_periodo(
  p_telefone TEXT,
  p_mes_inicial TEXT,
  p_mes_final TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.fz_resultado(true, 'OK', jsonb_build_object('total', count(*),
           'movimentacoes', COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.data DESC, m.created_at DESC), '[]')))
  FROM (SELECT * FROM public.movimentacoes
         WHERE telefone = public.telefone_canonico(p_telefone)
           AND mes >= p_mes_inicial AND (p_mes_final IS NULL OR mes <= p_mes_final)
         ORDER BY data DESC, created_at DESC LIMIT 200) m
$$;

-- ------------------------------------------------------------
-- contas_para_lembrar (N8): o que enviar hoje, agrupado por telefone.
--  - pendente, dono com assinatura ativa;
--  - vence de hoje a hoje+3: lembra no máximo 1x por dia;
--  - já vencida: lembra UMA vez só (lembrete_enviado_em nulo).
-- Depois de enviar, o n8n chama marcar_lembretes_enviados(ids).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contas_para_lembrar(p_hoje DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := COALESCE(p_hoje, (timezone('America/Sao_Paulo', now()))::date);
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('telefone', telefone, 'contas', contas) ORDER BY telefone), '[]')
    FROM (
      SELECT c.telefone,
             jsonb_agg(jsonb_build_object('id', c.id, 'descricao', c.descricao, 'valor', c.valor,
                                          'vencimento', c.vencimento) ORDER BY c.vencimento) AS contas
        FROM public.contas_a_pagar c
       WHERE c.status = 'pendente'
         AND ((c.vencimento BETWEEN v_hoje AND v_hoje + 3
               AND (c.lembrete_enviado_em IS NULL
                    OR (timezone('America/Sao_Paulo', c.lembrete_enviado_em))::date < v_hoje))
              OR (c.vencimento < v_hoje AND c.lembrete_enviado_em IS NULL))
         AND public.verificar_assinatura_ativa(c.telefone)
       GROUP BY c.telefone
    ) g);
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_lembretes_enviados(p_conta_ids UUID[])
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
  WITH ok AS (
    UPDATE public.contas_a_pagar SET lembrete_enviado_em = now()
     WHERE id = ANY(p_conta_ids) AND status = 'pendente'
    RETURNING id, telefone, vencimento),
  log AS (
    INSERT INTO public.logs_lembrete (telefone, conta_id, tipo_lembrete, status)
    SELECT telefone, id,
           CASE WHEN vencimento < (timezone('America/Sao_Paulo', now()))::date
                THEN 'conta_vencida' ELSE 'vencimento_proximo' END,
           'enviado'
      FROM ok RETURNING 1)
  SELECT count(*)::int FROM log
$$;

-- ------------------------------------------------------------
-- Permissões (o Supabase concede EXECUTE a anon/authenticated por padrão: revoga explícito)
-- ------------------------------------------------------------
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'normalizar_telefone_br(text)', 'fz_resultado(boolean,text,jsonb)', 'telefone_canonico(text)',
    'verificar_assinatura_ativa(text)',
    'registrar_movimentacao(text,text,numeric,text,text,date,text,text)',
    'definir_orcamento(text,text,numeric,text)',
    'cadastrar_conta_a_pagar(text,text,numeric,text,text)',
    'marcar_conta_paga_com_despesa(uuid,text)',
    'resumo_mensal(text,text)', 'saldo_total(text)',
    'consultar_saldo_por_usuario(text)', 'obter_dados_usuario(text)',
    'filtrar_movimentacoes_periodo(text,text,text)',
    'contas_para_lembrar(date)', 'marcar_lembretes_enviados(uuid[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Painel: o usuário logado marca a própria conta (a RLS filtra pelo dono) e precisa das auxiliares puras.
GRANT EXECUTE ON FUNCTION public.marcar_conta_paga_com_despesa(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_telefone_br(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fz_resultado(boolean, text, jsonb) TO authenticated;
