import { mesAtual } from '../lib/datas';
import { nomeDaCategoria } from '../lib/categorias';
import { Card, CardContent, CardTitle, Badge } from '../components/ui';
import { useStore } from '../store/useStore';
import { useFinance } from '../hooks/useFinance';
import { useMemo } from 'react';

const ICONS_PRIORIDADE: Record<string, string> = {
  alta: '🔴',
  media: '🟡',
  baixa: '🟢',
};

export default function DicasEconomia() {
  const { transactions, orcamentos } = useStore();
  const {
    loading,
    error,
    obter_dicas_economia,
  } = useFinance(['movimentacoes', 'orcamentos']);

  const dicas = useMemo(() => {
    const mesCorrente = mesAtual();
    const gastosPorCategoria: Record<string, number> = {};
    transactions.forEach((tx) => {
      if (tx.type !== 'expense') return;
      if (tx.date.slice(0, 7) !== mesCorrente) return;
      const nome = nomeDaCategoria(tx.categoryId);
      gastosPorCategoria[nome] = (gastosPorCategoria[nome] ?? 0) + tx.amount;
    });
    return obter_dicas_economia(gastosPorCategoria, orcamentos);
  }, [transactions, orcamentos, obter_dicas_economia]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center">
          <h2 className="text-red-500 dark:text-red-400 text-xl font-bold mb-2">Erro</h2>
          <p className="text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Dicas de Economia</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Recomendações personalizadas com base nos seus lançamentos e orçamentos do mês.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {dicas.length > 0 ? (
          dicas.map((dica, i) => {
            const prioridade = dica.prioridade || 'media';
            return (
              <Card key={i} className="hover:shadow-md transition-shadow border-l-4">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0 mt-0.5">{ICONS_PRIORIDADE[prioridade] || '🟡'}</span>
                    <div className="flex-1">
                      <CardTitle className="text-base font-semibold text-slate-900 dark:text-white mb-1">
                        {dica.titulo}
                      </CardTitle>
                      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        {dica.texto}
                      </p>
                      {dica.categoria && (
                        <p className="mt-2 text-xs text-slate-500">
                          <span className="font-semibold">Categoria relacionada:</span>{' '}
                          {dica.categoria}
                        </p>
                      )}
                      <Badge
                        variant={
                          prioridade === 'alta'
                            ? 'danger'
                            : prioridade === 'media'
                            ? 'warning'
                            : 'default'
                        }
                        className="mt-3 text-xs"
                      >
                        Prioridade {prioridade}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="col-span-full flex items-center justify-center h-64">
            <p className="text-slate-400 text-sm">Nenhuma dica disponível no momento.</p>
          </div>
        )}
      </div>

      <Card className="border-none bg-slate-50 dark:bg-slate-800/50 p-6">
        <CardContent className="p-0 pt-2">
          <CardTitle className="text-sm font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <span>💡</span> Como as dicas são geradas
          </CardTitle>
          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-disc pl-6">
            <li>
              As dicas consideram seus <strong>gastos por categoria no mês atual</strong> e os
              <strong>limites de orçamento</strong> definidos na página de Orçamento.
            </li>
            <li>
              Se uma categoria atingiu ou ultrapassou o limite, aparece uma dica de alta prioridade
              sugerindo revisão dos lançamentos.
            </li>
            <li>
              Quando falta valor, vencimento ou outra informação essencial no WhatsApp, o agente
              pergunta antes de registrar — nada é salvo no banco sem confirmação.
            </li>
            <li>
              Todas as movimentações são registradas apenas em <strong>Reais (R$)</strong>. Não
              misturamos reais e dólares enquanto não houver armazenamento separado por moeda.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
