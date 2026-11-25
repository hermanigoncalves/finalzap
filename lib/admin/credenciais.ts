import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateJwtAuth } from '../auth/jwtAuth';
import { clienteServico } from '../serverEnv';

export const CHAVES_CREDENCIAL = ['OPENAI_ADMIN_KEY', 'WAHA_URL', 'WAHA_API_KEY', 'WAHA_WEBHOOK_SECRET', 'WAHA_WEBHOOK_URL'] as const;
export type ChaveCredencial = (typeof CHAVES_CREDENCIAL)[number];

const PREFIXO_ENC = 'enc:v1:';

function obterChaveCripto(): Buffer | null {
  const segredo = process.env.CREDENCIAIS_ENCRYPTION_KEY;
  if (!segredo) return null;
  return createHash('sha256').update(segredo, 'utf8').digest();
}

export function cifrarValor(valor: string): string {
  if (!valor) return valor;
  const chave = obterChaveCripto();
  if (!chave) return valor;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIXO_ENC}${iv.toString('base64')}:${tag.toString('base64')}:${cifrado.toString('base64')}`;
}

export function decifrarValor(valor: string): string {
  if (!valor.startsWith(PREFIXO_ENC)) return valor;
  const chave = obterChaveCripto();
  if (!chave) return valor;
  const partes = valor.slice(PREFIXO_ENC.length).split(':');
  if (partes.length !== 3) throw new Error('Credencial cifrada em formato inválido.');
  const [ivB64, tagB64, dadosB64] = partes;
  const decipher = createDecipheriv('aes-256-gcm', chave, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dadosB64, 'base64')), decipher.final()]).toString('utf8');
}

export async function lerCredencial(supabase: SupabaseClient, chave: ChaveCredencial): Promise<string | undefined> {
  const { data } = await supabase.from('credenciais_servico').select('valor').eq('chave', chave).maybeSingle();
  const bruto = data?.valor || process.env[chave];
  return bruto ? decifrarValor(bruto) : undefined;
}

export async function exigirAdmin(req: any, res: any): Promise<SupabaseClient | null> {
  const auth = await validateJwtAuth(req);
  if (!auth.user) {
    res.status(auth.statusCode).json({ error: auth.error });
    return null;
  }
  // O papel é lido do banco com a chave de serviço, nunca do navegador.
  const supabase = clienteServico();
  const { data: perfil, error: erroPerfil } = await supabase.from('perfis').select('role').eq('auth_id', auth.user.id).maybeSingle();
  if (erroPerfil) {
    console.error('[exigirAdmin] falha ao ler perfis:', erroPerfil.message);
    res.status(500).json({ error: 'Falha ao verificar permissão de administrador.' });
    return null;
  }
  if (perfil?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso negado.' });
    return null;
  }
  return supabase;
}
