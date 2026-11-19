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
