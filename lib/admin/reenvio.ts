// Reenvio do convite pelo admin. Modulo puro: sem imports de arquivos do projeto;
// os colaboradores chegam injetados em `ctx`. Nunca incluir e-mail, token ou detalhes
// de excecao em respostas ou logs. Nao usa jwtAuth nem token de demonstracao.

const DIA_MS = 24 * 60 * 60 * 1000;

export function decidirReenvio(
  a: { status: string; dataVencimento: Date | null },
  agora: Date,
  toleranciaDias: number,
): { ok: true } | { ok: false; motivo: string } {
  if (a.status === 'Cancelado') return { ok: false, motivo: 'Assinatura cancelada' };
  if (a.status === 'Inadimplente') return { ok: false, motivo: 'Assinatura inadimplente' };
  if (a.status !== 'Ativo') return { ok: false, motivo: 'Assinatura inativa' };
  if (a.dataVencimento) {
    const limite = a.dataVencimento.getTime() + toleranciaDias * DIA_MS;
    if (agora.getTime() > limite) return { ok: false, motivo: 'Assinatura vencida' };
  }
  return { ok: true };
}

export type RequisicaoReenvio = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

export type RespostaReenvio = { status: number; corpo: Record<string, unknown> };

export type AssinaturaReenvio = {
  id: string;
  status: string;
  dataVencimento: Date | null;
  email: string;
};

export type ContextoReenvio = {
  validarToken(token: string): Promise<{ id: string } | null>;
  // Le perfis.role do banco com a chave de servico; nunca confiar em dados do navegador.
  papelDoUsuario(userId: string): Promise<string | null>;
  buscarAssinatura(id: string): Promise<AssinaturaReenvio | null>;
  enviarEmail(a: { id: string; email: string }): Promise<'convite' | 'redefinicao'>;
  registrarReenvio(assinaturaId: string, adminId: string): Promise<void>;
  agora(): Date;
  toleranciaDias: number;
  // So recebe campos fixos, nunca PII, token, message ou stack.
  log?(nivel: 'warn' | 'error', dados: Record<string, string | undefined>): void;
};

function tokenBearer(h: string | string[] | undefined): string | null {
  const v = Array.isArray(h) ? h[0] : h;
  if (typeof v !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(v.trim());
  return m ? m[1] : null;
}

export async function tratarReenvio(
  req: RequisicaoReenvio,
  ctx: ContextoReenvio,
): Promise<RespostaReenvio> {
  if (req.method !== 'POST') return { status: 405, corpo: { erro: 'método não permitido' } };

  const naoAutenticado = { status: 401, corpo: { erro: 'não autenticado' } };
  const token = tokenBearer(req.headers['authorization']);
  if (!token) return naoAutenticado;

  let adminId: string;
  try {
    const usuario = await ctx.validarToken(token);
    if (!usuario || typeof usuario.id !== 'string' || !usuario.id) return naoAutenticado;
    adminId = usuario.id;
  } catch {
    return naoAutenticado;
  }

  // Mesma resposta para papel diferente de admin, ausente ou falha de consulta.
  try {
    if ((await ctx.papelDoUsuario(adminId)) !== 'admin') {
      return { status: 403, corpo: { erro: 'acesso negado' } };
    }
  } catch {
    return { status: 403, corpo: { erro: 'acesso negado' } };
  }

  // So aqui (apos autenticar e autorizar) o corpo e acessado; o getter pode lancar.
  let assinaturaId: string;
  try {
    const corpo = req.body as { assinaturaId?: unknown } | null | undefined;
    const id = corpo && typeof corpo === 'object' ? corpo.assinaturaId : undefined;
    if (typeof id !== 'string' || !id) throw new Error('corpo');
    assinaturaId = id;
  } catch {
    return { status: 400, corpo: { erro: 'requisição inválida' } };
  }

  let etapa = 'buscar';
  try {
    const assinatura = await ctx.buscarAssinatura(assinaturaId);
    if (!assinatura) return { status: 404, corpo: { erro: 'assinatura não encontrada' } };

    const decisao = decidirReenvio(assinatura, ctx.agora(), ctx.toleranciaDias);
    if ('motivo' in decisao) return { status: 409, corpo: { erro: decisao.motivo } };

    etapa = 'enviar';
    const tipo = await ctx.enviarEmail({ id: assinatura.id, email: assinatura.email });
    etapa = 'registrar';
    await ctx.registrarReenvio(assinatura.id, adminId);
    return { status: 200, corpo: { ok: true, tipo } };
  } catch (e) {
    ctx.log?.('error', { etapa, erro: e instanceof Error ? e.name : 'desconhecido' });
    return { status: 500, corpo: { erro: 'falha ao reenviar' } };
  }
}
