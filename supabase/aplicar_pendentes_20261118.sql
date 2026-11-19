-- ===== migrations/20261118000001_n8n_no_supabase.sql =====
-- ============================================================
-- FINALZAP: suporte ao nó nativo do Supabase no n8n (create/get/getAll/update/delete em tabelas/views).
-- O nó não chama RPC nem faz upsert, então a regra de negócio sai das RPCs e vai para triggers/views.
-- Aditivo e reexecutável. Rodar depois de 20261117000001_seguranca_rls.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Telefone canônico em INSERT direto (o nó grava o que o agente mandar: com/sem 9º dígito).
-- Lenient: telefone inválido é mantido como veio (as RPCs é que o rejeitam).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tr_canoniza_telefone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.telefone := COALESCE(public.telefone_canonico(NEW.telefone), NEW.telefone);
  RETURN NEW;
END;
$$;

-- Roda no contexto de quem insere (authenticated no painel): precisa de EXECUTE.
GRANT EXECUTE ON FUNCTION public.telefone_canonico(text) TO authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['movimentacoes', 'contas_a_pagar', 'orcamentos', 'lancamentos_recorrentes', 'logs_lembrete'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_telefone ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_telefone BEFORE INSERT ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.tr_canoniza_telefone()', t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. Pagar conta = UPDATE contas_a_pagar SET status='paga' (nó n8n "update").
-- BEFORE UPDATE: lança a despesa, preenche pago_em e movimentacao_id na própria linha.
-- Mesma idempotency_key da RPC marcar_conta_paga_com_despesa ('conta_'||id): nunca duplica.
-- Nome com "z" para rodar DEPOIS de tr_contas_status (que normaliza Pago -> paga).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tr_conta_paga_lanca_despesa()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := (timezone('America/Sao_Paulo', now()))::date;
  v_key TEXT := 'conta_' || NEW.id::text;
  v_mov UUID;
BEGIN
  IF NEW.status = 'paga' AND OLD.status IS DISTINCT FROM 'paga' THEN
    IF OLD.status = 'cancelada' THEN
      RAISE EXCEPTION 'Conta cancelada não pode ser paga.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.movimentacoes (telefone, tipo, valor, categoria, descricao, data, fonte, idempotency_key)
    VALUES (NEW.telefone, 'despesa', NEW.valor, COALESCE(NEW.categoria, 'Contas'),
            'Conta paga: ' || NEW.descricao, v_hoje, 'conta_paga', v_key)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_mov;
    IF v_mov IS NULL THEN
      SELECT id INTO v_mov FROM public.movimentacoes WHERE idempotency_key = v_key;
    END IF;

    NEW.pago_em := COALESCE(NEW.pago_em, v_hoje);
    NEW.movimentacao_id := v_mov;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_contas_zpaga ON public.contas_a_pagar;
CREATE TRIGGER tr_contas_zpaga BEFORE UPDATE ON public.contas_a_pagar
  FOR EACH ROW EXECUTE FUNCTION public.tr_conta_paga_lanca_despesa();

-- ------------------------------------------------------------
-- 3. Views para leitura pelo nó (getAll com filtro telefone/mes). Só service_role.
-- security_invoker: a RLS das tabelas vale para quem consulta.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_resumo_mensal WITH (security_invoker = true) AS
  SELECT telefone, mes, tipo, categoria, sum(valor) AS total, count(*)::int AS qtd
    FROM public.movimentacoes
   GROUP BY telefone, mes, tipo, categoria;

CREATE OR REPLACE VIEW public.vw_saldo WITH (security_invoker = true) AS
  SELECT telefone,
         COALESCE(sum(valor) FILTER (WHERE tipo = 'receita'), 0) AS receitas,
         COALESCE(sum(valor) FILTER (WHERE tipo = 'despesa'), 0) AS despesas,
         COALESCE(sum(valor) FILTER (WHERE tipo = 'receita'), 0)
           - COALESCE(sum(valor) FILTER (WHERE tipo = 'despesa'), 0) AS saldo
    FROM public.movimentacoes
   GROUP BY telefone;

REVOKE ALL ON public.vw_resumo_mensal, public.vw_saldo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_resumo_mensal, public.vw_saldo TO service_role;

-- ------------------------------------------------------------
-- 4. Grants das tabelas usadas pelo fluxo: service_role lê/insere/atualiza; anon nada
-- (nenhuma policy dá linha a anon; tira também o privilégio). authenticated segue só pela RLS.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.movimentacoes, public.contas_a_pagar, public.orcamentos,
  public.assinaturas, public.perfis, public.logs_lembrete, public.uso_servico TO service_role;
REVOKE ALL ON public.movimentacoes, public.contas_a_pagar, public.orcamentos, public.assinaturas,
  public.perfis, public.logs_lembrete, public.uso_servico, public.lancamentos_recorrentes,
  public.custos_fixos, public.hotmart_eventos FROM anon;

-- ===== migrations/20261118000002_correcoes_qa.sql =====
-- ============================================================
-- FINALZAP: correções do QA de 2026-11-18. Aditiva e reexecutável.
-- Rodar depois de 20261118000001_n8n_no_supabase.sql.
-- ============================================================

-- 1. Custo de IA/Meta por chamada é fração de centavo: NUMERIC(12,2) arredondava para 0.
ALTER TABLE public.uso_servico
  ALTER COLUMN custo_usd TYPE NUMERIC(14,6),
  ALTER COLUMN custo_brl TYPE NUMERIC(14,6);

-- 2. Telefone canônico também em assinaturas e perfis (o n8n busca por igualdade exata).
-- tr_canoniza_telefone mantém o valor original quando o telefone é inválido ou NULL.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['assinaturas', 'perfis'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_telefone ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_telefone BEFORE INSERT OR UPDATE OF telefone ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.tr_canoniza_telefone()', t, t);
  END LOOP;
END $$;

-- 3. Pagamento reversível e consistente (B8).
-- a) Voltar a conta de 'paga' para outro status remove a despesa gerada e limpa o vínculo.
-- b) Apagar a despesa gerada por uma conta paga devolve a conta para 'pendente'.
CREATE OR REPLACE FUNCTION public.tr_conta_paga_lanca_despesa()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := (timezone('America/Sao_Paulo', now()))::date;
  v_key TEXT := 'conta_' || NEW.id::text;
  v_mov UUID;
