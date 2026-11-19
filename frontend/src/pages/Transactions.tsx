import { ArrowDownRight, ArrowUpRight, Plus, Search, Trash2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, Button, Badge, Modal } from '../components/ui';
import { useStore, type TransactionType } from '../store/useStore';
import { useState, useMemo } from 'react';
import { formatCurrency, formatDate } from '../utils/formatters';
import { useFinance } from '../hooks/useFinance';
import { paraTipoMovimentacao } from '../lib/tipos';
import { hojeISO, somarDias } from '../lib/datas';

export default function Transactions() {
  const { categories } = useStore();
  const {
    loading,
    error,
    recarregar,
    registrar_movimentacao,
    remover_movimentacao,
  } = useFinance();

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'receita' | 'despesa'>('todos');
  const [periodo, setPeriodo] = useState<'todo' | 'mes' | 'semana' | 'hoje'>('todo');

  // Form states
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [catId, setCatId] = useState('');
  const [date, setDate] = useState(hojeISO());

  // Transações do store, já carregadas do banco pelo useFinance ao montar
  const transactions = useStore((state) => state.transactions);
  const categoriaPorId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const handleAddTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando || !desc || !amount || !catId) return;

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
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta movimentação?')) return;
    const resultado = await remover_movimentacao(id);
    if (!resultado.sucesso) alert(resultado.mensagem);
  };

  const filteredTx = useMemo(() => transactions
    .filter((tx) =>
      tx.description.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .filter((tx) => {
      // datas YYYY-MM-DD comparadas como texto, no fuso de São Paulo
      const hoje = hojeISO();
      const dia = tx.date.slice(0, 10);
      if (periodo === 'hoje') return dia === hoje;
      if (periodo === 'semana') return dia >= somarDias(hoje, -6) && dia <= hoje;
      if (periodo === 'mes') return dia.slice(0, 7) === hoje.slice(0, 7);
      return true;
    })
    .filter((tx) => {
      if (filtroTipo === 'todos') return true;
      if (filtroTipo === 'receita') return tx.type === 'income';
      return tx.type === 'expense';
    })
    .sort((a, b) => b.date.localeCompare(a.date)), [transactions, searchTerm, periodo, filtroTipo]);

  const totalReceitas = filteredTx.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const totalDespesas = filteredTx.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Transações</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Veja e filtre todo o seu histórico de atividades ({filteredTx.length} lançamentos).
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={recarregar}>
            <RefreshCw size={18} className="mr-2" />
            Atualizar
          </Button>
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus size={18} className="mr-2" />
            Novo Registro
          </Button>
        </div>
      </div>

      {/* Resumo rápido do período filtrado */}
      <Card className="border-none bg-slate-50 dark:bg-slate-800/50 p-4">
        <CardContent className="p-0 pt-2">
          <div className="flex gap-6 sm:gap-12 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="font-medium text-slate-900 dark:text-white">Receitas:</span>{' '}
              <span className="text-green-600 dark:text-green-400 font-bold">
                {formatCurrency(totalReceitas)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <span className="font-medium text-slate-900 dark:text-white">Despesas:</span>{' '}
              <span className="text-red-500 dark:text-red-400 font-bold">
                {formatCurrency(totalDespesas)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span className="font-medium text-slate-900 dark:text-white">Saldo:</span>{' '}
              <span className="text-blue-600 dark:text-blue-400 font-bold">
                {formatCurrency(totalReceitas - totalDespesas)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Buscar por descrição..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value as typeof periodo)}
                className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-green-500/50 shadow-sm appearance-none min-w-[120px]"
              >
                <option value="todo">Todo Período</option>
                <option value="mes">Este Mês</option>
                <option value="semana">Últimos 7 dias</option>
                <option value="hoje">Hoje</option>
              </select>
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)}
                className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-green-500/50 shadow-sm appearance-none min-w-[120px] hidden sm:block"
              >
                <option value="todos">Todos os tipos</option>
                <option value="receita">Receitas</option>
                <option value="despesa">Despesas</option>
              </select>
              {/* Filtro tipo visível em mobile via dropdown simples */}
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value as typeof filtroTipo)}
                className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-green-500/50 shadow-sm appearance-none min-w-[140px] sm:hidden"
              >
                <option value="todos">Todos os tipos</option>
                <option value="receita">Apenas receitas</option>
                <option value="despesa">Apenas despesas</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              Carregando movimentações…
            </div>
          ) : filteredTx.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <p className="font-medium">Nenhuma transação encontrada</p>
              <p className="text-xs mt-1">Registre sua primeira movimentação para começar.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className="px-6 py-4 font-medium">Transação</th>
                    <th className="px-6 py-4 font-medium">Categoria</th>
                    <th className="px-6 py-4 font-medium">Origem</th>
                    <th className="px-6 py-4 font-medium">Data</th>
                    <th className="px-6 py-4 font-medium text-right">Valor</th>
                    <th className="px-6 py-4 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTx.map((tx) => {
                    const cat = categoriaPorId.get(tx.categoryId);
                    return (
                      <tr
                        key={tx.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                              tx.type === 'income'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                            }`}>
                              {tx.type === 'income' ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                            </div>
                            <span className="font-medium text-slate-900 dark:text-white">{tx.description}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="outline">{cat?.name || 'Geral'}</Badge>
                        </td>
                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                          {tx.fonte === 'whatsapp' ? 'WhatsApp' : tx.fonte === 'painel' ? 'Painel' : 'Conta paga'}
                        </td>
                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                          {formatDate(tx.date)}
                        </td>
                        <td className={`px-6 py-4 text-right font-medium ${
                          tx.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'
                        }`}>
                          {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleDelete(tx.id)}
                            className="text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nova Transação">
        <form onSubmit={handleAddTx} className="space-y-4">
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
              placeholder="Ex: Almoço Cliente"
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
              {enviando ? 'Salvando...' : 'Adicionar Lançamento'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
