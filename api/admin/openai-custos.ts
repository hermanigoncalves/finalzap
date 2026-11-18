import { aplicarCors } from '../../lib/serverEnv';
import { exigirAdmin, lerCredencial } from '../../lib/admin/credenciais';

/** Gasto real do mês na OpenAI (Costs API, exige Admin Key). Somente administrador. */
export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = await exigirAdmin(req, res);
    if (!supabase) return;

    const chave = await lerCredencial(supabase, 'OPENAI_ADMIN_KEY');
    if (!chave) return res.status(500).json({ error: 'Chave admin da OpenAI não configurada.' });

    const agora = new Date();
    const inicio = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1) / 1000;
    const resposta = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${inicio}&bucket_width=1d&limit=31`,
      { headers: { Authorization: `Bearer ${chave}` } },
    );
    const json: any = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      console.error('[openai-custos] OpenAI respondeu', resposta.status);
      return res.status(502).json({ error: json?.error?.message || 'A OpenAI recusou a consulta.' });
    }

    let total = 0;
    let moeda = 'usd';
    for (const bucket of json?.data ?? []) {
      for (const r of bucket?.results ?? []) {
        total += Number(r?.amount?.value) || 0;
        moeda = r?.amount?.currency || moeda;
      }
    }
    return res.status(200).json({ total: Math.round(total * 1e4) / 1e4, moeda });
  } catch (e: any) {
    console.error('[openai-custos] falha:', e?.name);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
