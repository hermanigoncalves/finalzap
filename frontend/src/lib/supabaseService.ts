// legado - fora do escopo: sem rota ativa, não importar a partir de telas ativas (usa tabelas/modelo antigos).
import { supabase } from './supabase';
import type {
  Account,
  Transaction,
  Category,
  FixedTransaction,
  Budget,
  UserSettings,
  Investment,
  SavingsGoal,
  SavingsContribution,
} from '../store/useStore';

// ─── Helpers de escrita DB ───────────────────────────────────────────────────

export const db = {
  // Profile
  saveProfile: async (userId: string, s: Partial<UserSettings>) => {
    await supabase.from('profiles').update({
      first_name: s.firstName,
      last_name: s.lastName,
      phone: s.phone,
      avatar_url: s.avatarUrl,
      n8n_webhook_url: s.n8nWebhookUrl,
      notify_low_balance: s.notifyLowBalance,
      low_balance_threshold: s.lowBalanceThreshold,
      notify_budget_alert: s.notifyBudgetAlert,
      budget_alert_percentage: s.budgetAlertPercentage,
      notify_fixed_due: s.notifyFixedDue,
      fixed_due_days: s.fixedDueDays,
    }).eq('id', userId);
  },

  // Accounts
  upsertAccount: async (userId: string, a: Account) => {
    await supabase.from('accounts').upsert({ id: a.id, user_id: userId, name: a.name, type: a.type, color: a.color });
  },
  deleteAccount: async (id: string) => {
    await supabase.from('accounts').delete().eq('id', id);
  },

  // Transactions
  insertTransaction: async (userId: string, tx: Transaction) => {
    await supabase.from('transactions').insert({
      id: tx.id,
      user_id: userId,
      account_id: tx.accountId,
      category_id: tx.categoryId,
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      date: tx.date,
    });
  },
  deleteTransaction: async (id: string) => {
    await supabase.from('transactions').delete().eq('id', id);
  },

  // Fixed Transactions
  upsertFixedTx: async (userId: string, ft: FixedTransaction) => {
    await supabase.from('fixed_transactions').upsert({
      id: ft.id,
      user_id: userId,
      account_id: ft.accountId,
      category_id: ft.categoryId,
      description: ft.description,
      amount: ft.amount,
      type: ft.type,
      day_of_month: Number(ft.date),
      frequency: ft.frequency,
      status: ft.status,
    });
  },
  toggleFixedStatus: async (id: string, status: string) => {
    await supabase.from('fixed_transactions').update({ status }).eq('id', id);
  },

  // Categories
  upsertCategory: async (userId: string, c: Category) => {
    await supabase.from('categories').upsert({ id: c.id, user_id: userId, name: c.name, type: c.type, color: c.color });
  },

  // Budgets
  upsertBudget: async (userId: string, b: Budget) => {
    await supabase.from('budgets').upsert({ user_id: userId, category_id: b.categoryId, monthly_limit: b.monthlyLimit });
  },
  deleteBudget: async (userId: string, categoryId: string) => {
    await supabase.from('budgets').delete().match({ user_id: userId, category_id: categoryId });
  },

  // Investments
  upsertInvestment: async (userId: string, inv: Investment) => {
    await supabase.from('investments').upsert({
      id: inv.id,
      user_id: userId,
      name: inv.name,
      type: inv.type,
      ticker: inv.ticker,
      amount_invested: inv.amountInvested,
      current_value: inv.currentValue,
      quantity: inv.quantity,
      purchase_price: inv.purchasePrice,
      purchase_date: inv.purchaseDate,
      color: inv.color,
    });
  },
  deleteInvestment: async (id: string) => {
    await supabase.from('investments').delete().eq('id', id);
  },

  // Savings Goals
  upsertSavingsGoal: async (userId: string, g: SavingsGoal) => {
    await supabase.from('savings_goals').upsert({
      id: g.id,
      user_id: userId,
      name: g.name,
      target_amount: g.targetAmount,
      current_amount: g.currentAmount,
      icon: g.icon,
      color: g.color,
      deadline: g.deadline,
      status: g.status,
    });
  },
  deleteSavingsGoal: async (id: string) => {
    await supabase.from('savings_goals').delete().eq('id', id);
  },

  // Savings Contributions
  insertSavingsContribution: async (userId: string, c: SavingsContribution) => {
    await supabase.from('savings_contributions').insert({
      id: c.id,
      goal_id: c.goalId,
      user_id: userId,
      amount: c.amount,
      note: c.note,
      date: c.date,
    });
  },
  deleteSavingsContribution: async (id: string) => {
    await supabase.from('savings_contributions').delete().eq('id', id);
  },
};

