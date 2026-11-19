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
