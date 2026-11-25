import { aplicarCors } from '../../lib/serverEnv';
import { exigirAdmin, lerCredencial } from '../../lib/admin/credenciais';

const SESSAO = 'default'; // sessão fixa; o WAHA aceita várias, mas só usamos uma
const ACOES: Record<string, string> = { start: 'start', stop: 'stop', logout: 'logout' };

/** GET: status + QR Code da sessão no WAHA. POST { acao }: start/stop/logout. Só admin. */
export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = await exigirAdmin(req, res);
    if (!supabase) return;

    const base = (await lerCredencial(supabase, 'WAHA_URL'))?.replace(/\/+$/, '');
    const chave = await lerCredencial(supabase, 'WAHA_API_KEY');
    if (!base || !chave || !/^https?:\/\//.test(base)) {
      return res.status(400).json({ error: 'Configure a URL e a chave do WAHA primeiro.' });
    }

    const waha = (caminho: string, init: RequestInit = {}) =>
      fetch(`${base}${caminho}`, {
        ...init,
        headers: { 'X-Api-Key': chave, Accept: 'application/json', ...init.headers },
        signal: AbortSignal.timeout(10_000),
      });

    if (req.method === 'POST' && req.body?.acao === 'webhook') {
      const url = String(req.body?.url ?? '').trim();
      if (!/^https:\/\/[^\s]+$/.test(url)) return res.status(400).json({ error: 'Informe a URL https do webhook do n8n.' });
      const segredoWebhook = (await lerCredencial(supabase, 'WAHA_WEBHOOK_SECRET')) || chave;
      const atual = await waha(`/api/sessions/${SESSAO}`);
      if (!atual.ok) return res.status(502).json({ error: `WAHA respondeu ${atual.status}.` });
      const config = {
        ...((await atual.json()).config ?? {}),
        webhooks: [{ url, events: ['message'], customHeaders: [{ name: 'X-Api-Key', value: segredoWebhook }] }],
      };
      const r = await waha(`/api/sessions/${SESSAO}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: SESSAO, config }),
      });
      if (!r.ok) return res.status(502).json({ error: `WAHA respondeu ${r.status}.` });
    } else if (req.method === 'POST') {
      const acao = ACOES[req.body?.acao];
      if (!acao) return res.status(400).json({ error: 'Ação inválida.' });
      const r = await waha(`/api/sessions/${SESSAO}/${acao}`, { method: 'POST' });
      if (!r.ok && r.status !== 422) return res.status(502).json({ error: `WAHA respondeu ${r.status}.` });
    }

    const rs = await waha(`/api/sessions/${SESSAO}`);
    if (rs.status === 401 || rs.status === 403) return res.status(502).json({ error: 'Chave do WAHA recusada.' });
    if (rs.status === 404) return res.status(200).json({ status: 'STOPPED', me: null, qr: null });
    if (!rs.ok) return res.status(502).json({ error: `WAHA respondeu ${rs.status}.` });
    const sessao = await rs.json();

    let qr: string | null = null;
    if (sessao.status === 'SCAN_QR_CODE') {
      const rq = await waha(`/api/${SESSAO}/auth/qr`);
      if (rq.ok) {
        const j = await rq.json().catch(() => null);
        if (j?.data) qr = `data:${j.mimetype || 'image/png'};base64,${j.data}`;
      }
    }
    return res.status(200).json({ status: sessao.status, me: sessao.me ?? null, qr });
  } catch (e: any) {
    console.error('[waha] falha:', e?.name);
    return res.status(502).json({ error: 'Não foi possível falar com o WAHA.' });
  }
}
