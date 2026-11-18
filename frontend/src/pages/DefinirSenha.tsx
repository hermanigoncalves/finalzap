import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { validarSenha } from '../lib/senha';
import Brand from '../components/Brand';

const TEMPO_ESPERA_SESSAO_MS = 10000;

type Estado = 'aguardando' | 'pronto' | 'invalido';

const inputClass =
  'w-full px-3 py-2.5 rounded-lg bg-white/10 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-green-500';

export default function DefinirSenha() {
  const navigate = useNavigate();
  const [estado, setEstado]         = useState<Estado>('aguardando');
  const [senha, setSenha]           = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro]             = useState('');
  const [enviando, setEnviando]     = useState(false);
  const senhaRef = useRef<HTMLInputElement>(null);

  // O supabase-js troca os tokens do link por uma sessão temporária; aguardamos por ela.
  useEffect(() => {
    let ativo = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (ativo && sessao) setEstado('pronto');
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (ativo && session) setEstado('pronto');
    });
    // Última chance antes de declarar o link inválido: a troca do token pode ter só demorado.
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!ativo) return;
      setEstado((atual) => (atual === 'aguardando' ? (session ? 'pronto' : 'invalido') : atual));
    }, TEMPO_ESPERA_SESSAO_MS);
    return () => {
      ativo = false;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (estado === 'pronto') senhaRef.current?.focus();
  }, [estado]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const mensagem = validarSenha(senha, confirmacao);
    if (mensagem) {
      setErro(mensagem);
      return;
    }
    setErro('');
    setEnviando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) {
        setErro('Não foi possível definir a senha. Tente novamente ou peça um novo convite ao suporte.');
        return;
      }
      navigate('/', { replace: true });
    } catch {
      setErro('Não foi possível definir a senha. Tente novamente ou peça um novo convite ao suporte.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-green-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3 text-center">
          <Brand light />
        </div>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-white font-semibold text-lg mb-5">Definir senha</h1>

          {estado === 'aguardando' && (
            <div className="flex justify-center py-4" role="status" aria-label="Verificando o link">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {estado === 'invalido' && (
            <p role="alert" className="text-red-400 text-sm bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2 leading-relaxed">
              Link inválido ou expirado. Peça um novo convite ao suporte.
            </p>
          )}

          {estado === 'pronto' && (
            <form onSubmit={enviar} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor="nova-senha" className="text-sm text-slate-300 font-medium">Nova senha</label>
                <input
                  id="nova-senha" ref={senhaRef} type="password" autoComplete="new-password" required
                  value={senha} onChange={(e) => setSenha(e.target.value)}
                  aria-describedby={erro ? 'erro-senha' : undefined}
                  className={inputClass}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirmar-senha" className="text-sm text-slate-300 font-medium">Confirmar senha</label>
                <input
                  id="confirmar-senha" type="password" autoComplete="new-password" required
                  value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)}
                  aria-describedby={erro ? 'erro-senha' : undefined}
                  className={inputClass}
                />
              </div>

              {erro && (
                <p id="erro-senha" role="alert" className="text-red-400 text-xs bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2 leading-relaxed">
                  {erro}
                </p>
              )}

              <button
                type="submit" disabled={enviando}
                className="w-full py-2.5 rounded-lg bg-green-500 hover:bg-green-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-900/30 cursor-pointer"
              >
                {enviando ? 'Aguarde...' : 'Definir senha e entrar'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
