import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Orcamento, PerfilUsuario } from '../lib/financeService';
import type { Compromisso } from '../features/agenda';

export type AccountType = 'Conta Corrente' | 'Conta Poupança' | 'Cartão de Crédito' | 'Dinheiro' | 'Conta PJ';
export type TransactionType = 'income' | 'expense';
export type FixedFrequency = 'Mensal' | 'Anual' | 'Semanal';
export type FixedStatus = 'active' | 'paused' | 'pendente' | 'paga' | 'cancelada';
export type InvestmentType = 'Ações' | 'FII' | 'Tesouro Direto' | 'CDB/LCI/LCA' | 'Cripto' | 'Outros';
export type SavingsGoalStatus = 'active' | 'completed' | 'paused';

export interface CreditCard {
  id: string;
  name: string;
  limit: number;
  availableLimit: number;
  closingDay: number;
  dueDay: number;
  network: string;
  color: string;
}

export interface UserSettings {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl: string;
  n8nWebhookUrl: string;
  notifyLowBalance: boolean;
  lowBalanceThreshold: number;
  notifyBudgetAlert: boolean;
  budgetAlertPercentage: number;
  notifyFixedDue: boolean;
  fixedDueDays: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  color: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  accountId: string;
  date: string;
  mes?: string;
  fonte: 'whatsapp' | 'painel' | 'conta_paga' | 'recorrente';
  telefone?: string;
  createdAt?: string;
}

export interface FixedTransaction {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  accountId: string;
  date: string;
  vencimento?: string;
  pagoEm?: string;
  frequency: FixedFrequency;
  status: FixedStatus;
  lembreteEnviado?: boolean;
  telefone?: string;
  movimentacaoId?: string;
  fonte?: 'whatsapp' | 'painel' | 'conta_paga' | 'recorrente';
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  color: string;
}

export interface Investment {
  id: string;
  name: string;
  type: InvestmentType;
  ticker?: string;
  amountInvested: number;
  currentValue: number;
  quantity?: number;
  purchasePrice?: number;
  purchaseDate: string;
  color: string;
}

export interface Budget {
  categoryId: string;
  monthlyLimit: number;
  telefone?: string;
  mes?: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  icon: string;
  color: string;
  deadline?: string;
  status: SavingsGoalStatus;
}

export interface SavingsContribution {
  id: string;
  goalId: string;
  amount: number;
  note?: string;
  date: string;
}

interface AppState {
  accounts: Account[];
  transactions: Transaction[];
  fixedTransactions: FixedTransaction[];
  orcamentos: Orcamento[];
  compromissos: Compromisso[];
  perfil: PerfilUsuario | null;
  categories: Category[];
  investments: Investment[];
  savingsGoals: SavingsGoal[];
  savingsContributions: SavingsContribution[];
  userSettings: UserSettings;
  creditCards: CreditCard[];

  addCreditCard: (card: CreditCard) => void;
  updateCreditCard: (id: string, updates: Partial<Omit<CreditCard, 'id'>>) => void;
  deleteCreditCard: (id: string) => void;

  addAccount: (acc: Account) => void;
  updateAccount: (id: string, updates: Partial<Omit<Account, 'id'>>) => void;
  deleteAccount: (id: string) => void;

  addTransaction: (tx: Omit<Transaction, 'id'>) => void;
  deleteTransaction: (id: string) => void;

  addFixedTransaction: (ft: Omit<FixedTransaction, 'id'>) => void;
  toggleFixedStatus: (id: string) => void;
  marcarContaPaga: (id: string) => void;

  addInvestment: (inv: Omit<Investment, 'id'>) => void;
  updateInvestment: (id: string, updates: Partial<Omit<Investment, 'id'>>) => void;
  deleteInvestment: (id: string) => void;

  addSavingsGoal: (goal: Omit<SavingsGoal, 'id' | 'currentAmount'>) => void;
  updateSavingsGoal: (id: string, updates: Partial<Omit<SavingsGoal, 'id'>>) => void;
  deleteSavingsGoal: (id: string) => void;

  addSavingsContribution: (contribution: Omit<SavingsContribution, 'id'>) => void;
  deleteSavingsContribution: (id: string) => void;

  updateSettings: (updates: Partial<UserSettings>) => void;
}

