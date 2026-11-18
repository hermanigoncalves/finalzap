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

  const botServerUrl = process.env.BOT_SERVER_URL;
  const botSecretToken = process.env.BOT_SECRET_TOKEN;
  if (!botServerUrl || !botSecretToken) {
    console.error('[connect] BOT_SERVER_URL/BOT_SECRET_TOKEN ausentes');
    return res.status(500).json({ error: 'Servidor mal configurado.' });
  }

  const { instance_id } = req.body || {};
  if (!instance_id || typeof instance_id !== 'string') {
    return res.status(400).json({ error: 'instance_id é obrigatório.' });
  }

  try {
    const supabase = clienteServico();

    // A instância precisa existir E pertencer ao usuário autenticado (sem exceções).
    const { data: instance, error: fetchError } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .eq('id', instance_id)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (fetchError || !instance) {
      return res.status(404).json({ error: 'Instância não encontrada.' });
    }

    const response = await fetch(`${botServerUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': botSecretToken },
      body: JSON.stringify({ instance_id, user_id: auth.user.id }),
    });

    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (e: any) {
    console.error('[connect] falha:', e?.code || e?.name);
    return res.status(502).json({ error: 'Servidor de WhatsApp indisponível.' });
  }
}
