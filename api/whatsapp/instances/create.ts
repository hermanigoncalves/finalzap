// LEGADO (decisão B2): canal Baileys/QR code. O único canal oficial é a API da Meta (api/whatsapp/meta.ts). Não evoluir; remover só com aprovação do dono.
import { validateJwtAuth } from '../../../lib/auth/jwtAuth';
import { aplicarCors, clienteServico } from '../../../lib/serverEnv';

export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await validateJwtAuth(req);
  if (!auth.user) {
    return res.status(auth.statusCode).json({ error: auth.error });
  }

  const { name, phone_number } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'O nome da instância é obrigatório.' });
  }

  try {
    const supabase = clienteServico();
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .insert([{
        name: name.trim().slice(0, 100),
        phone_number: phone_number ? String(phone_number).trim().slice(0, 30) : null,
        user_id: auth.user.id,
        status: 'DISCONNECTED',
      }])
      .select()
      .single();

    if (error) {
      console.error('[create] erro do banco:', error.code);
      return res.status(500).json({ error: 'Não foi possível criar a instância.' });
    }
    return res.status(200).json(data);
  } catch (e: any) {
    console.error('[create] falha:', e?.code || e?.name);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
