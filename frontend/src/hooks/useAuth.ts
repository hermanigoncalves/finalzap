import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import { limparCachePerfil } from '../lib/financeService';
import { limparModo } from '../lib/modoAcesso';
import { resetarSincronizacaoUsuario } from '../lib/sincronizacaoUsuario';

const STORE_KEY = 'finance-store';
const OWNER_KEY = 'finance-store-owner';

try {
  localStorage.removeItem('whatsapp_fin_mock_user');
} catch {
  // ignore
}

function garantirDonoDoCache(userId: string | null): boolean {
  try {
    const dono = localStorage.getItem(OWNER_KEY);
    if (!userId) return false;
    if (dono === userId) return false;
    const tinhaCache = localStorage.getItem(STORE_KEY) !== null;
    localStorage.removeItem(STORE_KEY);
    localStorage.setItem(OWNER_KEY, userId);
    return tinhaCache;
  } catch {
    return false;
  }
}

function limparCache() {
  limparCachePerfil();
  limparModo();
  resetarSincronizacaoUsuario();
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // ignore
  }
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),

  signIn: async (email, password) => {
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.data.session) {
      if (garantirDonoDoCache(result.data.user?.id ?? null)) {
        window.location.reload();
      }
      set({ user: result.data.user, session: result.data.session, loading: false });
    }
    return result;
  },

  signUp: async (email, password) => {
    const result = await supabase.auth.signUp({ email, password });
    if (result.data.session) {
      if (garantirDonoDoCache(result.data.user?.id ?? null)) {
        window.location.reload();
      }
      set({ user: result.data.user, session: result.data.session, loading: false });
    }
    return result;
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: 'select_account' } },
    });
    return { error };
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    limparCache();
    set({ user: null, session: null, loading: false });
    window.location.replace('/');
  },
}));

if (typeof window !== 'undefined') {
  const aplicar = (session: Session | null) => {
    if (!session?.user) {
      limparCache();
    } else if (garantirDonoDoCache(session.user.id)) {
      window.location.reload();
      return;
    }
    useAuthStore.setState({
      session: session ?? null,
      user: session?.user ?? null,
      loading: false,
    });
  };

  supabase.auth.getSession().then(({ data: { session } }) => aplicar(session));
  supabase.auth.onAuthStateChange((_event, session) => aplicar(session));
}

export function useAuth() {
  return useAuthStore();
}
