import { tokenValido } from '../../lib/hotmart/hottok';
import { telefoneDoComprador } from '../../lib/hotmart/telefone';
import {
  lerWebhook,
  mapearEvento,
  calcularVencimento,
  PRODUTO_ID,
} from '../../lib/hotmart/eventos';
import { processarEvento } from '../../lib/hotmart/processar';
import { tratarWebhook } from '../../lib/hotmart/webhook';
import { criarClienteAdmin, criarDepsHotmart } from '../../lib/supabaseAdmin';

// Sem CORS: so a Hotmart (servidor a servidor) chama este endpoint.
export default async function handler(req: any, res: any) {
  const { status, corpo } = await tratarWebhook(
    {
      method: req.method,
      headers: req.headers ?? {},
      // Getter: o parse do corpo so acontece depois da checagem do token.
      get body() {
        return req.body;
      },
    },
    {
      tokenValido,
      lerWebhook,
      mapearEvento: (tipo: string) => mapearEvento(tipo),
      calcularVencimento,
      telefoneDoComprador,
      processarEvento,
      // Sobrescrevível para testar com o produto sandbox da Hotmart (id 0) sem mexer no código.
      produtoId: process.env.HOTMART_PRODUTO_ID || PRODUTO_ID,
      hottokEsperado: process.env.HOTMART_HOTTOK,
      log: (nivel: 'warn' | 'error', dados: Record<string, string | undefined>) =>
        console[nivel]('hotmart-webhook', dados),
      criarDeps: () => {
        const appUrl = process.env.APP_URL;
        if (!appUrl) throw new Error('APP_URL ausente');
        return criarDepsHotmart(criarClienteAdmin(), appUrl);
      },
    },
  );
  res.status(status).json(corpo);
}
