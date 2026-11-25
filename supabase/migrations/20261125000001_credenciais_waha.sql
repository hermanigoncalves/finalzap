-- Permite guardar a conexão com o WAHA (URL e chave) em credenciais_servico. Não apaga dados.
ALTER TABLE public.credenciais_servico DROP CONSTRAINT IF EXISTS credenciais_servico_chave_check;
ALTER TABLE public.credenciais_servico
  ADD CONSTRAINT credenciais_servico_chave_check
  CHECK (chave IN ('META_ACCESS_TOKEN', 'META_WABA_ID', 'OPENAI_ADMIN_KEY', 'WAHA_URL', 'WAHA_API_KEY'));
