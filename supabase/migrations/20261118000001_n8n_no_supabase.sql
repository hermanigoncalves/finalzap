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
