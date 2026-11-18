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