const defaultCategories: Category[] = [
  { id: 'cat_1', name: 'Alimentação',  type: 'expense', color: 'bg-orange-500' },
  { id: 'cat_2', name: 'Transporte',   type: 'expense', color: 'bg-blue-500'   },
  { id: 'cat_3', name: 'Moradia',      type: 'expense', color: 'bg-purple-500' },
  { id: 'cat_4', name: 'Saúde',        type: 'expense', color: 'bg-red-500'    },
  { id: 'cat_5', name: 'Salário',      type: 'income',  color: 'bg-green-500'  },
  { id: 'cat_6', name: 'Serviços',     type: 'expense', color: 'bg-slate-500'  },
  { id: 'cat_7', name: 'Software',     type: 'expense', color: 'bg-indigo-500' },
  { id: 'cat_8', name: 'Educação',     type: 'expense', color: 'bg-cyan-500'   },
  { id: 'cat_9', name: 'Lazer',        type: 'expense', color: 'bg-pink-500'   },
  { id: 'cat_10', name: 'Compras',     type: 'expense', color: 'bg-amber-500'  },
  { id: 'cat_11', name: 'Contas',      type: 'expense', color: 'bg-yellow-600' },
  { id: 'cat_12', name: 'Outros',      type: 'expense', color: 'bg-gray-500'   },
  { id: 'cat_13', name: 'Freelance',   type: 'income',  color: 'bg-emerald-500'},
  { id: 'cat_14', name: 'Vendas',      type: 'income',  color: 'bg-teal-500'   },
  { id: 'cat_15', name: 'Outros',      type: 'income',  color: 'bg-lime-500'   },
];

export const sampleDemoData = {
  accounts: [
    { id: 'acc_1', name: 'Conta Principal', type: 'Conta Corrente' as AccountType, balance: 2500.0, color: 'bg-slate-800' },
    { id: 'acc_2', name: 'Reserva Emergência', type: 'Conta Poupança' as AccountType, balance: 10000.0, color: 'bg-emerald-600' },
  ],
  transactions: [
    { id: 'tx_1', description: 'Supermercado', amount: 350.0, type: 'expense' as TransactionType, categoryId: 'cat_1', accountId: 'acc_1', date: new Date().toISOString() },
  ],
};

const initialAccounts: Account[] = [];
const initialTransactions: Transaction[] = [];
const initialInvestments: Investment[] = [];

