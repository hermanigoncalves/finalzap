-- Permite guardar também a URL do webhook do n8n e o nome da sessão WAHA em credenciais_servico.
ALTER TABLE public.credenciais_servico DROP CONSTRAINT IF EXISTS credenciais_servico_chave_check;
ALTER TABLE public.credenciais_servico
  ADD CONSTRAINT credenciais_servico_chave_check
  CHECK (chave IN ('OPENAI_ADMIN_KEY', 'WAHA_URL', 'WAHA_API_KEY', 'WAHA_WEBHOOK_SECRET', 'WAHA_WEBHOOK_URL', 'WAHA_SESSION'));
