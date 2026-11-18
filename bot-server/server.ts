// LEGADO (decisão B2): canal Baileys/QR code. O único canal oficial é a API da Meta (api/whatsapp/meta.ts). Não evoluir; remover só com aprovação do dono.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { timingSafeEqual } from 'node:crypto';
import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys';
import { useSupabaseAuthState } from './supabaseAuth';
import { createClient } from '@supabase/supabase-js';

const app = express();

// ─── Configuração obrigatória (falha ao subir se faltar) ─────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const expectedSecret = process.env.BOT_SECRET_TOKEN;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem ser configuradas nas variáveis de ambiente.');
}
if (!expectedSecret) {
  throw new Error('BOT_SECRET_TOKEN deve ser configurado nas variáveis de ambiente.');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── CORS: apenas origens listadas em ALLOWED_ORIGINS ────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Chamadas servidor-a-servidor (sem Origin) passam e dependem do segredo.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);
app.use(express.json({ limit: '100kb' }));

// ─── Autenticação por segredo (fail-closed, tempo constante) ─────────────────
const verifyBotSecret = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const header = req.headers['x-bot-secret'];
  if (typeof header === 'string') {
    const a = Buffer.from(header);
    const b = Buffer.from(expectedSecret);
    if (a.length === b.length && timingSafeEqual(a, b)) return next();
  }
  return res.status(401).json({ error: 'Não autorizado.' });
};

// Mapa de sockets ativos por instance_id
const activeSockets: Record<string, ReturnType<typeof makeWASocket>> = {};
// Instâncias encerradas de propósito (não reconectar)
const encerradas = new Set<string>();
const tentativas: Record<string, number> = {};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Rotas públicas mínimas ──────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ status: 'online' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ─── Socket com reconexão e backoff ──────────────────────────────────────────
async function iniciarSocket(
  instanceId: string,
  onPrimeiroEstado?: (payload: Record<string, unknown>) => void
) {
  const { state, saveCreds } = await useSupabaseAuthState(`session-${instanceId}`);

  const sock = makeWASocket({
    auth: state,
    browser: ['WhatsApp Fin', 'Chrome', '1.0.0'],
  });

  activeSockets[instanceId] = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      await supabase
        .from('whatsapp_instances')
        .update({ qr_code: qr, status: 'QR_CODE_READY' })
        .eq('id', instanceId);
      onPrimeiroEstado?.({ status: 'QR_CODE_READY', qr });
    }

    if (connection === 'open') {
      tentativas[instanceId] = 0;
      const userPhone = sock.user?.id?.split(':')[0] || null;
      await supabase
        .from('whatsapp_instances')
        .update({ status: 'CONNECTED', phone_number: userPhone, qr_code: null })
        .eq('id', instanceId);
      onPrimeiroEstado?.({ status: 'CONNECTED', phone_number: userPhone });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const deslogado = statusCode === DisconnectReason.loggedOut;
      delete activeSockets[instanceId];

      if (deslogado || encerradas.has(instanceId)) {
        await supabase
          .from('whatsapp_instances')
          .update({ status: 'DISCONNECTED', qr_code: null })
          .eq('id', instanceId);
        return;
      }

      // restartRequired (515) e quedas de rede: reconecta com backoff.
      const n = (tentativas[instanceId] = (tentativas[instanceId] || 0) + 1);
      if (n > 8) {
        await supabase
          .from('whatsapp_instances')
          .update({ status: 'DISCONNECTED', qr_code: null })
          .eq('id', instanceId);
        return;
      }
      const espera = statusCode === DisconnectReason.restartRequired ? 500 : Math.min(30000, 1000 * 2 ** n);
      setTimeout(() => {
        iniciarSocket(instanceId).catch((e) => console.error('[reconexão] falhou:', e?.name));
      }, espera);
    }
  });
}

// ─── Gera QR Code e conecta a instância ─────────────────────────────────────
app.post('/connect', verifyBotSecret, async (req, res) => {
  const { instance_id, user_id } = req.body || {};
  if (typeof instance_id !== 'string' || !UUID_RE.test(instance_id)) {
    return res.status(400).json({ error: 'instance_id inválido.' });
  }
  if (typeof user_id !== 'string' || !UUID_RE.test(user_id)) {
    return res.status(400).json({ error: 'user_id inválido.' });
  }

  try {
    // A instância precisa existir e pertencer ao usuário informado (a API já autenticou o usuário).
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id, user_id')
      .eq('id', instance_id)
      .maybeSingle();

    if (!instance || instance.user_id !== user_id) {
      return res.status(404).json({ error: 'Instância não encontrada.' });
    }

    // Evita dois sockets para a mesma instância.
    const existente = activeSockets[instance_id];
    if (existente) {
      encerradas.add(instance_id);
      try { existente.end(undefined); } catch { /* ignora */ }
      delete activeSockets[instance_id];
    }
    encerradas.delete(instance_id);
    tentativas[instance_id] = 0;

    await supabase
      .from('whatsapp_instances')
      .update({ status: 'CONNECTING', qr_code: null })
      .eq('id', instance_id);

    let respondido = false;
    const responder = (payload: Record<string, unknown>) => {
      if (respondido) return;
      respondido = true;
      res.status(200).json(payload);
    };

    await iniciarSocket(instance_id, responder);

    setTimeout(() => {
      responder({ status: 'CONNECTING', message: 'Aguardando inicialização do QR Code...' });
    }, 10000);
  } catch (err: any) {
    console.error('[ERRO CONNECT]:', err?.name);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Falha ao inicializar WhatsApp.' });
    }
  }
});

// ─── Encerra sessão ─────────────────────────────────────────────────────────
app.delete('/instance/:id', verifyBotSecret, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'id inválido.' });

  encerradas.add(id);
  const sock = activeSockets[id];
  if (sock) {
    try {
      await sock.logout();
    } catch { /* ignora */ }
    delete activeSockets[id];
  }

  await supabase
    .from('whatsapp_instances')
    .update({ status: 'DISCONNECTED', qr_code: null })
    .eq('id', id);

  res.json({ message: 'Instância desconectada com sucesso.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`WhatsApp Bot Server rodando na porta ${PORT}`);
});
