import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import Brand from '../components/Brand';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode]             = useState<'signin' | 'signup'>('signin');
  const [email, setEmail]           = useState('');
  const [password, setPass]         = useState('');
  const [error, setError]           = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading]       = useState(false);

  const translateError = (msg: string) => {
    if (msg.includes('Invalid login credentials')) {
      return 'E-mail ou senha incorretos. Se ainda não possui cadastro, clique em "Criar conta" abaixo.';
    }
    if (msg.includes('Email not confirmed')) {
      return 'E-mail não confirmado. Por favor, verifique sua caixa de entrada.';
    }
    if (msg.includes('User already registered')) {
      return 'Este e-mail já está cadastrado. Alterne para "Entrar" e informe sua senha.';
    }
    if (msg.includes('Password should be at least')) {
      return 'A senha deve ter pelo menos 8 caracteres.';
    }
    return msg;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) setError(translateError(error.message));
      } else {
        const { data, error } = await signUp(email, password);
        if (error) {
          setError(translateError(error.message));
        } else if (data?.user && !data.session) {
          setSuccessMsg('Conta criada com sucesso! Verifique seu e-mail para confirmar ou faça login se a confirmação estiver desativada.');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? translateError(err.message) : 'Erro ao processar autenticação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-green-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-3 text-center">
          <Brand light />
          <p className="text-xs font-semibold tracking-wide text-white/75">ASSISTENTE FINANCEIRO NO WHATSAPP</p>
          <p className="text-sm text-white/90">Organize. Controle. Planeje. Evolua.</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl">
          <h2 className="text-white font-semibold text-lg mb-5">
            {mode === 'signin' ? 'Entrar na conta' : 'Criar conta'}
          </h2>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-slate-300 font-medium">E-mail</label>
              <input
                type="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-3 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm text-slate-300 font-medium">Senha</label>
              <input
                type="password" required minLength={8}
                value={password} onChange={e => setPass(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2 leading-relaxed">{error}</p>
            )}

            {successMsg && (
              <p className="text-emerald-300 text-xs bg-emerald-900/30 border border-emerald-500/30 rounded-lg px-3 py-2 leading-relaxed">{successMsg}</p>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg bg-green-500 hover:bg-green-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-900/30 cursor-pointer"
            >
              {loading ? 'Aguarde...' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-400 mt-5">
            {mode === 'signin' ? 'Não tem conta?' : 'Já tem conta?'}{' '}
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setSuccessMsg(''); }}
              className="text-green-400 hover:text-green-300 font-medium cursor-pointer"
            >
              {mode === 'signin' ? 'Criar conta' : 'Entrar'}
            </button>
          </p>
        </div>

        {mode === 'signup' && (
          <p className="text-center text-xs text-slate-500 mt-4">
            Após cadastro, você poderá entrar diretamente ou confirmar via e-mail.
          </p>
        )}
      </div>
    </div>
  );
}
