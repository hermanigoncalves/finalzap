// Logica do webhook da Hotmart. Modulo puro: sem imports de arquivos do projeto;
// os colaboradores chegam injetados em `ctx` (o endpoint monta o ctx com os modulos reais).
// Nunca incluir e-mail, telefone, token ou detalhes de excecao em respostas ou logs.

export type RequisicaoWebhook = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

export type RespostaWebhook = { status: number; corpo: Record<string, unknown> };

type EventoLido = { tipo: string; produtoId: string; buyer: Record<string, unknown> };

export type ContextoWebhook = {
  tokenValido(recebido: string | string[] | undefined, esperado: string | undefined): boolean;
  lerWebhook(corpo: unknown): EventoLido | null;
  mapearEvento(tipo: string): unknown | null;
  calcularVencimento(e: any): Date | null;
  telefoneDoComprador(buyer: Record<string, unknown> | undefined): string | null;
  processarEvento(deps: any, e: any, efeito: any, vencimento: Date | null): Promise<unknown>;
  produtoId: string;
  hottokEsperado: string | undefined;
  // Chamada so depois das verificacoes baratas; pode lancar (vira 500 generico).
  criarDeps(): any;
  // Logger opcional; so recebe campos fixos, nunca PII, token, message ou stack.
  log?(nivel: 'warn' | 'error', dados: Record<string, string | undefined>): void;
};

export async function tratarWebhook(
  req: RequisicaoWebhook,
  ctx: ContextoWebhook,
): Promise<RespostaWebhook> {
  if (req.method !== 'POST') return { status: 405, corpo: { erro: 'método não permitido' } };

  // Segredo ausente nunca autoriza (tokenValido tambem recusa). Corpo nao e tocado antes.
  if (!ctx.hottokEsperado) {
    ctx.log?.('warn', { etapa: 'autenticar', motivo: 'HOTMART_HOTTOK nao configurado' });
    return { status: 401, corpo: { erro: 'não autorizado' } };
  }
  if (!ctx.tokenValido(req.headers['x-hotmart-hottok'], ctx.hottokEsperado)) {
    return { status: 401, corpo: { erro: 'não autorizado' } };
  }

  let tipo: string | undefined;
  try {
    // So aqui (apos o token) o corpo e acessado; o getter pode lancar (JSON invalido).
    let corpoBruto: unknown;
    try {
      corpoBruto = req.body;
    } catch {
      return { status: 200, corpo: { ignorado: 'corpo' } };
    }
    const evento = ctx.lerWebhook(corpoBruto);
    if (!evento) return { status: 200, corpo: { ignorado: 'corpo' } };
    if (evento.produtoId !== ctx.produtoId) return { status: 200, corpo: { ignorado: 'produto' } };

    tipo = evento.tipo;
    const efeito = ctx.mapearEvento(evento.tipo);
    if (!efeito) return { status: 200, corpo: { ignorado: 'evento' } };

    const resultado = await ctx.processarEvento(
      ctx.criarDeps(),
      { ...evento, telefone: ctx.telefoneDoComprador(evento.buyer) },
      efeito,
      ctx.calcularVencimento(evento),
    );
    return { status: 200, corpo: { resultado } };
  } catch (e) {
    ctx.log?.('error', {
      etapa: 'processar',
      tipo,
      erro: e instanceof Error ? e.name : 'desconhecido',
    });
    return { status: 500, corpo: { erro: 'falha ao processar' } };
  }
}
