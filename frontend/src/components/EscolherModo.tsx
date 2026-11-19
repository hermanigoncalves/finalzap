import { ShieldCheck, User, ChevronRight, LogOut } from 'lucide-react';
import Brand from './Brand';
import type { ModoAcesso } from '../lib/modoAcesso';

const opcoes = [
  {
    modo: 'admin' as const,
    titulo: 'Administrador',
    texto: 'Assinaturas, uso de tokens e custos do negócio.',
    icon: ShieldCheck,
  },
  {
    modo: 'usuario' as const,
    titulo: 'Usuário',
    texto: 'Suas finanças pessoais: transações, contas e orçamento.',
    icon: User,
  },
];

export default function EscolherModo({
  nome,
  aoEscolher,
  aoSair,
}: {
  nome?: string | null;
  aoEscolher: (m: ModoAcesso) => void;
  aoSair: () => void;
}) {
  return (
    <div className="min-h-screen bg-brand-green-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Brand light />
        </div>

        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-white font-semibold text-xl">
            Olá{nome ? `, ${nome.split(' ')[0]}` : ''}!
          </h1>
          <p className="text-sm text-white/70 mt-1 mb-5">Como você quer entrar hoje?</p>

          <div className="space-y-3">
            {opcoes.map(({ modo, titulo, texto, icon: Icon }) => (
              <button
                key={modo}
                type="button"
                onClick={() => aoEscolher(modo)}
                className="group w-full flex items-center gap-4 text-left p-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 hover:border-green-400/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <span className="shrink-0 w-11 h-11 rounded-lg bg-green-500/20 text-green-300 flex items-center justify-center">
                  <Icon size={22} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-white font-semibold text-sm">Entrar como {titulo.toLowerCase()}</span>
                  <span className="block text-xs text-white/65 mt-0.5">{texto}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-white/40 group-hover:text-white transition-colors" />
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={aoSair}
          className="mx-auto mt-5 flex items-center gap-2 text-sm text-white/65 hover:text-white transition-colors cursor-pointer"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </div>
  );
}
