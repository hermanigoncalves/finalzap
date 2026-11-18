// LEGADO (decisão B2): canal Baileys/QR code. O único canal oficial é a API da Meta (api/whatsapp/meta.ts). Não evoluir; remover só com aprovação do dono.
import { validateJwtAuth } from '../../../lib/auth/jwtAuth';
import { aplicarCors, clienteServico } from '../../../lib/serverEnv';

export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await validateJwtAuth(req);
  if (!auth.user) {
    return res.status(auth.statusCode).json({ error: auth.error });
  }

  const { instance_id } = req.query;
  if (!instance_id || typeof instance_id !== 'string') {
    return res.status(400).json({ error: 'instance_id é obrigatório.' });
  }

  try {
    const supabase = clienteServico();
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .select('id, name, status, phone_number, qr_code, updated_at')
      .eq('id', instance_id)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'Instância não encontrada.' });
    }
    return res.status(200).json(data);
  } catch (e: any) {
    console.error('[status] falha:', e?.code || e?.name);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
