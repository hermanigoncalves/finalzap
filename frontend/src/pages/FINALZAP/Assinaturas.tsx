// legado - fora do escopo: sem rota ativa, não importar a partir de telas ativas (usa tabelas/modelo antigos).
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getAssinaturas, registrarLembrete, type DbAssinatura } from '../../lib/supabaseService';
import { Card, Button } from '../../components/ui';

export default function Assinaturas() {
  const { user } = useAuth();
  const [assinaturas, setAssinaturas] = useState<DbAssinatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const carregar = async () => {
      try {
        const data = await getAssinaturas(user.phone ?? user.email ?? '');
        setAssinaturas(data);
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    };
    carregar();
  }, [user]);

  if (!user) return null;
  if (loading) return <p className="text-slate-500">Carregando...</p>;
  if (error) return <p className="text-red-500">Erro: {error}</p>;

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
          Minhas Assinaturas
        </h1>
        <p className="text-slate-500 dark:text-slate-400">
          Controle das suas assinaturas do FINALZAP by Sueli's
        </p>
      </div>

      {assinaturas.length === 0 ? (
        <div className="p-8 text-center text-slate-400">
          <p className="font-medium">Nenhuma assinatura encontrada</p>
          <p className="text-xs mt-1">Assine pelo link Hotmart para ter acesso completo.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {assinaturas.map((assinatura) => (
            <Card key={assinatura.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800/50 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {assinatura.plano || 'Mensal'}
                    {assinatura.status === 'Ativo' && (
                      <span className="text-green-600 dark:text-green-400 font-bold ml-2">
                        • Ativo
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Vence em {assinatura.data_vencimento ? new Date(assinatura.data_vencimento).toLocaleDateString('pt-BR') : 'Indefinido'}
                  </p>
                </div>
                <div className="text-right">
                  <Button
                    size="sm"
                    variant={assinatura.status === 'Ativo' ? "default" : "danger"}
                    onClick={() => registrarLembrete(
                      user.phone ?? user.email ?? '',
                      null,
                      'vencimento_proximo',
                      assinatura.status === 'Ativo' ? 'enviado' : 'falhou'
                    )}>
                    {assinatura.status === 'Ativo' ? 'Renovar' : 'Reativar'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
