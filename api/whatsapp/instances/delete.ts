// LEGADO (decisão B2): canal Baileys/QR code. O único canal oficial é a API da Meta (api/whatsapp/meta.ts). Não evoluir; remover só com aprovação do dono.
import { validateJwtAuth } from '../../../lib/auth/jwtAuth';
import { aplicarCors, clienteServico } from '../../../lib/serverEnv';

export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'DELETE, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

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

    // Exclui APENAS se pertencer ao usuário autenticado.
    const { data: deleted, error } = await supabase
      .from('whatsapp_instances')
      .delete()
      .eq('id', instance_id)
      .eq('user_id', auth.user.id)
      .select('id');

    if (error) {
      console.error('[delete] erro do banco:', error.code);
      return res.status(500).json({ error: 'Não foi possível remover a instância.' });
    }
    if (!deleted || deleted.length === 0) {
      return res.status(404).json({ error: 'Instância não encontrada.' });
    }

    // Remove a sessão salva (credenciais Baileys).
    await supabase.from('whatsapp_sessions').delete().eq('session_id', `session-${instance_id}`);

    return res.status(200).json({ success: true, message: 'Instância removida com sucesso.' });
  } catch (e: any) {
    console.error('[delete] falha:', e?.code || e?.name);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