BEGIN
  IF NEW.status = 'paga' AND OLD.status IS DISTINCT FROM 'paga' THEN
    IF OLD.status = 'cancelada' THEN
      RAISE EXCEPTION 'Conta cancelada não pode ser paga.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.movimentacoes (telefone, tipo, valor, categoria, descricao, data, fonte, idempotency_key)
    VALUES (NEW.telefone, 'despesa', NEW.valor, COALESCE(NEW.categoria, 'Contas'),
            'Conta paga: ' || NEW.descricao, v_hoje, 'conta_paga', v_key)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_mov;
    IF v_mov IS NULL THEN
      SELECT id INTO v_mov FROM public.movimentacoes WHERE idempotency_key = v_key;
    END IF;

    NEW.pago_em := COALESCE(NEW.pago_em, v_hoje);
    NEW.movimentacao_id := v_mov;
  ELSIF OLD.status = 'paga' AND NEW.status IS DISTINCT FROM 'paga' THEN
    NEW.pago_em := NULL;
    NEW.movimentacao_id := NULL; -- a despesa é removida no gatilho AFTER (não dá para apagar a linha referenciada aqui)
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tr_conta_despagar_remove_despesa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'paga' AND NEW.status IS DISTINCT FROM 'paga' THEN
    DELETE FROM public.movimentacoes
     WHERE idempotency_key = 'conta_' || OLD.id::text AND fonte = 'conta_paga';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tr_despesa_apagada_reabre_conta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- casa pela chave (não por movimentacao_id): a FK ON DELETE SET NULL pode rodar antes deste gatilho
  UPDATE public.contas_a_pagar
     SET status = 'pendente'
   WHERE 'conta_' || id::text = OLD.idempotency_key AND status = 'paga';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tr_conta_despagar_remove_despesa(), public.tr_despesa_apagada_reabre_conta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_contas_zdespaga ON public.contas_a_pagar;
