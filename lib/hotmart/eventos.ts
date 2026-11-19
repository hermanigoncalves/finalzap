// Leitura do webhook da Hotmart, mapeamento de eventos para status e calculo de vencimento.
// Modulo puro: sem imports de arquivos do projeto.

export type StatusAssinatura = 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente';

export type EventoHotmart = {
  tipo: string;
  produtoId: string;
  transacao: string;
  assinanteCodigo: string | null;
  email: string;
  nome: string;
  buyer: Record<string, unknown>;
  criadoEm: Date | null;
  proximaCobranca: Date | null;
  aprovadoEm: Date | null;
  plano: string | null;
  valor: number | null;
  moeda: string | null;
  taxa: number | null; // taxa da Hotmart sobre a venda
};

export type Efeito = { status: StatusAssinatura; enviarConvite: boolean } | null;

export const PRODUTO_ID = '8889619';
export const TOLERANCIA_DIAS = 3;

// ATENCAO: nomes de eventos (webhook v2.0.0) ainda nao confirmados com um payload real.
// Confirmar com o evento de teste da Hotmart.
const EVENTOS: Record<string, NonNullable<Efeito>> = {
  PURCHASE_APPROVED: { status: 'Ativo', enviarConvite: true },
  PURCHASE_COMPLETE: { status: 'Ativo', enviarConvite: false },
  PURCHASE_DELAYED: { status: 'Inadimplente', enviarConvite: false },
  // Compra cancelada, reembolso e chargeback: o dinheiro voltou, então o acesso acaba na hora ('Inativo').
  PURCHASE_CANCELED: { status: 'Inativo', enviarConvite: false },
  PURCHASE_REFUNDED: { status: 'Inativo', enviarConvite: false },
  PURCHASE_CHARGEBACK: { status: 'Inativo', enviarConvite: false },
  // Cliente cancelou a assinatura mensal: 'Cancelado' mantém o acesso até data_vencimento (período já pago).
  // Depois disso o acesso fecha sozinho: só uma nova compra aprovada (renovação) volta a 'Ativo'.
  SUBSCRIPTION_CANCELLATION: { status: 'Cancelado', enviarConvite: false },
};

// Caminhos conferidos com payloads reais do histórico de webhooks da Hotmart (v2.0.0, 2026-11-18):
// - PURCHASE_*: data.buyer, data.purchase.{transaction,approved_date}, data.subscription.{plan,subscriber.code}.
// - SUBSCRIPTION_CANCELLATION: NÃO tem buyer nem purchase; traz data.subscriber.{code,name,email},
//   data.subscription.{id,plan}, data.date_next_charge e data.cancellation_date.
// Cada campo lista os caminhos em ordem de preferência.
const CAMPOS = {
  tipo: [['event']],
  idEvento: [['id']],
  criadoEm: [['creation_date']],
  produtoId: [['data', 'product', 'id']],
  buyer: [['data', 'buyer'], ['data', 'subscriber']],
  email: [['data', 'buyer', 'email'], ['data', 'subscriber', 'email']],
  nome: [['data', 'buyer', 'name'], ['data', 'subscriber', 'name']],
  transacao: [['data', 'purchase', 'transaction']],
  aprovadoEm: [['data', 'purchase', 'approved_date']],
  proximaCobranca: [['data', 'purchase', 'date_next_charge'], ['data', 'date_next_charge']],
  assinanteCodigo: [['data', 'subscription', 'subscriber', 'code'], ['data', 'subscriber', 'code']],
  plano: [['data', 'subscription', 'plan', 'name']],
  // ATENÇÃO: caminhos do valor (schema v2.0.0) ainda não conferidos com um payload real de compra.
  valor: [['data', 'purchase', 'price', 'value']],
  moeda: [['data', 'purchase', 'price', 'currency_value']],
  taxa: [['data', 'purchase', 'hotmart_fee', 'total']],
} as const;

