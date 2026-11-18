import { validateJwtAuth } from '../../lib/auth/jwtAuth';
import { aplicarCors, clienteServico } from '../../lib/serverEnv';
import { intervaloDoMes, montarUrlPricing, lerPricingAnalytics } from '../../lib/whatsapp/metaMetricas';

/** Custo real do mês na Meta (pricing_analytics). Somente administrador. */
export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await validateJwtAuth(req);
  if (!auth.user) return res.status(auth.statusCode).json({ error: auth.error });

  const token = process.env.META_ACCESS_TOKEN;
  const wabaId = process.env.META_WABA_ID;
  if (!token || !wabaId) {
    return res.status(500).json({ error: 'META_ACCESS_TOKEN e META_WABA_ID não configurados.' });
  }

  try {
    // O papel é lido do banco com a chave de serviço, nunca do navegador.
    const supabase = clienteServico();
    const { data: perfil } = await supabase
      .from('perfis')
      .select('role')
      .eq('auth_id', auth.user.id)
      .maybeSingle();
    if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });

    const { inicio, fim } = intervaloDoMes(new Date());
    const url = montarUrlPricing(wabaId, inicio, fim, process.env.META_GRAPH_VERSION || 'v21.0');
    const resposta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json: any = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      // Mensagem da Meta ajuda a diagnosticar (permissão, token expirado); não contém o token.
      console.error('[metricas] Meta respondeu', resposta.status, json?.error?.code);
      return res.status(502).json({ error: json?.error?.message || 'A Meta recusou a consulta.' });
    }

    return res.status(200).json({ linhas: lerPricingAnalytics(json) });
  } catch (e: any) {
    console.error('[metricas] falha:', e?.name);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
