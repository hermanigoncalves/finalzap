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
