-- Idempotência no cadastro de lançamento recorrente pelo WhatsApp (onboarding do primeiro acesso):
-- a Meta reenvia webhooks e o agente pode repetir a chamada. Chave = wa:<id da mensagem>:<hash>.
-- Nula (painel) não restringe nada.
ALTER TABLE public.lancamentos_recorrentes ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_recorrentes_idempotency_key_uq
  ON public.lancamentos_recorrentes (idempotency_key) WHERE idempotency_key IS NOT NULL;
