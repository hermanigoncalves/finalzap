import { clienteServico, segredoConfere } from '../../lib/serverEnv';
import { assinaturaValida, extrairCobrancas, custoDaCobranca, lerTarifas } from '../../lib/whatsapp/meta';

// Precisamos do corpo CRU para validar a assinatura da Meta.
export const config = { api: { bodyParser: false } };

async function lerCorpoCru(req: any): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    const buf = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    total += buf.length;
    if (total > 1_000_000) throw new Error('corpo grande demais');
    partes.push(buf);
  }
  return Buffer.concat(partes).toString('utf8');
}

/**
 * Webhook da WhatsApp Cloud API (Meta).
 *  GET  -> verificação do webhook (hub.verify_token / hub.challenge)
 *  POST -> eventos de status; cada mensagem cobrada vira uma linha em uso_servico.
 */
export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const { 'hub.mode': modo, 'hub.verify_token': token, 'hub.challenge': desafio } = req.query || {};
    if (modo === 'subscribe' && segredoConfere(token, process.env.META_VERIFY_TOKEN) && typeof desafio === 'string') {
      return res.status(200).send(desafio);
    }
    return res.status(403).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.META_APP_SECRET) {
    console.error('[meta] META_APP_SECRET ausente');
    return res.status(500).json({ error: 'Servidor mal configurado.' });
  }

  let corpo: string;
  try {
    corpo = await lerCorpoCru(req);
  } catch {
    return res.status(413).json({ error: 'Corpo inválido.' });
  }

  if (!assinaturaValida(corpo, req.headers['x-hub-signature-256'], process.env.META_APP_SECRET)) {
    return res.status(401).json({ error: 'Assinatura inválida.' });
  }

  let payload: any;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return res.status(400).json({ error: 'JSON inválido.' });
  }

  const cobrancas = extrairCobrancas(payload);
  if (cobrancas.length === 0) return res.status(200).json({ ok: true, registrados: 0 });

  try {
    const supabase = clienteServico();
    const tarifas = lerTarifas(process.env.META_TARIFAS_USD);
    const cot = Number(process.env.USD_BRL);
    const cotacao = Number.isFinite(cot) && cot > 0 ? cot : 5.5;

    const linhas = cobrancas.map((c) => {
      const { custoUsd, custoBrl } = custoDaCobranca(c.categoria, tarifas, cotacao);
      return {
        telefone: c.telefone,
        servico: 'whatsapp',
        modelo: c.modelo,
        mensagens_enviadas: 1,
        custo_usd: custoUsd,
        custo_brl: custoBrl,
        referencia: c.referencia,
      };
    });

    // referencia é única: reenvios da Meta não duplicam a cobrança.
    const { error } = await supabase
      .from('uso_servico')
      .upsert(linhas, { onConflict: 'referencia', ignoreDuplicates: true });

    if (error) {
      console.error('[meta] erro do banco:', error.code);
      // 500 faz a Meta reenviar; a referência única evita duplicar.
      return res.status(500).json({ error: 'Erro ao registrar uso.' });
    }
    return res.status(200).json({ ok: true, registrados: linhas.length });
  } catch (e: any) {
    console.error('[meta] falha:', e?.name);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