// Aliases para exportações diretas
export const {
  saveProfile,
  upsertAccount,
  deleteAccount,
  insertTransaction,
  deleteTransaction,
  upsertFixedTx,
  toggleFixedStatus,
  upsertCategory,
  upsertBudget,
  deleteBudget,
  upsertInvestment,
  deleteInvestment,
  upsertSavingsGoal,
  deleteSavingsGoal,
  insertSavingsContribution,
  deleteSavingsContribution,
} = db;

// ============================================================
// ─── Tipos e Queries para Tabelas FINALZAP (snake_case)
// ============================================================

export type DbAssinatura = {
  id: string;
  telefone: string;
  nome: string;
  email: string;
  hotmart_id: string;
  plano: string;
  status: string;
  data_inicio: string;
  data_vencimento: string;
  metodo_pagamento: string;
  created_at: string;
  updated_at: string;
};

export type DbMovimentacao = {
  id: string;
  telefone: string;
  tipo: 'receita' | 'despesa';
  valor: number;
  moeda: string;
  categoria: string;
  descricao: string;
  data: string;
  mes: string;
  fonte: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type DbOrcamento = {
  id: string;
  telefone: string;
  categoria: string;
  limite_mensal: number;
  mes: string;
  created_at: string;
  updated_at: string;
};

export type DbContaAPagar = {
  id: string;
  telefone: string;
  descricao: string;
  valor: number;
  categoria: string;
  vencimento: string;
  status: 'Pendente' | 'Pago' | 'Cancelada' | 'paga';
  created_at: string;
  updated_at: string;
  movimentacao_id: string;
};

export type DbLancamentoRecorrente = {
  id: string;
  telefone: string;
  tipo: 'receita' | 'despesa';
  valor: number;
  categoria: string;
  descricao: string;
  frequencia: 'semanal' | 'quinzenal' | 'mensal' | 'anual';
  proxima_execucao: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

export type DbLogLembrete = {
  id: string;
  telefone: string;
  conta_id: string;
  tipo_lembrete: 'vencimento_proximo' | 'conta_vencida' | 'lembrete_personalizado' | 'boas_vindas';
  data_envio: string;
  status: 'enviado' | 'falhou' | 'pendente';
  erro: string | null;
  detalhes: unknown;
  created_at: string;
};

// 1. Assinaturas
export const getAssinaturas = async (telefone: string) => {
  const { data, error } = await supabase
    .from('assinaturas')
    .select('*')
    .eq('telefone', telefone)
    .order('data_vencimento', { ascending: false });
  if (error) throw error;
  return data as DbAssinatura[];
};

export const getAssinaturaAtiva = async (telefone: string) => {
  const { data, error } = await supabase
    .from('assinaturas')
    .select('*')
    .eq('telefone', telefone)
    .eq('status', 'Ativo')
    .maybeSingle();
  if (error) throw error;
  return data as DbAssinatura | null;
};

// 2. Movimentacoes
export const getMovimentacoes = async (telefone: string, mes?: string) => {
  let query = supabase.from('movimentacoes').select('*').eq('telefone', telefone);
  if (mes) {
    query = query.eq('mes', mes);
  }
  const { data, error } = await query.order('data', { ascending: false });
  if (error) throw error;
  return data as DbMovimentacao[];
};

export const registrarMovimentacaoSupabase = async (
  telefone: string,
  tipo: 'receita' | 'despesa',
  valor: number,
  categoria: string,
  descricao: string,
  fonte: string = 'whatsapp'
) => {
  const { data, error } = await supabase
    .from('movimentacoes')
    .insert({
      telefone,
      tipo,
      valor,
      moeda: 'BRL',
      categoria,
      descricao,
      data: new Date().toISOString().split('T')[0],
      mes: new Date().toISOString().slice(0, 7),
      fonte,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DbMovimentacao;
};

// 3. Orçamentos
export const getOrcamentos = async (telefone: string, categoria?: string, mes?: string) => {
  let query = supabase.from('orcamentos').select('*').eq('telefone', telefone);
  if (categoria) query = query.eq('categoria', categoria);
  if (mes) query = query.eq('mes', mes);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data as DbOrcamento[];
};

export const setOrcamento = async (
  telefone: string,
  categoria: string,
  limite_mensal: number,
  mes?: string
) => {
  const { data, error } = await supabase
    .from('orcamentos')
    .upsert({ telefone, categoria, limite_mensal, mes }, { onConflict: 'telefone, categoria, mes' })
    .select()
    .single();
  if (error) throw error;
  return data as DbOrcamento;
};

// 4. Contas a Pagar
export const getContasAPagar = async (telefone: string, status?: string) => {
  let query = supabase.from('contas_a_pagar').select('*').eq('telefone', telefone);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('vencimento', { ascending: true });
  if (error) throw error;
  return data as DbContaAPagar[];
};

export const cadastrarContaAPagar = async (
  telefone: string,
  descricao: string,
  valor: number,
  categoria: string,
  vencimento: string
) => {
  const { data, error } = await supabase
    .from('contas_a_pagar')
    .insert({ telefone, descricao, valor, categoria, vencimento, status: 'Pendente' })
    .select()
    .single();
  if (error) throw error;
  return data as DbContaAPagar;
};

export const marcarContaPagaSupabase = async (contaId: string, telefone: string) => {
  const { data, error } = await supabase.rpc('marcar_conta_paga_com_despesa', {
    p_conta_id: contaId,
    p_telefone: telefone,
  });
  if (error) throw error;
  return data;
};

// 5. Lancamentos Recorrentes
export const getLancamentosRecorrentes = async (telefone: string, ativo?: boolean) => {
  let query = supabase.from('lancamentos_recorrentes').select('*').eq('telefone', telefone);
  if (ativo !== undefined) query = query.eq('ativo', ativo);
  const { data, error } = await query.order('proxima_execucao', { ascending: true });
  if (error) throw error;
  return data as DbLancamentoRecorrente[];
};

export const inserirLancamentoRecorrente = async (
  telefone: string,
  tipo: 'receita' | 'despesa',
  valor: number,
  categoria: string,
  descricao: string,
  frequencia: 'semanal' | 'quinzenal' | 'mensal' | 'anual'
) => {
  const { data, error } = await supabase
    .from('lancamentos_recorrentes')
    .insert({
      telefone,
      tipo,
      valor,
      categoria,
      descricao,
      frequencia,
      proxima_execucao: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      ativo: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DbLancamentoRecorrente;
};

// 6. Logs de Lembrete
export const getLogsLembrete = async (telefone: string) => {
  const { data, error } = await supabase
    .from('logs_lembrete')
    .select('*')
    .eq('telefone', telefone)
    .order('data_envio', { ascending: false });
  if (error) throw error;
  return data as DbLogLembrete[];
};

export const registrarLembrete = async (
  telefone: string,
  contaId: string | null,
  tipo_lembrete: DbLogLembrete['tipo_lembrete'],
  status: DbLogLembrete['status'] = 'enviado',
  erro: string | null = null,
  detalhes: unknown = null
) => {
  const { data, error } = await supabase
    .from('logs_lembrete')
    .insert({
      telefone,
      conta_id: contaId,
      tipo_lembrete,
      status,
      erro,
      detalhes,
      data_envio: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as DbLogLembrete;
};

export { supabase };
