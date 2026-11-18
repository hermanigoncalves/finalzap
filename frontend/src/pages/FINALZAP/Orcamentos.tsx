// legado - fora do escopo: sem rota ativa, não importar a partir de telas ativas (usa tabelas/modelo antigos).
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getOrcamentos, setOrcamento, type DbOrcamento } from '../../lib/supabaseService';
import { formatCurrency } from '../../utils/formatters';
import { Card, CardHeader, CardTitle, Button } from '../../components/ui';

export default function Orcamentos() {
  const { user } = useAuth();
  const [orcamentos, setOrcamentos] = useState<DbOrcamento[]>([]);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create');
  const [formData, setFormData] = useState<{ categoria: string; limite_mensal: number; mes?: string }>({
    categoria: '',
    limite_mensal: 0,
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getOrcamentos(user.phone ?? user.email ?? '');
      setOrcamentos(data);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial assíncrona; setState ocorre após await
    carregar();
  }, [carregar]);

  if (!user) return null;
  if (loading) return <p className="text-slate-500">Carregando...</p>;
  if (error) return <p className="text-red-500">Erro: {error}</p>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setOrcamento(
        user.phone ?? user.email ?? '',
        formData.categoria,
        formData.limite_mensal,
        formData.mes
      );
      setEditMode('create');
      setEditId(null);
      setFormData({ categoria: '', limite_mensal: 0 });
      await carregar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
          Orçamentos Mensais
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          Defina limites por categoria para controle financeiro
        </p>
      </div>

      {orcamentos.length === 0 ? (
        <div className="p-8 text-center text-slate-400">
          <p className="font-medium">Nenhum orçamento cadastrado</p>
          <p className="text-xs mt-1">Crie seu primeiro limite abaixo.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {orcamentos.map((orc) => (
            <Card key={orc.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800/50 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{orc.categoria}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {formatCurrency(orc.limite_mensal)} / mês
                  </p>
                  {orc.mes && <p className="text-xs text-slate-500">Válido para: {orc.mes}</p>}
                </div>
                <div className="text-right">
                  {editMode === 'edit' && editId === orc.id ? (
                    <form onSubmit={handleSubmit} className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        value={formData.limite_mensal}
                        onChange={(e) => setFormData({ ...formData, limite_mensal: parseFloat(e.target.value) || 0 })}
                        className="p-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none w-48"
                      />
                      <button type="submit" className="px-3 py-1 rounded bg-green-500 text-white text-sm">Salvar</button>
                      <button type="button" onClick={() => setEditMode('create')} className="px-3 py-1 rounded bg-slate-200 text-sm">Cancelar</button>
                    </form>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditMode('edit');
                          setEditId(orc.id);
                          setFormData({
                            categoria: orc.categoria,
                            limite_mensal: orc.limite_mensal,
                            mes: orc.mes,
                          });
                        }}
                      >
                        Editar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Formulário de criação/edição */}
      <Card className="p-6 rounded-xl border border-slate-200 dark:border-slate-800">
        <CardHeader className="px-0 pt-0">
          <CardTitle>{editMode === 'edit' ? 'Editar Orçamento' : 'Novo Orçamento'}</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Categoria</label>
            <input
              required
              type="text"
              placeholder="Ex: Alimentação"
              value={formData.categoria}
              onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
              className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Limite Mensal (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.limite_mensal || ''}
                onChange={(e) => setFormData({ ...formData, limite_mensal: parseFloat(e.target.value) || 0 })}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Mês (opcional)</label>
              <input
                type="text"
                placeholder="Ex: 2026-11 (deixe em branco para geral)"
                value={formData.mes || ''}
                onChange={(e) => setFormData({ ...formData, mes: e.target.value.trim() })}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 mt-6">
            {editMode === 'edit' && (
              <Button type="button" variant="outline" className="w-full" onClick={() => setEditMode('create')}>
                Cancelar
              </Button>
            )}
            <Button type="submit" className="w-full">
              {editMode === 'edit' ? 'Salvar Alterações' : 'Criar Orçamento'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
