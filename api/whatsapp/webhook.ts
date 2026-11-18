import { analisarMensagemFinanceira } from '../../lib/financeiro/analisador';
import { clienteServico, segredoConfere } from '../../lib/serverEnv';

/**
 * Webhook interno (servidor a servidor): texto financeiro -> OpenAI -> RPC registrar_movimentacao.
 * O canal de entrada oficial é a API da Meta tratada no n8n; este endpoint só grava por telefone.
 * Sem CORS: não é chamado por navegador. Segredo obrigatório (falha fechado).
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BOT_SECRET_TOKEN) {
    console.error('[webhook] BOT_SECRET_TOKEN ausente');
    return res.status(500).json({ error: 'Servidor mal configurado.' });
  }
  if (!segredoConfere(req.headers['x-bot-secret'], process.env.BOT_SECRET_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized webhook invocation' });
  }

  const { message, text, telefone, message_id } = req.body || {};
  const rawText = message || text;

  if (!rawText || typeof rawText !== 'string' || rawText.length > 2000) {
    return res.status(400).json({ error: 'Campo de texto da mensagem é obrigatório (até 2000 caracteres).' });
  }
  if (typeof telefone !== 'string' || !telefone.trim()) {
    return res.status(400).json({ error: 'Campo telefone é obrigatório.' });
  }

  try {
    const supabase = clienteServico();
    const telefoneUso = telefone.slice(0, 30);

    // Assinatura ativa (vencimento nulo conta como ativa) antes de gastar tokens da OpenAI.
    const { data: ativa, error: errAss } = await supabase.rpc('verificar_assinatura_ativa', { p_telefone: telefone });
    if (errAss) {
      console.error('[webhook] erro ao verificar assinatura:', errAss.code);
      return res.status(500).json({ error: 'Erro ao verificar a assinatura.' });
    }
    if (ativa !== true) return res.status(403).json({ error: 'Assinatura inativa.' });

    const transacao = await analisarMensagemFinanceira(rawText, async (uso) => {
      await supabase.from('uso_servico').insert({
        telefone: telefoneUso,
        servico: 'openai',
        modelo: uso.modelo,
        tokens_entrada: uso.tokensEntrada,
        tokens_saida: uso.tokensSaida,
        mensagens_recebidas: 1,
        custo_usd: uso.custoUsd,
        custo_brl: uso.custoBrl,
      });
    });

    // O telefone é normalizado e a idempotência tratada pela RPC (message_id = id da mensagem da Meta).
    const { data, error } = await supabase.rpc('registrar_movimentacao', {
      p_telefone: telefone,
      p_tipo: transacao.tipo,
      p_valor: transacao.valor,
      p_categoria: transacao.categoria,
      p_descricao: transacao.descricao,
      p_idempotency_key: typeof message_id === 'string' && message_id ? `wa:${message_id.slice(0, 200)}` : null,
      p_fonte: 'whatsapp',
    });

    if (error) {
      console.error('[webhook] erro do banco:', error.code);
      return res.status(500).json({ error: 'Erro ao salvar a movimentação.' });
    }
    if (data?.success === false) return res.status(400).json({ error: data.message });

    return res.status(200).json({ success: true, movimentacao: data, transacao });
  } catch (error: any) {
    console.error('[webhook] falha no processamento:', error?.name);
    // Mensagem sem valor é erro do remetente (422); qualquer outra falha é nossa (500, para o chamador retentar).
    if (error?.name === 'MensagemInvalida') {
      return res.status(422).json({ error: 'Não foi possível interpretar a mensagem financeira.' });
    }
    return res.status(500).json({ error: 'Erro ao processar a mensagem.' });
  }
}
