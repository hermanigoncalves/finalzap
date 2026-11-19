import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { ehUsuarioAdmin } from '../lib/financeService';
import { lerModo } from '../lib/modoAcesso';

/**
 * AdminGuard: protege rotas que só devem ser acessadas por usuários com role 'admin'.
 * Se não for admin, redireciona para o dashboard.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    ehUsuarioAdmin()
      .then((admin) => {
        if (mounted) {
          setIsAdmin(admin);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setIsAdmin(false);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin || lerModo() !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
