import { useState, useEffect } from 'react';
import { User, Bell, Shield, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '../components/ui';
import { useStore } from '../store/useStore';
import { cn } from '../components/ui';
import { resolverPerfilUsuario, atualizarPerfil, excluirMinhaConta, type PerfilUsuario } from '../lib/financeService';
import { useAuth } from '../hooks/useAuth';

type Tab = 'profile' | 'notifications' | 'security';

const tabs: { id: Tab; label: string; icon: typeof User }[] = [
  { id: 'profile',       label: 'Perfil',               icon: User        },
  { id: 'notifications', label: 'Notificações',          icon: Bell        },
  { id: 'security',      label: 'Segurança',             icon: Shield      },
];

export default function Settings() {
  const { userSettings, updateSettings, perfil: perfilStore } = useStore();
  const { signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [saved, setSaved] = useState(false);
  const [perfilLocal, setPerfilLocal] = useState<PerfilUsuario | null>(null);
  const [perfilCarregado, setPerfilCarregado] = useState(() => useStore.getState().perfil !== null);
  const [perfilErro, setPerfilErro] = useState('');
  const [rascunho, setRascunho] = useState<{ nome: string; email: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState('');
  const perfil = perfilStore ?? perfilLocal;
  const nome = rascunho ? rascunho.nome : (perfil?.nome ?? '');
  const email = rascunho ? rascunho.email : (perfil?.email ?? '');

  useEffect(() => {
    if (useStore.getState().perfil) return;
    resolverPerfilUsuario()
      .then((p) => {
        setPerfilLocal(p);
        if (p) useStore.setState({ perfil: p });
      })
      .catch(() => setPerfilErro('Não foi possível carregar o perfil.'))
      .finally(() => setPerfilCarregado(true));
  }, []);

  const mostrarSalvo = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const salvarPerfil = async () => {
    setSalvando(true);
    setPerfilErro('');
    try {
      const confirmar = await atualizarPerfil({ nome, email });
      const atualizado = await resolverPerfilUsuario();
      if (atualizado) {
        setPerfilLocal(atualizado);
        useStore.setState({ perfil: atualizado });
      }
      setRascunho(null);
      mostrarSalvo();
      if (confirmar) alert('Enviamos um link de confirmação para o novo e-mail. O login só muda depois de confirmar.');
    } catch (e) {
      setPerfilErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const [form, setForm] = useState({ ...userSettings });
  const patch = (key: keyof typeof form, value: string | boolean | number) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleSave = () => {
    updateSettings(form);
    mostrarSalvo();
  };

  const handleExcluirConta = async () => {
    if (!window.confirm('Tem certeza que deseja excluir sua conta e todos os seus dados? Esta ação é permanente e não pode ser desfeita.')) {
      return;
    }
    setExcluindo(true);
    setErroExclusao('');
    try {
      const res = await excluirMinhaConta();
      if (!res.ok) {
        setErroExclusao(res.mensagem || 'Não foi possível excluir sua conta.');
        return;
      }
      await signOut();
    } catch {
      setErroExclusao('Não foi possível excluir sua conta no momento. Tente novamente.');
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Configurações</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Gerencie seu perfil, suas notificações e a segurança da conta.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[240px_1fr] items-start">
        <Card className="sticky top-6">
          <div className="p-2 space-y-0.5">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left',
                  activeTab === tab.id
                    ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <tab.icon size={18} className={activeTab === tab.id ? 'text-green-500' : ''} />
                {tab.label}
              </button>
            ))}
          </div>
        </Card>

        {activeTab === 'profile' && (
          <Card>
            <CardHeader>
              <CardTitle>Informações Pessoais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {perfilErro && <p className="text-sm text-red-500">{perfilErro}</p>}
              {perfilCarregado && !perfil && !perfilErro && (
                <p className="text-sm text-amber-600">Perfil não encontrado para este login. Fale com o suporte.</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Nome</label>
                  <input type="text" value={nome} onChange={e => setRascunho({ nome: e.target.value, email })} disabled={!perfil}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none disabled:opacity-60" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">E-mail</label>
                  <input type="email" value={email} onChange={e => setRascunho({ nome, email: e.target.value })} disabled={!perfil}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none disabled:opacity-60" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Telefone / WhatsApp</label>
                  <input type="tel" value={perfil?.telefone ?? ''} readOnly disabled
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm opacity-70" />
                  <p className="text-xs text-slate-500">Para trocar o telefone fale com o suporte.</p>
                </div>
              </div>
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                {saved && <span className="text-sm text-green-600 flex items-center gap-1"><Check size={14} /> Salvo!</span>}
                <Button onClick={salvarPerfil} disabled={!perfil || salvando}>{salvando ? 'Salvando...' : 'Salvar Alterações'}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'notifications' && (
          <Card>
            <CardHeader>
              <CardTitle>Preferências de Notificação</CardTitle>
              <p className="text-sm text-slate-500 mt-1">Escolha os avisos financeiros e os limites que deseja acompanhar.</p>
            </CardHeader>
            <CardContent className="space-y-3">

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">Saldo baixo</p>
                    <p className="text-xs text-slate-500 mt-0.5">Alerta quando qualquer conta ficar abaixo do limite definido</p>
                  </div>
                  <button
                    onClick={() => patch('notifyLowBalance', !form.notifyLowBalance)}
                    className={cn('relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none', form.notifyLowBalance ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600')}
                  >
                    <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200', form.notifyLowBalance ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
                {form.notifyLowBalance && (
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                    <label className="text-xs text-slate-500 shrink-0">Limite mínimo:</label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">R$</span>
                      <input
                        type="number" min="0" step="50"
                        value={form.lowBalanceThreshold}
                        onChange={e => patch('lowBalanceThreshold', Number(e.target.value))}
                        className="w-28 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:ring-2 focus:ring-green-500 outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">Orçamento estourando</p>
                    <p className="text-xs text-slate-500 mt-0.5">Aviso quando uma categoria atingir o percentual definido do limite mensal</p>
                  </div>
                  <button
                    onClick={() => patch('notifyBudgetAlert', !form.notifyBudgetAlert)}
                    className={cn('relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none', form.notifyBudgetAlert ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600')}
                  >
                    <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200', form.notifyBudgetAlert ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
                {form.notifyBudgetAlert && (
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                    <label className="text-xs text-slate-500 shrink-0">Alertar a partir de:</label>
                    <input
                      type="number" min="1" max="100" step="5"
                      value={form.budgetAlertPercentage}
                      onChange={e => patch('budgetAlertPercentage', Number(e.target.value))}
                      className="w-20 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:ring-2 focus:ring-green-500 outline-none"
                    />
                    <span className="text-xs text-slate-500">% do orçamento</span>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">Contas a vencer</p>
                    <p className="text-xs text-slate-500 mt-0.5">Lembrete de transações fixas com vencimento próximo</p>
                  </div>
                  <button
                    onClick={() => patch('notifyFixedDue', !form.notifyFixedDue)}
                    className={cn('relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none', form.notifyFixedDue ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600')}
                  >
                    <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200', form.notifyFixedDue ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
                {form.notifyFixedDue && (
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                    <label className="text-xs text-slate-500 shrink-0">Alertar com:</label>
                    <input
                      type="number" min="1" max="30" step="1"
                      value={form.fixedDueDays}
                      onChange={e => patch('fixedDueDays', Number(e.target.value))}
                      className="w-20 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium focus:ring-2 focus:ring-green-500 outline-none"
                    />
                    <span className="text-xs text-slate-500">dias de antecedência</span>
                  </div>
                )}
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                {saved && <span className="text-sm text-green-600 flex items-center gap-1"><Check size={14} /> Salvo!</span>}
                <Button onClick={handleSave}>Salvar Preferências</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'security' && (
          <Card>
            <CardHeader>
              <CardTitle>Segurança</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 text-sm text-amber-700 dark:text-amber-400">
                ⚠️ Nunca compartilhe sua URL de webhook publicamente. Qualquer pessoa com acesso pode enviar dados ao sistema.
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Limpar todos os dados locais</label>
                <p className="text-xs text-slate-500">Remove todas as transações, contas e configurações do localStorage.</p>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm('Tem certeza? Esta ação não pode ser desfeita.')) {
                      localStorage.removeItem('finance-store');
                      localStorage.removeItem('finance-store-owner');
                      window.location.reload();
                    }
                  }}
                >
                  Limpar Dados
                </Button>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <h3 className="text-sm font-medium text-red-600 dark:text-red-400">Excluir minha conta e dados (LGPD)</h3>
                <p className="text-xs text-slate-500">
                  Apaga permanentemente sua conta, movimentações, agenda e vínculo no WhatsApp.
                </p>
                {erroExclusao && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">{erroExclusao}</p>
                )}
                <Button variant="danger" onClick={handleExcluirConta} disabled={excluindo}>
                  {excluindo ? 'Excluindo...' : 'Excluir minha conta'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
