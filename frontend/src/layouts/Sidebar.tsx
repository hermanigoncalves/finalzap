import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Calendar,
  CalendarClock,
  Target,
  Settings,
  X,
  Lightbulb,
  Wallet,
  Bot,
  CreditCard,
  LogOut,
  Repeat,
  Smartphone,
} from 'lucide-react';
import { cn } from '../components/ui';
import { useStore } from '../store/useStore';
import { useAuth } from '../hooks/useAuth';
import { useState, useEffect } from 'react';
import Brand from '../components/Brand';
import { ehUsuarioAdmin } from '../lib/financeService';
import { lerModo, limparModo } from '../lib/modoAcesso';

// Menu do administrador: as abas do painel viram itens do menu lateral.
const navItemsAdmin = [
  { name: 'Dashboard',                    path: '/admin?aba=dashboard',   icon: LayoutDashboard },
  { name: 'Assinaturas (Hotmart)',        path: '/admin?aba=assinaturas', icon: Wallet     },
  { name: 'Tokens / Uso (OpenAI • WhatsApp)', path: '/admin?aba=tokens',     icon: Bot        },
  { name: 'Custos Fixos',                 path: '/admin?aba=custos',      icon: CreditCard },
  { name: 'Conexão WhatsApp',             path: '/admin?aba=whatsapp',    icon: Smartphone },
];

const navItemsBase = [
  { name: 'Visão geral',   path: '/dashboard',          icon: LayoutDashboard },
  { name: 'Transações',    path: '/transactions',       icon: ArrowLeftRight  },
  { name: 'Contas a pagar',   path: '/fixed',              icon: Calendar        },
  { name: 'Agenda',           path: '/agenda',             icon: CalendarClock   },
  { name: 'Orçamento',     path: '/budget',             icon: Target          },
  { name: 'Dicas',         path: '/dicas-economia',     icon: Lightbulb       },
];

export default function Sidebar({ isOpen, setIsOpen }: { isOpen: boolean; setIsOpen: (v: boolean) => void }) {
  const { userSettings } = useStore();
  const { signOut } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const { pathname, search } = useLocation();
  const abaAtual = new URLSearchParams(search).get('aba') || 'dashboard';

  useEffect(() => {
    let mounted = true;
    ehUsuarioAdmin()
      .then((admin) => { if (mounted) setIsAdmin(admin); })
      .catch(() => { if (mounted) setIsAdmin(false); });
    return () => { mounted = false; };
  }, []);

  // Administrador vê só a área de administração; cliente nunca vê o item Administrador.
  const modoAdmin = isAdmin === true && lerModo() === 'admin';
  const navItems = modoAdmin
    ? navItemsAdmin
    : navItemsBase;
  const fullName = [userSettings.firstName, userSettings.lastName].filter(Boolean).join(' ') || 'Usuário';
  const initials = ((userSettings.firstName[0] || '') + (userSettings.lastName[0] || '')).toUpperCase() || '?';

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsOpen(false)}
      />

      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-72 bg-brand-green-900 border-r border-brand-green-900 transform transition-transform duration-300 ease-in-out lg:translate-x-0 flex flex-col",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between h-20 px-5 border-b border-white/10">
          <Brand compact light />
          <button onClick={() => setIsOpen(false)} className="lg:hidden text-white/70 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setIsOpen(false)}
              className={({ isActive }) => {
                const [caminho, query] = item.path.split('?');
                const aba = query ? new URLSearchParams(query).get('aba') : null;
                const ativo = aba ? pathname === caminho && abaAtual === aba : isActive;
                return cn(
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
                  ativo
                    ? "bg-green-500/20 text-white font-semibold shadow-sm"
                    : "text-white/75 hover:bg-white/10 hover:text-white"
                );
              }}
            >
              <item.icon size={19} className="shrink-0" />
              {item.name}
            </NavLink>
          ))}
        </div>

        <div className="p-4 mt-auto">
          {!modoAdmin && (
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
                isActive
                  ? "bg-white/15 text-white"
                  : "text-white/75 hover:bg-white/10 hover:text-white"
              )
            }
          >
            <Settings size={19} />
            Configurações
          </NavLink>
          )}

          {isAdmin === true && (
            <button
              type="button"
              onClick={() => { limparModo(); window.location.replace('/'); }}
              className="mt-1 w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/75 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Repeat size={19} />
              Trocar modo ({modoAdmin ? 'admin' : 'usuário'})
            </button>
          )}

          <button
            type="button"
            onClick={() => { setIsOpen(false); void signOut(); }}
            className="mt-1 w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-white/75 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut size={19} />
            Sair
          </button>

          <div className="mt-4 px-4 py-3 rounded-2xl bg-white/10 border border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border-2 border-white/20 shadow">
                {userSettings.avatarUrl ? (
                  <img src={userSettings.avatarUrl} alt={fullName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">
                    {initials}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{fullName}</p>
                <p className="text-xs text-white/65 truncate">{userSettings.email}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