CREATE TRIGGER tr_contas_zdespaga AFTER UPDATE ON public.contas_a_pagar
  FOR EACH ROW WHEN (OLD.status = 'paga' AND NEW.status IS DISTINCT FROM 'paga')
  EXECUTE FUNCTION public.tr_conta_despagar_remove_despesa();

DROP TRIGGER IF EXISTS tr_movimentacoes_reabre_conta ON public.movimentacoes;
CREATE TRIGGER tr_movimentacoes_reabre_conta AFTER DELETE ON public.movimentacoes
  FOR EACH ROW WHEN (OLD.fonte = 'conta_paga')
  EXECUTE FUNCTION public.tr_despesa_apagada_reabre_conta();

-- 4. Acesso do plano mensal: vale até o fim do período pago e fecha sozinho se não houver renovação.
--   'Ativo'     : vencimento nulo (sem data conhecida) ou futuro.
--   'Cancelado' : cliente cancelou a assinatura, mas o período pago continua: exige vencimento futuro.
--   'Inativo' (reembolso/chargeback) e 'Inadimplente': sem acesso.
-- Renovação = novo evento de compra aprovada, que volta a 'Ativo' com o novo vencimento.
CREATE OR REPLACE FUNCTION public.verificar_assinatura_ativa(p_telefone TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.normalizar_telefone_br(p_telefone) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.assinaturas a
       WHERE public.normalizar_telefone_br(a.telefone) = public.normalizar_telefone_br(p_telefone)
         AND ((a.status = 'Ativo' AND (a.data_vencimento IS NULL OR a.data_vencimento > now()))
              OR (a.status = 'Cancelado' AND a.data_vencimento > now())))
$$;

-- 5. Login com Google (ou outro provedor) de quem já comprou.
-- O convite da Hotmart cria o perfil ligado ao usuário do convite. Se o cliente entra depois com o Google
-- (mesmo e-mail), o Supabase pode substituir o usuário e o perfil fica órfão (auth_id NULL, pela FK SET NULL).
-- Esta função religa SÓ perfis órfãos, SÓ por e-mail já verificado (nunca troca o dono de um perfil existente).
CREATE OR REPLACE FUNCTION public.vincular_perfil_por_email()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_confirmado BOOLEAN;
  v_perfil UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_uid) THEN RETURN TRUE; END IF;

  SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO v_email, v_confirmado
    FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR NOT v_confirmado THEN RETURN FALSE; END IF;

  SELECT p.id INTO v_perfil FROM public.perfis p
   WHERE lower(p.email) = v_email AND p.auth_id IS NULL
   ORDER BY p.created_at LIMIT 1;
  IF v_perfil IS NULL THEN RETURN FALSE; END IF;

  UPDATE public.perfis SET auth_id = v_uid WHERE id = v_perfil AND auth_id IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_perfil_por_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_perfil_por_email() TO authenticated;

