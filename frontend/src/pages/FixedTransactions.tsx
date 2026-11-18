import { ArrowDownRight, ArrowUpRight, Plus, Calendar, Check } from 'lucide-react';
import type { ContaAPagar } from '../lib/financeService';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Modal } from '../components/ui';
import { useStore } from '../store/useStore';
import { useState, useEffect } from 'react';
import { useFinance } from '../hooks/useFinance';
import { hojeISO } from '../lib/datas';

export default function FixedTransactions() {
  const { fixedTransactions, categories } = useStore();
  const {
    loading,
    error,
    cadastrar_conta_a_pagar,
    marcar_conta_paga,
    lista_contas_vencendo,
    formatar_moeda_brl,
  } = useFinance();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [busca] = useState('');
  const [pagando, setPagando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [contasVencendo, setContasVencendo] = useState<ContaAPagar[]>([]);

  // Form states
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [catId, setCatId] = useState('');
  const [dateStr, setDateStr] = useState('');

  const recarregarVencendo = () => lista_contas_vencendo(7).then(setContasVencendo);

  // Carrega contas a pagar vencendo ao montar
  useEffect(() => {
    void lista_contas_vencendo(7).then(setContasVencendo);
  }, [lista_contas_vencendo]);

  const handleAddFixedTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando || !desc || !amount || !catId || !dateStr) return;

    setEnviando(true);
    const resultado = await cadastrar_conta_a_pagar({
      descricao: desc,
      valor: parseFloat(amount.replace(',', '.')),
      categoria: catId,
      vencimento: dateStr,
    }).finally(() => setEnviando(false));

    if (!resultado.sucesso) {
      alert(resultado.erro);
      return;
    }

    setIsModalOpen(false);
    setDesc('');
    setAmount('');
    setDateStr('');
    await recarregarVencendo();
  };

  const handlePagar = async (id: string) => {
    setPagando(id);
    const resultado = await marcar_conta_paga(id);
    if (!resultado.sucesso) {
      alert(resultado.mensagem);
      setPagando(null);
      return;
    }
    await recarregarVencendo();
    setTimeout(() => setPagando(null), 800);
  };

  // Usa contas do store (que já foram sincronizadas com contas_a_pagar via useFinance)
  const contasFiltradas = fixedTransactions
    .filter((tx) => (busca ? tx.description.toLowerCase().includes(busca.toLowerCase()) : true))
    .sort((a, b) => (a.vencimento || a.date).localeCompare(b.vencimento || b.date));

  const totalExpenses = fixedTransactions
    .filter((t) => t.type === 'expense' && (t.status === 'active' || t.status === 'pendente'))
    .reduce((acc, t) => acc + t.amount, 0);

  const fixedAtivas = fixedTransactions.filter((t) => t.status === 'active' || t.status === 'pendente');
  const nextDueTx = fixedAtivas.length > 0
    ? [...fixedAtivas].sort((a, b) => (a.vencimento || a.date).localeCompare(b.vencimento || b.date))[0]
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Contas a Pagar</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Cadastre suas contas e marque como pagas: o pagamento gera a despesa automaticamente.
          </p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus size={18} className="mr-2" />
            Nova Conta
          </Button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 mb-8">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Total de Contas Pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatar_moeda_brl(totalExpenses)}</div>
            <p className="text-xs text-red-500 mt-1 font-medium items-center flex">
              <ArrowUpRight size={14} className="mr-1" />
              Ainda a pagar
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow bg-green-50/50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Próximo Vencimento</CardTitle>
          </CardHeader>
          <CardContent>
            {nextDueTx ? (
              <>
                <div className="text-lg font-bold text-slate-900 dark:text-white mb-1 truncate">{nextDueTx.description}</div>
                <p className="text-sm text-slate-500">
                  Dia {nextDueTx.date} • <span className={`font-semibold ${nextDueTx.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>{formatar_moeda_brl(nextDueTx.amount)}</span>
                </p>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Nenhum agendamento</div>
                <p className="text-xs text-slate-500">Cadastre uma conta para acompanhar.</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contas vencendo em breve (Função 5) */}
      {contasVencendo.length > 0 && (
        <Card className="border-orange-200 dark:border-orange-900/40">
          <CardHeader className="flex items-center gap-2">
            <Calendar size={16} className="text-orange-500" />
            <CardTitle className="text-sm font-medium text-slate-900 dark:text-white">Contas vencendo em até 7 dias</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {contasVencendo.map((conta) => {
              const dias = Math.round(
                (Date.parse(`${conta.vencimento.slice(0, 10)}T12:00:00Z`) - Date.parse(`${hojeISO()}T12:00:00Z`)) / 86400000
              );
              return (
                <div
                  key={conta.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-orange-50 dark:bg-orange-900/10"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{conta.descricao}</p>
                    <p className="text-xs text-slate-500">
                      Vence em {dias === 0 ? 'HOJE' : `em ${dias} dia(s)`} — {formatar_moeda_brl(conta.valor)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handlePagar(conta.id)}
                    disabled={pagando === conta.id}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs"
                  >
                    {pagando === conta.id ? 'Pagando…' : 'Pagar'}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-6 py-4 font-medium">Conta</th>
                  <th className="px-6 py-4 font-medium">Vencimento</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium text-right">Valor</th>
                  <th className="px-6 py-4 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {contasFiltradas.map((tx) => {
                  const cat = categories.find((c) => c.id === tx.categoryId);
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                            tx.type === 'income'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                          }`}>
                            {tx.type === 'income' ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-white block">{tx.description}</span>
                            <span className="text-xs text-slate-500 mt-1 block">{cat?.name || 'Geral'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-700 dark:text-slate-300">{tx.date}</div>
                      </td>
                      <td className="px-6 py-4">
                        {tx.status === 'active' || tx.status === 'pendente' ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/50 gap-1.5 px-2.5 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            Pendente
                          </Badge>
                        ) : tx.status === 'cancelada' ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/50 gap-1.5 px-2.5 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            Cancelada
                          </Badge>
                        ) : tx.status === 'paga' ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/50 gap-1.5 px-2.5 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                            Paga
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 gap-1.5 px-2.5 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            Pausado
                          </Badge>
                        )}
                      </td>
                      <td className={`px-6 py-4 text-right font-bold text-base ${
                        tx.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'
                      }`}>
                        {tx.type === 'income' ? '+' : '-'}{formatar_moeda_brl(tx.amount)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          {tx.status === 'pendente' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handlePagar(tx.id)}
                              disabled={pagando === tx.id}
                              className="h-8 w-8 p-0 text-green-600 hover:bg-green-50 ml-1"
                            >
                              <Check size={16} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Empty State / CTA */}
      <div className="mt-8 text-center p-8 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Nunca perca um vencimento</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
          Cadastre suas contas a pagar: o painel destaca as que vencem em até 7 dias.
        </p>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus size={18} className="mr-2" />
          Cadastrar Nova Conta
        </Button>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nova Conta a Pagar">
        <form onSubmit={handleAddFixedTx} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Descrição</label>
            <input
              required
              type="text"
              placeholder="Ex: Conta de luz"
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Vencimento</label>
              <input
                required
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Categoria</label>
              <select
                required
                value={catId}
                onChange={(e) => setCatId(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              >
                <option value="" disabled>Selecione...</option>
                {categories.filter((c) => c.type === 'expense').map((c) => (
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
              {enviando ? 'Salvando...' : 'Cadastrar Conta'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
