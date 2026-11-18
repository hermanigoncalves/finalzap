// WhatsApp Cloud API (Meta): validação do webhook e cobrança por mensagem.
// Módulo puro (sem imports relativos) para ser testável com node --test.
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Tarifa em USD por mensagem cobrada, por categoria (Brasil).
 * CONFIRA os valores atuais em developers.facebook.com/docs/whatsapp/pricing
 * e, se mudarem, sobrescreva com a env META_TARIFAS_USD, ex.:
 *   {"marketing":0.0625,"utility":0.0068,"authentication":0.0315}
 */
export const TARIFAS_PADRAO_USD: Record<string, number> = {
  marketing: 0.0625,
  utility: 0.0068,
  authentication: 0.0315,
  service: 0,
};

export function lerTarifas(envJson: string | undefined): Record<string, number> {
  if (!envJson) return TARIFAS_PADRAO_USD;
  try {
    const obj = JSON.parse(envJson);
    const out: Record<string, number> = { ...TARIFAS_PADRAO_USD };
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k.toLowerCase()] = v;
    }
    return out;
  } catch {
    return TARIFAS_PADRAO_USD;
  }
}

/** Confere o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") sobre o corpo CRU. */
export function assinaturaValida(corpoCru: string, cabecalho: unknown, appSecret: string | undefined): boolean {
  if (!appSecret || typeof cabecalho !== 'string' || !cabecalho.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', appSecret).update(corpoCru).digest('hex');
  const recebido = cabecalho.slice('sha256='.length);
  const a = Buffer.from(recebido, 'hex');
  const b = Buffer.from(esperado, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export interface Cobranca {
  /** id da mensagem + status: chave de idempotência (a Meta reenvia webhooks). */
  referencia: string;
  telefone: string;
  categoria: string;
  modelo: string;
}

/** Extrai as mensagens cobráveis do payload. Conta só o status "sent" (1 por mensagem). */
export function extrairCobrancas(payload: any): Cobranca[] {
  const out: Cobranca[] = [];
  const entradas = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entrada of entradas) {
    const mudancas = Array.isArray(entrada?.changes) ? entrada.changes : [];
    for (const mudanca of mudancas) {
      const statuses = Array.isArray(mudanca?.value?.statuses) ? mudanca.value.statuses : [];
      for (const st of statuses) {
        if (st?.status !== 'sent') continue;
        const preco = st?.pricing;
        if (!preco || preco.billable !== true) continue;
        if (typeof st.id !== 'string' || !st.id) continue;
        const categoria = String(preco.category || 'desconhecida').toLowerCase().slice(0, 40);
        out.push({
          referencia: `meta:${st.id}:sent`,
          telefone: String(st.recipient_id || 'desconhecido').slice(0, 30),
          categoria,
          modelo: `meta-${categoria}`,
        });
      }
    }
  }
  return out;
}

export function custoDaCobranca(
  categoria: string,
  tarifas: Record<string, number>,
  cotacao: number
): { custoUsd: number; custoBrl: number } {
  const usd = tarifas[categoria] ?? 0;
  return {
    custoUsd: Math.round(usd * 1e6) / 1e6,
    custoBrl: Math.round(usd * cotacao * 1e4) / 1e4,
  };
}