const updateBalance = (accounts: Account[], accountId: string, amount: number, type: TransactionType, reverse = false): Account[] =>
  accounts.map(acc => {
    if (acc.id !== accountId) return acc;
    const delta = type === 'income' ? amount : -amount;
    return { ...acc, balance: acc.balance + (reverse ? -delta : delta) };
  });

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      accounts: initialAccounts,
      transactions: initialTransactions,
      categories: defaultCategories,
      investments: initialInvestments,
      savingsGoals: [],
      savingsContributions: [],
      userSettings: {
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        avatarUrl: '',
        n8nWebhookUrl: '',
        notifyLowBalance: true,
        lowBalanceThreshold: 500,
        notifyBudgetAlert: true,
        budgetAlertPercentage: 80,
        notifyFixedDue: true,
        fixedDueDays: 5,
      },
      fixedTransactions: [],
      orcamentos: [],
      compromissos: [],
      perfil: null,
      creditCards: [],

      addCreditCard: (card) => set((s) => ({ creditCards: [...s.creditCards, card] })),
      updateCreditCard: (id, updates) => set((s) => ({ creditCards: s.creditCards.map(c => c.id === id ? { ...c, ...updates } : c) })),
      deleteCreditCard: (id) => set((s) => ({ creditCards: s.creditCards.filter(c => c.id !== id) })),

      addAccount: (acc) =>
        set((s) => ({ accounts: [...s.accounts, acc] })),

      updateAccount: (id, updates) =>
        set((s) => ({ accounts: s.accounts.map(a => a.id === id ? { ...a, ...updates } : a) })),

      deleteAccount: (id) =>
        set((s) => ({
          accounts: s.accounts.filter(a => a.id !== id),
          transactions: s.transactions.filter(t => t.accountId !== id),
          fixedTransactions: s.fixedTransactions.filter(ft => ft.accountId !== id),
        })),

      addTransaction: (tx) =>
        set((s) => ({
          transactions: [{ ...tx, id: uuidv4(), fonte: tx.fonte || 'painel' }, ...s.transactions],
          accounts: updateBalance(s.accounts, tx.accountId, tx.amount, tx.type),
        })),

      deleteTransaction: (id) =>
        set((s) => {
          const tx = s.transactions.find(t => t.id === id);
          if (!tx) return s;
          return {
            transactions: s.transactions.filter(t => t.id !== id),
            accounts: updateBalance(s.accounts, tx.accountId, tx.amount, tx.type, true),
          };
        }),

      addFixedTransaction: (ft) =>
        set((s) => ({ fixedTransactions: [...s.fixedTransactions, { ...ft, id: uuidv4() }] })),

      toggleFixedStatus: (id) =>
        set((s) => ({
          fixedTransactions: s.fixedTransactions.map(ft =>
            ft.id === id ? { ...ft, status: ft.status === 'active' ? 'paused' : 'active' } : ft
          ),
        })),

      marcarContaPaga: (id) =>
        set((s) => {
          const conta = s.fixedTransactions.find(ft => ft.id === id);
          if (!conta || conta.status === 'paga') return s;
          const today = new Date().toISOString().split('T')[0];
          const newTx: Transaction = {
            id: uuidv4(),
            description: conta.description,
            amount: conta.amount,
            type: 'expense',
            categoryId: conta.categoryId,
            accountId: conta.accountId || (s.accounts[0]?.id ?? 'acc_principal'),
            date: today,
            fonte: 'conta_paga',
          };
          return {
            fixedTransactions: s.fixedTransactions.map(ft =>
              ft.id === id ? { ...ft, status: 'paga' as FixedStatus, pagoEm: today } : ft
            ),
            transactions: [newTx, ...s.transactions],
            accounts: s.accounts.length > 0 ? updateBalance(s.accounts, newTx.accountId, newTx.amount, 'expense') : s.accounts,
          };
        }),

      addInvestment: (inv) =>
        set((s) => ({ investments: [...s.investments, { ...inv, id: uuidv4() }] })),

      updateInvestment: (id, updates) =>
        set((s) => ({ investments: s.investments.map(i => i.id === id ? { ...i, ...updates } : i) })),

      deleteInvestment: (id) =>
        set((s) => ({ investments: s.investments.filter(i => i.id !== id) })),

      addSavingsGoal: (goal) =>
        set((s) => ({ savingsGoals: [...s.savingsGoals, { ...goal, id: uuidv4(), currentAmount: 0 }] })),
      
      updateSavingsGoal: (id, updates) =>
        set((s) => ({ savingsGoals: s.savingsGoals.map(g => g.id === id ? { ...g, ...updates } : g) })),
      
      deleteSavingsGoal: (id) =>
        set((s) => ({
          savingsGoals: s.savingsGoals.filter(g => g.id !== id),
          savingsContributions: s.savingsContributions.filter(c => c.goalId !== id),
        })),

      addSavingsContribution: (contribution) =>
        set((s) => {
          const newContribution = { ...contribution, id: uuidv4() };
          return {
            savingsContributions: [...s.savingsContributions, newContribution],
            savingsGoals: s.savingsGoals.map(g => 
              g.id === contribution.goalId 
                ? { ...g, currentAmount: g.currentAmount + contribution.amount }
                : g
            ),
          };
        }),
      
      deleteSavingsContribution: (id) =>
        set((s) => {
          const contribution = s.savingsContributions.find(c => c.id === id);
          if (!contribution) return s;
          return {
            savingsContributions: s.savingsContributions.filter(c => c.id !== id),
            savingsGoals: s.savingsGoals.map(g => 
              g.id === contribution.goalId 
                ? { ...g, currentAmount: g.currentAmount - contribution.amount }
                : g
            ),
          };
        }),

      updateSettings: (updates) =>
        set((s) => ({ userSettings: { ...s.userSettings, ...updates } })),
    }),
    {
      name: 'finance-store',
      partialize: (s) => ({
        userSettings: s.userSettings,
      }),
      version: 2,
      migrate: (salvo) => {
        const s = { ...(salvo as Record<string, unknown>) };
        delete s.accounts;
        delete s.investments;
        delete s.savingsGoals;
        delete s.savingsContributions;
        delete s.creditCards;
        delete s.transactions;
        delete s.fixedTransactions;
        delete s.categories;
        return s as unknown as AppState;
      },
    }
  )
);
