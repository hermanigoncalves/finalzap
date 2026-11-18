-- Credenciais de serviços externos (Meta, OpenAI) cadastradas pelo painel admin.
-- RLS ligada e SEM policies: só a chave de serviço (API do servidor) lê/escreve; o navegador nunca vê o valor.
CREATE TABLE IF NOT EXISTS public.credenciais_servico (
  chave TEXT PRIMARY KEY CHECK (chave IN ('META_ACCESS_TOKEN', 'META_WABA_ID', 'OPENAI_ADMIN_KEY')),
  valor TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.credenciais_servico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credenciais_servico FROM anon, authenticated;
