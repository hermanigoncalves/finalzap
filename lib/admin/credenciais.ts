import type { SupabaseClient } from '@supabase/supabase-js';
import { validateJwtAuth } from '../auth/jwtAuth';
import { clienteServico } from '../serverEnv';

export const CHAVES_CREDENCIAL = ['META_ACCESS_TOKEN', 'META_WABA_ID', 'OPENAI_ADMIN_KEY'] as const;
export type ChaveCredencial = (typeof CHAVES_CREDENCIAL)[number];

/** Valor salvo no painel; sem ele, cai na variável de ambiente de mesmo nome. */
export async function lerCredencial(supabase: SupabaseClient, chave: ChaveCredencial): Promise<string | undefined> {
  const { data } = await supabase.from('credenciais_servico').select('valor').eq('chave', chave).maybeSingle();
  return data?.valor || process.env[chave] || undefined;
}

/** Autentica o JWT e confere o papel admin no banco. Responde 401/403 e devolve null se falhar. */
export async function exigirAdmin(req: any, res: any): Promise<SupabaseClient | null> {
  const auth = await validateJwtAuth(req);
  if (!auth.user) {
    res.status(auth.statusCode).json({ error: auth.error });
    return null;
  }
  // O papel é lido do banco com a chave de serviço, nunca do navegador.
  const supabase = clienteServico();
  const { data: perfil } = await supabase.from('perfis').select('role').eq('auth_id', auth.user.id).maybeSingle();
  if (perfil?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso negado.' });
    return null;
  }
  return supabase;
}
