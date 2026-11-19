import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// Número do FinalZap no WhatsApp (só dígitos, com DDI). Opcional: sem ele mostramos só o código.
const NUMERO_WHATSAPP = (import.meta.env.VITE_WHATSAPP_NUMERO as string | undefined)?.replace(/\D/g, '');

type Estado =
  | { fase: 'carregando' }
  | { fase: 'codigo'; codigo: string }
  | { fase: 'erro'; mensagem: string };

// Compra sem telefone: o cliente manda o código, do próprio WhatsApp, para o número do FinalZap.
// O n8n confirma o número e cria o perfil; aqui só esperamos o vínculo aparecer.
export default function VincularWhatsApp({ aoVincular }: { aoVincular: () => void }) {
  const { signOut } = useAuth();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    supabase.rpc('gerar_codigo_vinculo').then(({ data, error }) => {
      if (!ativo) return;
      if (error || !data) return setEstado({ fase: 'erro', mensagem: 'Não foi possível gerar o código. Tente de novo.' });
      if (data.ja_vinculado) return aoVincular();
      if (!data.success) return setEstado({ fase: 'erro', mensagem: String(data.mensagem) });
      setEstado({ fase: 'codigo', codigo: String(data.codigo) });
    });
    return () => { ativo = false; };
  }, [tentativa, aoVincular]);

  // Enquanto o código está na tela, confere a cada 5 s se o WhatsApp já foi vinculado.
  const codigo = estado.fase === 'codigo' ? estado.codigo : null;
  useEffect(() => {
    if (!codigo) return;
    const id = setInterval(aoVincular, 5000);
    return () => clearInterval(id);
  }, [codigo, aoVincular]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900 p-6">
      <div className="max-w-md w-full text-center space-y-5 text-slate-200">
        <h1 className="text-xl font-bold text-white">Vincule o seu WhatsApp</h1>

        {estado.fase === 'carregando' && (
          <div className="mx-auto w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        )}

        {estado.fase === 'codigo' && (
          <>
            <p className="text-sm text-slate-400">
              Envie o código abaixo, <strong>do WhatsApp que você vai usar</strong>, para o número do FinalZap.
              Ele vale por 30 minutos.
            </p>
            <div className="rounded-xl bg-slate-800 py-4 text-2xl font-mono tracking-widest text-green-400 select-all">
              {estado.codigo}
            </div>
            {NUMERO_WHATSAPP && (
              <a
                href={`https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(estado.codigo)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block px-5 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium"
              >
                Abrir WhatsApp com o código
              </a>
            )}
            <p className="text-xs text-slate-500">Esta tela atualiza sozinha quando o vínculo for confirmado.</p>
          </>
        )}

        {estado.fase === 'erro' && (
          <>
            <p className="text-sm text-slate-400">{estado.mensagem}</p>
            <button onClick={() => { setEstado({ fase: 'carregando' }); setTentativa((n) => n + 1); }} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">
              Tentar de novo
            </button>
          </>
        )}

        <div>
          <button onClick={signOut} className="text-xs text-slate-500 underline">Sair</button>
        </div>
      </div>
    </div>
  );
}
