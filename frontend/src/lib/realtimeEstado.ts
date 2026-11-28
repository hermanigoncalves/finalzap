import { somarDias } from './datas.ts';

export type DominioUsuario = 'movimentacoes' | 'contas_a_pagar' | 'orcamentos' | 'compromissos';
export type EventoRealtime = 'INSERT' | 'UPDATE' | 'DELETE';
export type StatusDominio = 'idle' | 'loading' | 'ready' | 'error';

export interface MovimentacaoLinha {
  id: string;
  telefone: string;
  tipo: 'receita' | 'despesa';
  valor: number | string;
  categoria: string;
  descricao: string | null;
  data: string;
  mes?: string;
  fonte?: string | null;
  created_at?: string;
}

export interface ContaLinha {
  id: string;
  telefone: string;
  descricao: string;
  valor: number | string;
  categoria?: string | null;
  vencimento: string;
  status: string;
  pago_em?: string;
  movimentacao_id?: string;
}

export interface OrcamentoLinha {
  id: string;
  telefone: string;
  categoria: string;
  limite_mensal: number | string;
  mes?: string;
  created_at: string;
  updated_at: string;
}

export interface TransacaoMapeada {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  categoryId: string;
  accountId: string;
  date: string;
  mes?: string;
  fonte: 'whatsapp' | 'painel' | 'conta_paga' | 'recorrente';
  telefone?: string;
  createdAt?: string;
}

export interface ContaMapeada {
  id: string;
  description: string;
  amount: number;
  type: 'expense';
  categoryId: string;
  accountId: string;
  date: string;
  vencimento: string;
  pagoEm?: string;
  frequency: 'Mensal';
  status: 'paga' | 'cancelada' | 'pendente';
  lembreteEnviado: boolean;
  telefone?: string;
  movimentacaoId?: string;
  fonte: 'conta_paga';
}

export function aplicarEventoLista<T extends { id: string }>(
  lista: T[],
  params: { eventType: EventoRealtime; novo?: T | null; antigoId?: string | null },
  ordenar: (a: T, b: T) => number
): T[] {
  if (params.eventType === 'DELETE') {
    const id = params.antigoId;
    if (!id || !lista.some((item) => item.id === id)) return lista;
    return lista.filter((item) => item.id !== id);
  }
  const novo = params.novo;
  if (!novo?.id) return lista;
  const idx = lista.findIndex((item) => item.id === novo.id);
  const proxima = idx >= 0
    ? lista.map((item, i) => (i === idx ? novo : item))
    : [...lista, novo];
  return proxima.sort(ordenar);
}

export function compararTransacoes(
  a: { id: string; date: string; createdAt?: string },
  b: { id: string; date: string; createdAt?: string }
): number {
  return b.date.localeCompare(a.date)
    || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    || a.id.localeCompare(b.id);
}

export function compararContas(
  a: { id: string; date: string; vencimento?: string },
  b: { id: string; date: string; vencimento?: string }
): number {
  return (a.vencimento || a.date).localeCompare(b.vencimento || b.date)
    || a.id.localeCompare(b.id);
}

export function compararOrcamentos(
  a: { id: string; created_at?: string },
  b: { id: string; created_at?: string }
): number {
  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    || a.id.localeCompare(b.id);
}

export function compararCompromissos(
  a: { id: string; inicio: string },
  b: { id: string; inicio: string }
): number {
  return Date.parse(a.inicio) - Date.parse(b.inicio)
    || a.id.localeCompare(b.id);
}

export function mapearMovimentacaoLinha(
  m: MovimentacaoLinha,
  resolverCategoriaId: (nome: string, tipo?: 'income' | 'expense') => string
): TransacaoMapeada {
  const type = m.tipo === 'receita' ? 'income' : 'expense';
  return {
    id: m.id,
    description: m.descricao ?? '',
    amount: Number(m.valor),
    type,
    categoryId: resolverCategoriaId(m.categoria, type),
    accountId: 'acc_whatsapp',
    date: m.data,
    mes: m.mes,
    fonte: (m.fonte || 'whatsapp') as TransacaoMapeada['fonte'],
    telefone: m.telefone,
    createdAt: m.created_at,
  };
}

export function mapearContaLinha(
  c: ContaLinha,
  resolverCategoriaId: (nome: string, tipo?: 'income' | 'expense') => string
): ContaMapeada {
  const status = c.status === 'paga' || c.status === 'cancelada' ? c.status : 'pendente';
  return {
    id: c.id,
    description: c.descricao,
    amount: Number(c.valor),
    type: 'expense',
    categoryId: resolverCategoriaId(c.categoria || 'Contas'),
    accountId: 'acc_whatsapp',
    date: c.vencimento,
    vencimento: c.vencimento,
    pagoEm: c.pago_em,
    frequency: 'Mensal',
    status,
    lembreteEnviado: false,
    telefone: c.telefone,
    movimentacaoId: c.movimentacao_id,
    fonte: 'conta_paga',
  };
}

export function normalizarOrcamentoLinha(o: OrcamentoLinha): Omit<OrcamentoLinha, 'limite_mensal'> & { limite_mensal: number } {
  return {
    ...o,
    limite_mensal: Number(o.limite_mensal),
  };
}

export function filtrarContasVencendo<T extends { status: string; vencimento?: string; date: string }>(
  contas: readonly T[],
  dias: number,
  hoje: string
): T[] {
  const limite = somarDias(hoje, dias);
  return contas.filter((c) => {
    if (c.status !== 'pendente') return false;
    const d = (c.vencimento || c.date).slice(0, 10);
    return d >= hoje && d <= limite;
  });
}

export class ControladorCargaUnica<K extends string> {
  private status = new Map<K, StatusDominio>();
  private emAndamento = new Map<K, Promise<void>>();
  private epoca = 0;

  obterStatus(chave: K): StatusDominio {
    return this.status.get(chave) ?? 'idle';
  }

  garantir(
    chave: K,
    carregador: () => Promise<void>,
    opcoes?: { forcar?: boolean; aoMudarStatus?: (s: StatusDominio, erro: string | null) => void }
  ): Promise<void> {
    if (!opcoes?.forcar && this.obterStatus(chave) === 'ready') {
      return Promise.resolve();
    }
    const pendente = this.emAndamento.get(chave);
    if (pendente) return pendente;

    const epocaAtual = this.epoca;
    this.status.set(chave, 'loading');
    opcoes?.aoMudarStatus?.('loading', null);

    const promessa = carregador()
      .then(() => {
        if (this.epoca !== epocaAtual) return;
        this.status.set(chave, 'ready');
        opcoes?.aoMudarStatus?.('ready', null);
      })
      .catch((e: unknown) => {
        if (this.epoca !== epocaAtual) return;
        const msg = e instanceof Error ? e.message : 'Erro ao carregar dados';
        this.status.set(chave, 'error');
        opcoes?.aoMudarStatus?.('error', msg);
      })
      .finally(() => {
        if (this.epoca === epocaAtual && this.emAndamento.get(chave) === promessa) {
          this.emAndamento.delete(chave);
        }
      });

    this.emAndamento.set(chave, promessa);
    return promessa;
  }

  resetar(): void {
    this.epoca += 1;
    this.status.clear();
    this.emAndamento.clear();
  }
}