// Primeiro caminho que existir.
function obterPrimeiro(corpo: unknown, caminhos: readonly (readonly string[])[]): unknown {
  for (const c of caminhos) {
    const v = obter(corpo, c);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

export function mapearEvento(tipo: string): Efeito {
  return Object.hasOwn(EVENTOS, tipo) ? { ...EVENTOS[tipo] } : null;
}

function obter(corpo: unknown, caminho: readonly string[]): unknown {
  let atual: unknown = corpo;
  for (const chave of caminho) {
    if (typeof atual !== 'object' || atual === null) return undefined;
    atual = (atual as Record<string, unknown>)[chave];
  }
  return atual;
}

function texto(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function numero(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

// Aceita milissegundos (numero) ou texto ISO; invalida vira null.
function data(v: unknown): Date | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function lerWebhook(corpo: unknown): EventoHotmart | null {
  const produtoId = texto(obterPrimeiro(corpo, CAMPOS.produtoId));
  // Eventos de assinatura (cancelamento) não têm transação: o id do próprio evento a substitui
  // (igual nas retentativas, então a idempotência por transação:tipo continua valendo).
  const idEvento = texto(obterPrimeiro(corpo, CAMPOS.idEvento));
  const transacao =
    texto(obterPrimeiro(corpo, CAMPOS.transacao)) ?? (idEvento ? `evt-${idEvento}` : null);
  const email = texto(obterPrimeiro(corpo, CAMPOS.email))?.toLowerCase() ?? null;
  const buyer = obterPrimeiro(corpo, CAMPOS.buyer);
  if (!produtoId || !transacao || !email) return null;
  if (typeof buyer !== 'object' || buyer === null) return null;

  return {
    tipo: texto(obterPrimeiro(corpo, CAMPOS.tipo)) ?? '',
    produtoId,
    transacao,
    assinanteCodigo: texto(obterPrimeiro(corpo, CAMPOS.assinanteCodigo)),
    email,
    nome: texto(obterPrimeiro(corpo, CAMPOS.nome)) ?? '',
    buyer: buyer as Record<string, unknown>,
    criadoEm: data(obterPrimeiro(corpo, CAMPOS.criadoEm)),
    proximaCobranca: data(obterPrimeiro(corpo, CAMPOS.proximaCobranca)),
    aprovadoEm: data(obterPrimeiro(corpo, CAMPOS.aprovadoEm)),
    plano: texto(obterPrimeiro(corpo, CAMPOS.plano)),
    valor: numero(obterPrimeiro(corpo, CAMPOS.valor)),
    moeda: texto(obterPrimeiro(corpo, CAMPOS.moeda))?.toUpperCase() ?? null,
    taxa: numero(obterPrimeiro(corpo, CAMPOS.taxa)),
  };
}

// Vencimento: proxima cobranca informada; senao aprovacao + periodo do plano (1 mes, ou 12 se anual).
// Compra aprovada sem nenhuma das datas usa agora como base: null significaria acesso sem fim.
export function calcularVencimento(e: EventoHotmart, agora: Date = new Date()): Date | null {
  if (e.proximaCobranca) return e.proximaCobranca;
  const compraAprovada = e.tipo === 'PURCHASE_APPROVED' || e.tipo === 'PURCHASE_COMPLETE';
  const base = e.aprovadoEm ?? (compraAprovada ? agora : null);
  if (!base) return null;
  // Mesma regra de normalizarPlano (linhas.ts); repetida porque este modulo nao importa do projeto.
  const meses = /anual|annual|year/i.test(e.plano ?? '') ? 12 : 1;
  const v = new Date(base.getTime());
  const dia = v.getUTCDate();
  v.setUTCDate(1); // evita transbordo: 31/01 + 1 mês = 28/02, não 03/03
  v.setUTCMonth(v.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() + 1, 0)).getUTCDate();
  v.setUTCDate(Math.min(dia, ultimo));
  return v;
}