-- ===== migrations/20261118000003_credenciais_servico.sql =====
-- Credenciais de serviços externos (Meta, OpenAI) cadastradas pelo painel admin.
-- RLS ligada e SEM policies: só a chave de serviço (API do servidor) lê/escreve; o navegador nunca vê o valor.
CREATE TABLE IF NOT EXISTS public.credenciais_servico (
  chave TEXT PRIMARY KEY CHECK (chave IN ('META_ACCESS_TOKEN', 'META_WABA_ID', 'OPENAI_ADMIN_KEY')),
  valor TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credenciais_servico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credenciais_servico FROM anon, authenticated;

-- ===== migrations/20261118000004_entradas_dashboard_admin.sql =====
-- Entradas (vendas reais da Hotmart) e resumo mensal para o dashboard do admin.

-- Uma linha por transação aprovada. Gravada só pelo webhook (chave de serviço);
-- reembolso/chargeback/cancelamento apagam a linha (o dinheiro voltou).
CREATE TABLE IF NOT EXISTS public.entradas (
  transacao TEXT PRIMARY KEY,
  assinante_codigo TEXT,
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  moeda TEXT NOT NULL DEFAULT 'BRL',
  data DATE NOT NULL DEFAULT (timezone('America/Sao_Paulo', now()))::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entradas_data ON public.entradas(data);

ALTER TABLE public.entradas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.entradas FROM anon, authenticated;
GRANT SELECT ON public.entradas TO authenticated;
DROP POLICY IF EXISTS entradas_admin_select ON public.entradas;
CREATE POLICY entradas_admin_select ON public.entradas FOR SELECT TO authenticated
  USING ((SELECT public.eh_admin()));

-- Resumo dos últimos N meses (mês atual incluído). SECURITY INVOKER: a RLS das tabelas
-- já limita tudo ao admin. Entradas somam só BRL (outras moedas não se misturam com reais).
-- Custos = custos fixos não cancelados (por vencimento) + custo de uso dos serviços (OpenAI etc.).
DROP FUNCTION IF EXISTS public.resumo_admin_mensal(integer);
CREATE FUNCTION public.resumo_admin_mensal(meses integer DEFAULT 6)
RETURNS TABLE (mes text, entradas numeric, qtd_entradas integer, custos_fixos numeric, custo_servicos numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH m AS (
    SELECT date_trunc('month', timezone('America/Sao_Paulo', now()))::date - (i * interval '1 month') AS ini
    FROM generate_series(0, GREATEST(LEAST(meses, 24), 1) - 1) AS i
  )
  SELECT to_char(m.ini, 'YYYY-MM'),
    COALESCE((SELECT SUM(e.valor) FROM public.entradas e
              WHERE e.moeda = 'BRL' AND e.data >= m.ini AND e.data < m.ini + interval '1 month'), 0),
    (SELECT COUNT(*)::integer FROM public.entradas e
     WHERE e.moeda = 'BRL' AND e.data >= m.ini AND e.data < m.ini + interval '1 month'),
    COALESCE((SELECT SUM(c.valor) FROM public.custos_fixos c
              WHERE c.status <> 'cancelado' AND c.vencimento >= m.ini AND c.vencimento < m.ini + interval '1 month'), 0),
    COALESCE((SELECT SUM(u.custo_brl) FROM public.uso_servico u
              WHERE u.data >= m.ini AND u.data < m.ini + interval '1 month'), 0)
  FROM m ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.resumo_admin_mensal(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_admin_mensal(integer) TO authenticated;

-- ===== migrations/20261118000005_taxas_hotmart_custos_usd.sql =====
-- Taxa da Hotmart por venda e custo de serviços separado em USD/BRL para o dashboard do admin.
ALTER TABLE public.entradas ADD COLUMN IF NOT EXISTS taxa NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (taxa >= 0);

-- Mudou o formato de retorno: precisa recriar a função.
DROP FUNCTION IF EXISTS public.resumo_admin_mensal(integer);
-- Entradas e taxas somam só BRL. Serviços: custo_usd (convertido no painel pela cotação do dia)
-- + custo_brl só das linhas sem USD (para não contar duas vezes a mesma linha).
CREATE FUNCTION public.resumo_admin_mensal(meses integer DEFAULT 6)
RETURNS TABLE (mes text, entradas numeric, qtd_entradas integer, taxas_hotmart numeric,
               custos_fixos numeric, custo_servicos_usd numeric, custo_servicos_brl numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH m AS (
    SELECT date_trunc('month', timezone('America/Sao_Paulo', now()))::date - (i * interval '1 month') AS ini
    FROM generate_series(0, GREATEST(LEAST(meses, 24), 1) - 1) AS i
  )
  SELECT to_char(m.ini, 'YYYY-MM'),
    COALESCE(e.valor, 0), COALESCE(e.qtd, 0), COALESCE(e.taxa, 0),
    COALESCE((SELECT SUM(c.valor) FROM public.custos_fixos c
              WHERE c.status <> 'cancelado' AND c.vencimento >= m.ini AND c.vencimento < m.ini + interval '1 month'), 0),
    COALESCE((SELECT SUM(u.custo_usd) FROM public.uso_servico u
              WHERE u.data >= m.ini AND u.data < m.ini + interval '1 month'), 0),
    COALESCE((SELECT SUM(u.custo_brl) FROM public.uso_servico u
              WHERE COALESCE(u.custo_usd, 0) = 0 AND u.data >= m.ini AND u.data < m.ini + interval '1 month'), 0)
  FROM m
  LEFT JOIN LATERAL (
    SELECT SUM(x.valor) AS valor, COUNT(*)::integer AS qtd, SUM(x.taxa) AS taxa
    FROM public.entradas x
    WHERE x.moeda = 'BRL' AND x.data >= m.ini AND x.data < m.ini + interval '1 month'
  ) e ON TRUE
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.resumo_admin_mensal(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_admin_mensal(integer) TO authenticated;

-- ===== migrations/20261118000006_resumo_admin_periodo.sql =====
-- Resumo do dashboard do admin para um intervalo de datas (início e fim INCLUSIVOS).
-- Mesmas regras de resumo_admin_mensal; SECURITY INVOKER: a RLS limita tudo ao admin.
DROP FUNCTION IF EXISTS public.resumo_admin_periodo(date, date);
CREATE FUNCTION public.resumo_admin_periodo(p_inicio date, p_fim date)
RETURNS TABLE (entradas numeric, qtd_entradas integer, taxas_hotmart numeric,
               custos_fixos numeric, custo_servicos_usd numeric, custo_servicos_brl numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    COALESCE(e.valor, 0), COALESCE(e.qtd, 0), COALESCE(e.taxa, 0),
    COALESCE((SELECT SUM(c.valor) FROM public.custos_fixos c
              WHERE c.status <> 'cancelado' AND c.vencimento BETWEEN p_inicio AND p_fim), 0),
    COALESCE((SELECT SUM(u.custo_usd) FROM public.uso_servico u
              WHERE u.data BETWEEN p_inicio AND p_fim), 0),
    COALESCE((SELECT SUM(u.custo_brl) FROM public.uso_servico u
              WHERE COALESCE(u.custo_usd, 0) = 0 AND u.data BETWEEN p_inicio AND p_fim), 0)
  FROM (
    SELECT SUM(x.valor) AS valor, COUNT(*)::integer AS qtd, SUM(x.taxa) AS taxa
    FROM public.entradas x
    WHERE x.moeda = 'BRL' AND x.data BETWEEN p_inicio AND p_fim
  ) e;
$$;
REVOKE ALL ON FUNCTION public.resumo_admin_periodo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_admin_periodo(date, date) TO authenticated;


-- ===== migrations/20261118000007_handle_new_user_definer.sql =====
-- No banco, handle_new_user perdeu o SECURITY DEFINER: o gatilho roda como o usuário interno do Auth,
-- que não grava em profiles (RLS sem regra de INSERT), e todo cadastro novo (Google ou e-mail) falha
-- com "Database error saving new user". Restaura a definição original da migração 20260311000001.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Só o gatilho chama esta função.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ===== migrations/20261119000001_endurece_funcoes_indices.sql =====
-- ============================================================
-- FINALZAP: endurecimento de funções legadas, dono no gatilho de reabrir conta e índices do n8n/admin.
-- Aditiva e reexecutável. Rodar depois de 20261118000007_handle_new_user_definer.sql.
-- ============================================================

-- 1. [SEC-5] Funções SECURITY DEFINER do modelo legado (202603* / schema.sql) sem search_path e
-- executáveis por anon. Nenhuma é RPC do cliente (frontend/lib não chamam): só gatilhos e seed.sql.
-- Só mexe nas que existem (o banco limpo do DEPLOY.md não tem o modelo legado).
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.seed_default_categories(uuid)',
    'public.update_account_balance()',
    'public.update_savings_goal_amount()',
    'public.handle_new_profile()'
  ] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', f);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    END IF;
  END LOOP;
END $$;

-- 2. [SEC-7] Apagar a despesa de conta paga só reabre a conta do mesmo dono (telefone canônico nas duas tabelas).
CREATE OR REPLACE FUNCTION public.tr_despesa_apagada_reabre_conta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- casa pela chave (não por movimentacao_id): a FK ON DELETE SET NULL pode rodar antes deste gatilho
  UPDATE public.contas_a_pagar
     SET status = 'pendente'
   WHERE 'conta_' || id::text = OLD.idempotency_key
     AND telefone = OLD.telefone
     AND status = 'paga';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tr_despesa_apagada_reabre_conta() FROM PUBLIC, anon, authenticated;

-- 3. [PERF-6] Painel admin soma custo por período (resumo_admin_*), sem filtro de telefone/serviço.
CREATE INDEX IF NOT EXISTS idx_uso_servico_data ON public.uso_servico (data) INCLUDE (custo_usd, custo_brl);

-- 4. [PERF-7] O n8n filtra assinaturas por telefone = '...' (igualdade); o índice existente é funcional.
CREATE INDEX IF NOT EXISTS idx_assinaturas_telefone ON public.assinaturas (telefone) WHERE telefone IS NOT NULL;

-- ===== migrations/20261119000002_chave_conta_do_dono.sql =====
-- ============================================================
-- FINALZAP: a chave conta_<id> em movimentacoes só pode ser usada pelo dono da conta.
-- Sem isto, o usuário B grava antes uma movimentação com idempotency_key = 'conta_<id da conta de A>'
-- (UNIQUE global); quando A paga, o ON CONFLICT DO NOTHING reaproveita a linha de B e a despesa
-- de A não entra no extrato de A. Vale para todos os caminhos: painel (RLS), n8n (service_role),
-- RPC marcar_conta_paga_com_despesa e gatilho tr_conta_paga_lanca_despesa.
-- Aditiva e reexecutável. Rodar depois de 20261119000001_endurece_funcoes_indices.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tr_valida_chave_conta()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.idempotency_key LIKE 'conta\_%' AND NOT EXISTS (
       SELECT 1 FROM public.contas_a_pagar c
        WHERE c.id::text = substr(NEW.idempotency_key, 7)
          AND c.telefone = NEW.telefone
     ) THEN
    RAISE EXCEPTION 'Chave conta_<id> só pode ser usada pelo dono da conta.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Nome ordena depois de tr_movimentacoes_telefone: o telefone já chega canônico aqui.
DROP TRIGGER IF EXISTS tr_movimentacoes_valida_chave_conta ON public.movimentacoes;
CREATE TRIGGER tr_movimentacoes_valida_chave_conta
  BEFORE INSERT OR UPDATE OF idempotency_key, telefone ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public.tr_valida_chave_conta();

REVOKE EXECUTE ON FUNCTION public.tr_valida_chave_conta() FROM PUBLIC, anon;

-- ===== migrations/20261119000003_vinculo_whatsapp.sql =====
-- ============================================================
-- FINALZAP: vínculo do WhatsApp por código (compra sem telefone na Hotmart).
-- O cliente entra no painel (e-mail confirmado), gera um código de uso único e o envia, DO PRÓPRIO
-- WhatsApp, para o número do FinalZap. O n8n chama vincular_whatsapp com o número de quem enviou
-- (verificado pela Meta) e o código; o banco cria o perfil e grava o telefone na assinatura.
-- Aditiva e reexecutável. Rodar depois de 20261119000002_chave_conta_do_dono.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vinculos_whatsapp (
  codigo TEXT PRIMARY KEY,
  auth_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vinculos_whatsapp_auth ON public.vinculos_whatsapp (auth_id);

-- Só as funções abaixo (SECURITY DEFINER) mexem na tabela: RLS ligada, sem policy e sem grants.
ALTER TABLE public.vinculos_whatsapp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vinculos_whatsapp FROM PUBLIC, anon, authenticated;

-- 1. Painel: gera (ou reaproveita) o código do usuário logado. Só quem tem assinatura para o e-mail confirmado.
CREATE OR REPLACE FUNCTION public.gerar_codigo_vinculo()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_confirmado BOOLEAN;
  v_codigo TEXT;
  v_expira TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN public.fz_resultado(false, 'Faça login para continuar.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_uid) THEN
    RETURN public.fz_resultado(true, 'Sua conta já está vinculada.', jsonb_build_object('ja_vinculado', true));
  END IF;

  SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO v_email, v_confirmado
    FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR NOT v_confirmado THEN
    RETURN public.fz_resultado(false, 'Confirme o seu e-mail para continuar.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assinaturas a
                  WHERE lower(a.email) = v_email AND a.status IN ('Ativo', 'Cancelado')) THEN
    RETURN public.fz_resultado(false, 'Não encontramos uma assinatura para este e-mail. Entre com o e-mail usado na compra.');
  END IF;

  SELECT v.codigo, v.expira_em INTO v_codigo, v_expira
    FROM public.vinculos_whatsapp v
   WHERE v.auth_id = v_uid AND v.usado_em IS NULL AND v.expira_em > now()
   ORDER BY v.created_at DESC LIMIT 1;

  IF v_codigo IS NULL THEN
    DELETE FROM public.vinculos_whatsapp WHERE auth_id = v_uid AND usado_em IS NULL;
    v_codigo := 'FZ-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)); -- 32 bits: inviável de adivinhar em 30 min
    v_expira := now() + interval '30 minutes';
    INSERT INTO public.vinculos_whatsapp (codigo, auth_id, expira_em) VALUES (v_codigo, v_uid, v_expira);
  END IF;

  RETURN public.fz_resultado(true, 'Código gerado.', jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira));
END;
$$;

-- 2. n8n (service_role): consome o código com o telefone de quem enviou a mensagem.
CREATE OR REPLACE FUNCTION public.vincular_whatsapp(p_telefone TEXT, p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tel TEXT := public.normalizar_telefone_br(p_telefone);
  v_cod TEXT := upper(btrim(COALESCE(p_codigo, '')));
  v_vinculo public.vinculos_whatsapp%ROWTYPE;
  v_email TEXT;
  v_ass public.assinaturas%ROWTYPE;
BEGIN
  IF v_tel IS NULL THEN
    RETURN public.fz_resultado(false, 'Telefone inválido.');
  END IF;

  SELECT * INTO v_vinculo FROM public.vinculos_whatsapp
   WHERE codigo = v_cod AND usado_em IS NULL AND expira_em > now() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.fz_resultado(false, 'Código inválido ou expirado. Gere um novo no painel do FinalZap.');
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_vinculo.auth_id;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_vinculo.auth_id) THEN
    UPDATE public.vinculos_whatsapp SET usado_em = now() WHERE codigo = v_cod;
    RETURN public.fz_resultado(false, 'Esta conta já está vinculada a um WhatsApp.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE public.normalizar_telefone_br(telefone) = v_tel) THEN
    RETURN public.fz_resultado(false, 'Este WhatsApp já está vinculado a outra conta. Fale com o suporte.');
  END IF;

  SELECT * INTO v_ass FROM public.assinaturas
   WHERE lower(email) = v_email AND status IN ('Ativo', 'Cancelado')
   ORDER BY ultimo_evento_em DESC NULLS LAST, created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN public.fz_resultado(false, 'Não encontramos uma assinatura para esta conta.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.assinaturas
              WHERE public.normalizar_telefone_br(telefone) = v_tel AND lower(email) <> v_email) THEN
    RETURN public.fz_resultado(false, 'Este WhatsApp já está ligado a outra assinatura. Fale com o suporte.');
  END IF;

  INSERT INTO public.perfis (auth_id, telefone, nome, email, role)
  VALUES (v_vinculo.auth_id, v_tel, v_ass.nome, v_email, 'user');

  UPDATE public.assinaturas SET telefone = v_tel, convite_erro = NULL
   WHERE lower(email) = v_email AND telefone IS NULL;
  UPDATE public.vinculos_whatsapp SET usado_em = now() WHERE codigo = v_cod;

  RETURN public.fz_resultado(true,
    'WhatsApp vinculado! ✅ Agora é só me mandar seus gastos por aqui. Exemplo: "gastei 25 no almoço".');
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_codigo_vinculo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_codigo_vinculo() TO authenticated;
REVOKE ALL ON FUNCTION public.vincular_whatsapp(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_whatsapp(text, text) TO service_role;
