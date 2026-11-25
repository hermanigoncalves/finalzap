-- Idempotência no cadastro de conta a pagar pelo WhatsApp: a Meta reenvia webhooks e o agente pode
-- repetir a chamada. Chave = wa:<id da mensagem>:<hash>. Nula (painel/outras origens) não restringe nada,
-- então parcelas e contas recorrentes legítimas continuam permitidas.
ALTER TABLE public.contas_a_pagar ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contas_a_pagar_idempotency_key_uq
  ON public.contas_a_pagar (idempotency_key) WHERE idempotency_key IS NOT NULL;
