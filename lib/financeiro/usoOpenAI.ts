// Custo de uso da OpenAI. Módulo puro (sem imports) para ser testável.
// Preços em USD por 1 milhão de tokens. Confira em platform.openai.com/docs/pricing.

export interface PrecoModelo {
  entrada: number;
  saida: number;
}

export const PRECOS_OPENAI: Record<string, PrecoModelo> = {
  'gpt-4o-mini': { entrada: 0.15, saida: 0.6 },
  'gpt-4o': { entrada: 2.5, saida: 10 },
  'gpt-4.1-mini': { entrada: 0.4, saida: 1.6 },
  'gpt-4.1': { entrada: 2, saida: 8 },
};

export interface UsoOpenAI {
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
  custoBrl: number;
}

/** Cotação do dólar em reais (env USD_BRL; padrão 5,50). */
export function cotacaoDolar(valorEnv: string | undefined = undefined): number {
  const n = Number(valorEnv);
  return Number.isFinite(n) && n > 0 ? n : 5.5;
}

export function calcularUsoOpenAI(
  modelo: string,
  tokensEntrada: number,
  tokensSaida: number,
  cotacao: number
): UsoOpenAI {
  const entrada = Math.max(0, Math.trunc(tokensEntrada) || 0);
  const saida = Math.max(0, Math.trunc(tokensSaida) || 0);
  const preco = PRECOS_OPENAI[modelo];
  const custoUsd = preco ? (entrada * preco.entrada + saida * preco.saida) / 1_000_000 : 0;
  return {
    modelo,
    tokensEntrada: entrada,
    tokensSaida: saida,
    custoUsd: Math.round(custoUsd * 1e6) / 1e6,
    custoBrl: Math.round(custoUsd * cotacao * 1e4) / 1e4,
  };
}
