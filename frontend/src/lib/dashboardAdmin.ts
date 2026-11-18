// Cálculo do dashboard do admin. Módulo puro (sem imports) para ser testável.

export interface MesBruto {
  entradas: number;
  qtd_entradas: number;
  taxas_hotmart: number;
  custos_fixos: number;
  custo_servicos_usd: number;
  custo_servicos_brl: number;
}

export const COTACAO_PADRAO = 5.5; // usada só se a consulta da cotação falhar

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Converte serviços para reais pela cotação e fecha despesas totais e lucro líquido do mês. */
export function calcularMes(m: MesBruto, cotacao: number) {
  const servicosBrl = centavos(m.custo_servicos_usd * cotacao + m.custo_servicos_brl);
  const despesas = centavos(m.custos_fixos + servicosBrl + m.taxas_hotmart);
  return { servicosBrl, despesas, lucro: centavos(m.entradas - despesas) };
}

/** Cotação USD→BRL do dia (AwesomeAPI, gratuita e sem chave). Lança erro se indisponível. */
export async function buscarCotacaoDolar(): Promise<{ valor: number; em: Date }> {
  const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Cotação indisponível (HTTP ${r.status})`);
  const u = (await r.json())?.USDBRL;
  const valor = Number(u?.bid);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('Cotação inválida');
  const em = new Date(`${String(u.create_date).replace(' ', 'T')}-03:00`);
  return { valor, em: Number.isNaN(em.getTime()) ? new Date() : em };
}

/** Primeiro e último dia do mês de `hoje` (YYYY-MM-DD), em texto para não sofrer com fuso. */
export function limitesDoMes(hoje: string): { inicio: string; fim: string } {
  const [a, m] = hoje.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mes = hoje.slice(0, 7);
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

export type Periodo = { inicio: string; fim: string };

export const periodoValido = (p: Periodo) => !!p.inicio && !!p.fim && p.inicio <= p.fim;

/** Data (YYYY-MM-DD ou timestamp ISO) dentro do período, início e fim inclusivos. */
export const noPeriodo = (data: string | null | undefined, p: Periodo) =>
  !!data && data.slice(0, 10) >= p.inicio && data.slice(0, 10) <= p.fim;

/** Padrão de toda tela: do 1º ao último dia do mês atual. */
export const periodoMesAtual = (hoje: string): Periodo => limitesDoMes(hoje);
