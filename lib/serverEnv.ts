import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

/** Cliente com chave de serviço. Nunca tem fallback: se faltar env, falha. */
export function clienteServico(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias no servidor.');
  }
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Compara segredos em tempo constante. Falha fechado se algum lado for vazio. */
export function segredoConfere(recebido: unknown, esperado: string | undefined): boolean {
  if (!esperado || typeof recebido !== 'string' || recebido.length === 0) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * CORS com lista fixa de origens (ALLOWED_ORIGINS, separadas por vírgula).
 * Sem a env, nenhuma origem de navegador é liberada.
 */
export function aplicarCors(req: any, res: any, metodos: string, cabecalhos = 'Content-Type, Authorization'): void {
  const permitidas = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origem = req.headers?.origin;
  if (origem && permitidas.includes(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', metodos);
  res.setHeader('Access-Control-Allow-Headers', cabecalhos);
}
