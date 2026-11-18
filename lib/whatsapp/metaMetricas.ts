// Leitura das métricas de cobrança da WhatsApp Business (Graph API). Módulo puro.

export interface LinhaCusto {
  categoria: string;
  volume: number;
  custo: number;
}

/** Intervalo [início, fim) alinhado à meia-noite UTC, em segundos Unix. */
export function intervaloDoMes(agora: Date): { inicio: number; fim: number } {
  const inicio = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1) / 1000;
  const fim = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1) / 1000;
  return { inicio, fim };
}

export function montarUrlPricing(wabaId: string, inicio: number, fim: number, versao = 'v21.0'): string {
  const campo =
    `pricing_analytics.start(${inicio}).end(${fim}).granularity(MONTHLY)` +
    `.dimensions(["PRICING_CATEGORY"])`;
  return `https://graph.facebook.com/${versao}/${encodeURIComponent(wabaId)}?fields=${encodeURIComponent(campo)}`;
}

/** Soma os pontos de dados por categoria. Tolera formatos ausentes. */
export function lerPricingAnalytics(json: any): LinhaCusto[] {
  const blocos = Array.isArray(json?.pricing_analytics?.data) ? json.pricing_analytics.data : [];
  const porCategoria = new Map<string, LinhaCusto>();
  for (const bloco of blocos) {
    const pontos = Array.isArray(bloco?.data_points) ? bloco.data_points : [];
    for (const p of pontos) {
      const categoria = String(p?.pricing_category ?? 'DESCONHECIDA').toLowerCase();
      const atual = porCategoria.get(categoria) ?? { categoria, volume: 0, custo: 0 };
      atual.volume += Number(p?.volume) || 0;
      atual.custo += Number(p?.cost) || 0;
      porCategoria.set(categoria, atual);
    }
  }
  return [...porCategoria.values()].map((l) => ({ ...l, custo: Math.round(l.custo * 1e4) / 1e4 }));
}
