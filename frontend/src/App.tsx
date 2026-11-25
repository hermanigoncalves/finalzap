import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import DashboardLayout from './layouts/DashboardLayout';
import { useAuth } from './hooks/useAuth';
import AdminGuard from './components/AdminGuard';
import { resolverPerfilUsuario, verificarMinhaAssinaturaAtiva, type PerfilUsuario } from './lib/financeService';
import LoginPage from './pages/Login';
import VincularWhatsApp from './components/VincularWhatsApp';
import EscolherModo from './components/EscolherModo';
import { lerModo, salvarModo } from './lib/modoAcesso';

const Dashboard         = lazy(() => import('./pages/Dashboard'));
const Transactions      = lazy(() => import('./pages/Transactions'));
const FixedTransactions = lazy(() => import('./pages/FixedTransactions'));
const Settings          = lazy(() => import('./pages/Settings'));
const Budget            = lazy(() => import('./pages/Budget'));
const Agenda            = lazy(() => import('./features/agenda').then((m) => ({ default: m.PaginaAgenda })));
const DicasEconomia     = lazy(() => import('./pages/DicasEconomia'));
const Administrador     = lazy(() => import('./pages/AssinaturasAdmin'));
const DefinirSenha      = lazy(() => import('./pages/DefinirSenha'));

const Spinner = () => (
  <div className="flex items-center justify-center h-screen bg-slate-900">
    <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

const S = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  }>
    {children}
  </Suspense>
);

const MensagemConta = ({ titulo, texto }: { titulo: string; texto: string }) => {
  const { signOut } = useAuth();
  return (
    <div className="flex items-center justify-center h-screen bg-slate-900 p-6">
      <div className="max-w-md text-center space-y-4 text-slate-200">
        <h1 className="text-xl font-bold text-white">{titulo}</h1>
        <p className="text-sm text-slate-400">{texto}</p>
        <button onClick={signOut} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium">Sair</button>
      </div>
    </div>
  );
};

function AuthGate() {
  const { user, loading: authLoading, signOut } = useAuth();

  const navigate = useNavigate();
  const { pathname } = useLocation();

  const userId = user?.id ?? null;
  const [perfil, setPerfil] = useState<PerfilUsuario | null | undefined>(undefined);
  const [erroPerfil, setErroPerfil] = useState(false);
  const [assinaturaAtiva, setAssinaturaAtiva] = useState<boolean | undefined>(undefined);
  const [erroAssinatura, setErroAssinatura] = useState(false);
  const recarregarPerfil = useCallback(() => {
    resolverPerfilUsuario()
      .then((p) => { setPerfil(p); setErroPerfil(false); })
      .catch(() => setErroPerfil(true));
  }, []);
  useEffect(() => {
    if (userId) recarregarPerfil();
  }, [userId, recarregarPerfil]);
  useEffect(() => {
    if (!perfil || perfil.role === 'admin') return;
    let ativo = true;
    verificarMinhaAssinaturaAtiva(perfil.telefone)
      .then((ok) => {
        if (!ativo) return;
        setAssinaturaAtiva(ok);
        setErroAssinatura(false);
      })
      .catch(() => {
        if (!ativo) return;
        setErroAssinatura(true);
      });
    return () => { ativo = false; };
  }, [perfil]);
  const isAdmin = perfil ? perfil.role === 'admin' : null;

  const [modo, setModo] = useState(lerModo);

  useEffect(() => {
    if (isAdmin && modo === 'admin' && pathname !== '/admin') navigate('/admin', { replace: true });
  }, [isAdmin, modo, pathname, navigate]);

  if (authLoading) return <Spinner />;

  if (!user) return <LoginPage />;

  if (erroPerfil) {
    return <MensagemConta titulo="Não foi possível carregar sua conta" texto="Verifique sua conexão e recarregue a página." />;
  }
  if (perfil === undefined) return <Spinner />;
  if (perfil === null) {
    return <VincularWhatsApp aoVincular={recarregarPerfil} />;
  }

  if (perfil.role !== 'admin') {
    if (erroAssinatura) {
      return <MensagemConta titulo="Não foi possível verificar sua assinatura" texto="Verifique sua conexão e recarregue a página." />;
    }
    if (assinaturaAtiva === undefined) return <Spinner />;
    if (!assinaturaAtiva) {
      return (
        <div className="flex items-center justify-center h-screen bg-slate-900 p-6">
          <div className="max-w-md text-center space-y-4 text-slate-200">
            <h1 className="text-xl font-bold text-white">Assinatura inativa ou vencida</h1>
            <p className="text-sm text-slate-400">
              Sua assinatura não está ativa no momento. Assine ou renove para continuar acessando o painel.
            </p>
            <div className="flex items-center justify-center gap-3">
              <a
                href="https://pay.hotmart.com/N108346496T"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium"
              >
                Assinar / Renovar
              </a>
              <button
                type="button"
                onClick={signOut}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium cursor-pointer"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  if (isAdmin && !modo) {
    return (
      <EscolherModo
        nome={perfil?.nome}
        aoEscolher={(m) => { salvarModo(m); setModo(m); }}
        aoSair={signOut}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<DashboardLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"          element={<S><Dashboard /></S>} />
        <Route path="transactions"       element={<S><Transactions /></S>} />
        <Route path="fixed"              element={<S><FixedTransactions /></S>} />
        <Route path="agenda"             element={<S><Agenda /></S>} />
        <Route path="budget"             element={<S><Budget /></S>} />
        <Route path="admin"              element={<AdminGuard><S><Administrador /></S></AdminGuard>} />
        <Route path="dicas-economia"      element={<S><DicasEconomia /></S>} />
        <Route path="settings"           element={<S><Settings /></S>} />
        <Route path="*"                  element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

function RotaRaiz() {
  const { pathname } = useLocation();
  if (pathname === '/definir-senha') {
    return <Suspense fallback={<Spinner />}><DefinirSenha /></Suspense>;
  }
  return <AuthGate />;
}

function App() {
  return (
    <BrowserRouter>
      <RotaRaiz />
    </BrowserRouter>
  );
}

export default App;
