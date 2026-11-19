import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import DashboardLayout from './layouts/DashboardLayout';
import { useAuth } from './hooks/useAuth';
import AdminGuard from './components/AdminGuard';
import { resolverPerfilUsuario, type PerfilUsuario } from './lib/financeService';
import LoginPage from './pages/Login';
import VincularWhatsApp from './components/VincularWhatsApp';

const Dashboard         = lazy(() => import('./pages/Dashboard'));
const Transactions      = lazy(() => import('./pages/Transactions'));
const FixedTransactions = lazy(() => import('./pages/FixedTransactions'));
const Settings          = lazy(() => import('./pages/Settings'));
const Budget            = lazy(() => import('./pages/Budget'));
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

// Inner component so hooks run inside BrowserRouter
function AuthGate() {
  const { user, loading: authLoading } = useAuth();

  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Descobre o perfil (e o papel) uma vez por usuário; o perfil fica em cache no financeService.
  // undefined = carregando, null = autenticado sem linha em perfis.
  const userId = user?.id ?? null;
  const [perfil, setPerfil] = useState<PerfilUsuario | null | undefined>(undefined);
  const [erroPerfil, setErroPerfil] = useState(false);
  const recarregarPerfil = useCallback(() => {
    resolverPerfilUsuario()
      .then((p) => { setPerfil(p); setErroPerfil(false); })
      .catch(() => setErroPerfil(true));
  }, []);
  useEffect(() => {
    if (userId) recarregarPerfil();
  }, [userId, recarregarPerfil]);
  const isAdmin = perfil ? perfil.role === 'admin' : null;

  // Administrador só usa a área de administração.
  useEffect(() => {
    if (isAdmin && pathname !== '/admin') navigate('/admin', { replace: true });
  }, [isAdmin, pathname, navigate]);

  // Still checking if user is logged in
  if (authLoading) return <Spinner />;

  // Not authenticated — show login
  if (!user) return <LoginPage />;

  if (erroPerfil) {
    return <MensagemConta titulo="Não foi possível carregar sua conta" texto="Verifique sua conexão e recarregue a página." />;
  }
  if (perfil === undefined) return <Spinner />;
  if (perfil === null) {
    // Autenticado sem perfil (ex.: compra sem telefone): vincula o WhatsApp por código.
    return <VincularWhatsApp aoVincular={recarregarPerfil} />;
  }

  return (
    <Routes>
      <Route path="/" element={<DashboardLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"          element={<S><Dashboard /></S>} />
        <Route path="transactions"       element={<S><Transactions /></S>} />
        <Route path="fixed"              element={<S><FixedTransactions /></S>} />
        <Route path="budget"             element={<S><Budget /></S>} />
        <Route path="admin"              element={<AdminGuard><S><Administrador /></S></AdminGuard>} />
        <Route path="dicas-economia"      element={<S><DicasEconomia /></S>} />
        <Route path="settings"           element={<S><Settings /></S>} />
        <Route path="*"                  element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

// /definir-senha vem antes do AuthGate: o cliente chega pelo link do convite, sem perfil nem login prévio.
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
