-- Taxa da Hotmart por venda e custo de serviços separado em USD/BRL para o dashboard do admin.
ALTER TABLE public.entradas ADD COLUMN IF NOT EXISTS taxa NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (taxa >= 0);

-- Mudou o formato de retorno: precisa recriar a função.
DROP FUNCTION IF EXISTS public.resumo_admin_mensal(integer);
-- Entradas e taxas somam só BRL. Serviços: custo_usd (convertido no painel pela cotação do dia)
-- + custo_brl só das linhas sem USD (para não contar duas vezes a mesma linha).
CREATE FUNCTION public.resumo_admin_mensal(meses integer DEFAULT 6)
RETURNS TABLE (mes text, entradas numeric, qtd_entradas integer, taxas_hotmart numeric,
               custos_fixos numeric, custo_servicos_usd numeric, custo_servicos_brl numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH m AS (
    SELECT date_trunc('month', timezone('America/Sao_Paulo', now()))::date - (i * interval '1 month') AS ini
    FROM generate_series(0, GREATEST(LEAST(meses, 24), 1) - 1) AS i
  )
  SELECT to_char(m.ini, 'YYYY-MM'),
    COALESCE(e.valor, 0), COALESCE(e.qtd, 0), COALESCE(e.taxa, 0),
    COALESCE((SELECT SUM(c.valor) FROM public.custos_fixos c
              WHERE c.status <> 'cancelado' AND c.vencimento >= m.ini AND c.vencimento < m.ini + interval '1 month'), 0),
    COALESCE((SELECT SUM(u.custo_usd) FROM public.uso_servico u
              WHERE u.data >= m.ini AND u.data < m.ini + interval '1 month'), 0),
    COALESCE((SELECT SUM(u.custo_brl) FROM public.uso_servico u
              WHERE COALESCE(u.custo_usd, 0) = 0 AND u.data >= m.ini AND u.data < m.ini + interval '1 month'), 0)
  FROM m
  LEFT JOIN LATERAL (
    SELECT SUM(x.valor) AS valor, COUNT(*)::integer AS qtd, SUM(x.taxa) AS taxa
    FROM public.entradas x
    WHERE x.moeda = 'BRL' AND x.data >= m.ini AND x.data < m.ini + interval '1 month'
  ) e ON TRUE
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.resumo_admin_mensal(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_admin_mensal(integer) TO authenticated;
