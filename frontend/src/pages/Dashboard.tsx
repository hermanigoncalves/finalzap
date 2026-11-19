import { Card, CardContent, CardHeader, CardTitle, Button, Modal } from '../components/ui';
import type { ContaAPagar } from '../lib/financeService';
import { Link } from 'react-router-dom';
import { useStore, type TransactionType } from '../store/useStore';
import { lazy, Suspense, useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '../utils/formatters';
import { ArrowDownRight, ArrowUpRight, Wallet, ArrowRight, Plus, MessageCircle } from 'lucide-react';
import { useFinance } from '../hooks/useFinance';
import { paraTipoMovimentacao } from '../lib/tipos';
import { hojeISO, mesAtual as mesAtualSP, somarMeses } from '../lib/datas';
import { nomeDaCategoria } from '../lib/categorias';

const GraficoFluxoCaixa = lazy(() => import('../components/GraficoFluxoCaixa'));

export default function Dashboard() {
  const { transactions, categories } = useStore();
  const {
    loading,
    error,
    lista_contas_vencendo,
    registrar_movimentacao,
  } = useFinance();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [contasVencendo, setContasVencendo] = useState<ContaAPagar[]>([]);

  // Saldo e resumo do mês saem do histórico que o useFinance já carregou; só as contas do dia vêm do banco aqui.
  const carregarResumo = async () => {
    setContasVencendo(await lista_contas_vencendo(0));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial; carregarResumo é recriada a cada render
  useEffect(() => { void carregarResumo(); }, []);

  const mesAtual = mesAtualSP();

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando || !desc || !amount || !catId || !date) return;

    setEnviando(true);
    const resultado = await registrar_movimentacao({
      tipo: paraTipoMovimentacao(type),
      valor: parseFloat(amount.replace(',', '.')),
      categoria: catId,
      descricao: desc,
      data: date,
    }).finally(() => setEnviando(false));

    if (!resultado.sucesso) {
      alert(resultado.mensagem);
      return;
    }

    setIsModalOpen(false);
    setDesc('');
    setAmount('');
    setDate(hojeISO());
    await carregarResumo();
  };

  // Form states
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [catId, setCatId] = useState('');
  const [date, setDate] = useState(hojeISO());

  // tx.date é YYYY-MM-DD: compara como texto (new Date() leria como UTC e recuaria um dia)
  const currentMonthTransactions = transactions.filter((tx) => tx.date.slice(0, 7) === mesAtual);

  const monthlyIncome = currentMonthTransactions
    .filter((t) => t.type === 'income')
    .reduce((acc, t) => acc + t.amount, 0);
  const monthlyExpenses = currentMonthTransactions
    .filter((t) => t.type === 'expense')
    .reduce((acc, t) => acc + t.amount, 0);

  const contasVencendoHoje = contasVencendo.reduce((acc, c) => acc + c.valor, 0);

  const recentTransactions = transactions.slice(0, 5);

  const monthlyTotals = new Map<string, { income: number; expense: number }>();
  transactions.forEach((tx) => {
    const key = tx.date.slice(0, 7);
    const totals = monthlyTotals.get(key) ?? { income: 0, expense: 0 };
    totals[tx.type] += tx.amount;
    monthlyTotals.set(key, totals);
  });
  const cashFlowData = Array.from({ length: 6 }, (_, index) => {
    const key = somarMeses(mesAtual, index - 5);
    const totals = monthlyTotals.get(key) ?? { income: 0, expense: 0 };
    return {
      month: new Date(`${key}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }),
      income: totals.income,
      expense: totals.expense,
    };
  });

  const saldoTotal = transactions.reduce((acc, t) => acc + (t.type === 'income' ? t.amount : -t.amount), 0);
  const resumoExibicao = {
    mes: mesAtual,
    totalReceitas: monthlyIncome,
    totalDespesas: monthlyExpenses,
    saldo: monthlyIncome - monthlyExpenses,
  };

  const summaryData = [
    {
      title: 'Saldo Total',
      value: formatCurrency(saldoTotal),
      icon: Wallet,
      color: 'text-slate-900 dark:text-white',
    },
    {
      title: 'Total de Entradas',
      value: formatCurrency(resumoExibicao.totalReceitas),
      icon: ArrowUpRight,
      color: 'text-green-600 dark:text-green-400',
    },
    {
      title: 'Total de Saídas',
      value: formatCurrency(resumoExibicao.totalDespesas),
      icon: ArrowDownRight,
      color: 'text-red-500 dark:text-red-400',
    },
    {
      title: 'Contas a Pagar Vencendo Hoje',
      value: formatCurrency(contasVencendoHoje),
      icon: ArrowDownRight,
      color: 'text-orange-600 dark:text-orange-400',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Visão geral</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Resumo de {resumoExibicao.mes} — receitas, despesas e saldo reunidos em um só lugar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus size={18} className="mr-2" />
            Registrar movimentação
          </Button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {summaryData.map((item) => (
          <Card key={item.title} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b-0 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {item.title}
              </CardTitle>
              <div className={`p-2 bg-slate-100 dark:bg-slate-800 rounded-lg ${item.color}`}>
                <item.icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{item.value}</div>
              <p className="text-xs mt-2 text-slate-500">{resumoExibicao.mes}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Feed "Últimos Lançamentos via WhatsApp" (Função 1) */}
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-slate-100/50 dark:border-slate-800/50">
          <CardTitle className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
            <MessageCircle size={18} className="text-green-500" />
            Últimos Lançamentos via WhatsApp
          </CardTitle>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {transactions.filter((t) => t.fonte === 'whatsapp').length} lançamentos recentes
          </div>
        </CardHeader>
        <CardContent className="h-40 overflow-y-auto space-y-2">
          {transactions
            .filter((t) => t.fonte === 'whatsapp')
            .slice(0, 5)
            .map((tx) => (
              <div
                key={tx.id}
                className={`p-3 rounded bg-white/50 dark:bg-slate-800/50 flex items-center gap-3 ${
                  tx.type === 'expense' ? 'border-red-200/50' : 'border-green-200/50'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                  tx.type === 'expense' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                }`}>
                  {tx.type === 'expense' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white line-clamp-1">{tx.description}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                    {tx.telefone || '—'} | {tx.type === 'expense' ? '-' : '+'} {formatCurrency(tx.amount)}
                  </p>
                </div>
              </div>
            ))}
          {transactions.filter((t) => t.fonte === 'whatsapp').length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center pt-4">
              Nenhum lançamento via WhatsApp ainda.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Receitas e despesas chart */}
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Card className="min-h-[400px] flex flex-col hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle>Receitas e despesas</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">Movimentações dos últimos seis meses.</p>
          </CardHeader>
          <CardContent className="flex-1 min-h-[280px] pt-2">
            {transactions.length === 0 ? (
              <div className="flex h-full min-h-[260px] items-center justify-center text-center text-sm text-slate-400">
                Registre uma movimentação para visualizar seu histórico.
              </div>
            ) : (
              <Suspense fallback={<div className="h-[280px]" />}>
                <GraficoFluxoCaixa data={cashFlowData} />
              </Suspense>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <CardTitle>Atividade Recente</CardTitle>
            <Link to="/transactions" className="text-sm text-green-600 hover:text-green-700 dark:text-green-400 font-medium flex items-center group">
              Ver tudo
              <ArrowRight size={14} className="ml-1 group-hover:translate-x-1 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentTransactions.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <p className="font-medium">Nenhuma transação ainda</p>
                  <p className="text-xs mt-1">Registre sua primeira movimentação para começar.</p>
                </div>
              ) : (
                recentTransactions.map((tx) => {
                  return (
                    <div
                      key={tx.id}
                      className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                          tx.type === 'income'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                        }`}>
                          {tx.type === 'income' ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight">
                            {tx.description}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">{nomeDaCategoria(tx.categoryId)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${
                          tx.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'
                        }`}>
                          {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">{formatDate(tx.date)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modal - Nova Transação (Função 1) */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nova Transação">
        <form onSubmit={handleAddTransaction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4 mb-2">
            <button
              type="button"
              onClick={() => setType('expense')}
              className={`py-2 rounded-lg border ${type === 'expense' ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 font-medium' : 'border-slate-200 dark:border-slate-800 text-slate-500'}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setType('income')}
              className={`py-2 rounded-lg border ${type === 'income' ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-700 dark:text-green-400 font-medium' : 'border-slate-200 dark:border-slate-800 text-slate-500'}`}
            >
              Receita
            </button>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Descrição</label>
            <input
              required
              type="text"
              placeholder="Ex: Almoço no restaurante"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Valor (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Data</label>
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Categoria</label>
              <select
                required
                value={catId}
                onChange={(e) => setCatId(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              >
                <option value="" disabled>Selecione...</option>
                {categories.filter((c) => c.type === type).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 mt-6">
            <Button type="button" variant="outline" className="w-full" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? 'Salvando...' : 'Adicionar Transação'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
