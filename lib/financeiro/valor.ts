// Extrai o valor em reais de uma frase informal (parser offline). Sem imports: testável sem rede.

/** Converte "1.500,00", "1500.50", "12,5" ou "3.200" (milhar) em número. */
export function parseNumeroBR(s: string): number {
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
  return parseFloat(s);
}

/**
 * Devolve o valor ou null se a frase não tem um (nunca inventa um valor padrão).
 * Prefere "R$ x" ou "x reais"; ignora números de data ("dia 5", "05/11").
 */
export function extrairValor(texto: string): number | null {
  const re = /(R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*reais)?/gi;
  const candidatos: { n: number; forte: boolean }[] = [];
  for (const m of texto.matchAll(re)) {
    const ini = m.index ?? 0;
    const antes = texto.slice(Math.max(0, ini - 5), ini).toLowerCase();
    const depois = texto.slice(ini + m[0].length, ini + m[0].length + 1);
    const forte = Boolean(m[1] || m[3]);
    if (!forte && (/dia\s*$/.test(antes) || depois === '/' || antes.endsWith('/'))) continue;
    const n = parseNumeroBR(m[2]);
    if (Number.isFinite(n) && n > 0) candidatos.push({ n, forte });
  }
  return (candidatos.find((c) => c.forte) ?? candidatos[0])?.n ?? null;
}
