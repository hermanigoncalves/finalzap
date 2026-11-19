import { aplicarCors } from '../../lib/serverEnv';
import { exigirAdmin, lerCredencial } from '../../lib/admin/credenciais';
import { intervaloDoMes, montarUrlPricing, lerPricingAnalytics } from '../../lib/whatsapp/metaMetricas';

/** Custo real do mês na Meta (pricing_analytics). Somente administrador. */
export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = await exigirAdmin(req, res);
    if (!supabase) return;

    const [token, wabaId] = await Promise.all([
      lerCredencial(supabase, 'META_ACCESS_TOKEN'),
      lerCredencial(supabase, 'META_WABA_ID'),
    ]);
    if (!token || !wabaId) {
      return res.status(500).json({ error: 'Token e ID da conta da Meta não configurados.' });
    }

    const { inicio, fim } = intervaloDoMes(new Date());
    const url = montarUrlPricing(wabaId, inicio, fim, process.env.META_GRAPH_VERSION || 'v21.0');
    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
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
