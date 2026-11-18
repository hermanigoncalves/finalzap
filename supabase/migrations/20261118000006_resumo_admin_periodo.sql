-- Resumo do dashboard do admin para um intervalo de datas (início e fim INCLUSIVOS).
-- Mesmas regras de resumo_admin_mensal; SECURITY INVOKER: a RLS limita tudo ao admin.
DROP FUNCTION IF EXISTS public.resumo_admin_periodo(date, date);
CREATE FUNCTION public.resumo_admin_periodo(p_inicio date, p_fim date)
RETURNS TABLE (entradas numeric, qtd_entradas integer, taxas_hotmart numeric,
               custos_fixos numeric, custo_servicos_usd numeric, custo_servicos_brl numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    COALESCE(e.valor, 0), COALESCE(e.qtd, 0), COALESCE(e.taxa, 0),
    COALESCE((SELECT SUM(c.valor) FROM public.custos_fixos c
              WHERE c.status <> 'cancelado' AND c.vencimento BETWEEN p_inicio AND p_fim), 0),
    COALESCE((SELECT SUM(u.custo_usd) FROM public.uso_servico u
              WHERE u.data BETWEEN p_inicio AND p_fim), 0),
    COALESCE((SELECT SUM(u.custo_brl) FROM public.uso_servico u
              WHERE COALESCE(u.custo_usd, 0) = 0 AND u.data BETWEEN p_inicio AND p_fim), 0)
  FROM (
    SELECT SUM(x.valor) AS valor, COUNT(*)::integer AS qtd, SUM(x.taxa) AS taxa
    FROM public.entradas x
    WHERE x.moeda = 'BRL' AND x.data BETWEEN p_inicio AND p_fim
  ) e;
$$;
REVOKE ALL ON FUNCTION public.resumo_admin_periodo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_admin_periodo(date, date) TO authenticated;
