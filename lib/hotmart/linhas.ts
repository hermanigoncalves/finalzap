// Funções puras que montam linhas e decidem erros para os adaptadores do Supabase.

export type DadosAssinatura = {
  codigo: string;
  status: string;
  vencimento: Date | null;
  ultimoEventoEm: Date | null;
  email: string;
  nome: string;
  telefone: string | null;
  plano: string | null;
};

export const ERRO_TELEFONE_VINCULADO = 'Telefone já vinculado a outra conta';
export const ERRO_SEM_TELEFONE = 'Compra sem telefone brasileiro válido: perfil não criado';

export function normalizarPlano(nome: string | null): 'Mensal' | 'Anual' | null {
  if (nome === null) return null;
  return /anual|annual|year/i.test(nome) ? 'Anual' : 'Mensal';
}

export function linhaNovaAssinatura(d: DadosAssinatura): Record<string, unknown> {
  return {
    hotmart_assinante_codigo: d.codigo,
    telefone: d.telefone,
    nome: d.nome,
    email: d.email,
    plano: normalizarPlano(d.plano) ?? 'Mensal',
    status: d.status,
    data_vencimento: d.vencimento ? d.vencimento.toISOString() : null,
    ultimo_evento_em: d.ultimoEventoEm ? d.ultimoEventoEm.toISOString() : null,
  };
}

export function atualizacaoAssinatura(d: DadosAssinatura): Record<string, unknown> {
  const campos: Record<string, unknown> = { status: d.status, email: d.email };
  if (d.nome) campos.nome = d.nome;
  if (d.telefone !== null) campos.telefone = d.telefone;
  if (d.plano !== null) campos.plano = normalizarPlano(d.plano);
  if (d.vencimento) campos.data_vencimento = d.vencimento.toISOString();
  if (d.ultimoEventoEm) campos.ultimo_evento_em = d.ultimoEventoEm.toISOString();
  return campos;
}

export function filtroOrdem(ultimoEventoEm: Date): string {
  return `ultimo_evento_em.is.null,ultimo_evento_em.lte.${ultimoEventoEm.toISOString()}`;
}

const CAMPOS_SENSIVEIS_PESSOA = new Set(['document', 'documents', 'checkout_phone', 'address']);

function mascararEmail(email: string): string {
  const idx = email.indexOf('@');
  if (idx <= 0) return '***';
  const local = email.slice(0, idx);
  const dominio = email.slice(idx + 1);
  if (!dominio) return '***';
  const iniciais = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${iniciais}***@${dominio}`;
}

function minimizarPessoa(valor: unknown): unknown {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return valor;
  const copia: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (CAMPOS_SENSIVEIS_PESSOA.has(k)) continue;
    copia[k] = k === 'email' && typeof v === 'string' ? mascararEmail(v) : v;
  }
  return copia;
}

function sanitizarPayloadEvento(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  if (typeof p.email === 'string') p.email = mascararEmail(p.email);
  if (p.buyer !== undefined) p.buyer = minimizarPessoa(p.buyer);
  if (p.subscriber !== undefined) p.subscriber = minimizarPessoa(p.subscriber);
  if (p.data && typeof p.data === 'object' && !Array.isArray(p.data)) {
    const d: Record<string, unknown> = { ...(p.data as Record<string, unknown>) };
    if (d.buyer !== undefined) d.buyer = minimizarPessoa(d.buyer);
    if (d.subscriber !== undefined) d.subscriber = minimizarPessoa(d.subscriber);
    p.data = d;
  }
  return p;
}

export function linhaEvento(
  chave: string,
  e: { tipo: string; transacao: string; assinanteCodigo: string | null },
  payload: unknown,
): Record<string, unknown> {
  return {
    chave,
    tipo: e.tipo,
    transacao: e.transacao,
    assinante_codigo: e.assinanteCodigo,
    payload: sanitizarPayloadEvento(payload),
  };
}

export function violacaoUnica(erro: { code?: string } | null | undefined): boolean {
  return erro?.code === '23505';
}

export function usuarioJaCadastrado(
  erro: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!erro) return false;
  if (erro.code === 'email_exists' || erro.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists/i.test(erro.message ?? '');
}

export function truncarErro(mensagem: string, max = 300): string {
  return mensagem.length > max ? mensagem.slice(0, max) : mensagem;
}

export function erroSeguro(
  prefixo: string,
  erro: { code?: string; status?: number } | null | undefined,
): string {
  return `${prefixo} (${erro?.code ?? erro?.status ?? 'desconhecido'})`;
}

export async function gravarAssinaturaCondicional(
  db: { from(tabela: string): any },
  d: DadosAssinatura,
): Promise<void> {
  const ins = await db.from('assinaturas').upsert(linhaNovaAssinatura(d), {
    onConflict: 'hotmart_assinante_codigo',
    ignoreDuplicates: true,
  });
  if (ins.error) throw new Error(erroSeguro('Falha ao criar assinatura', ins.error));

  let upd = db
    .from('assinaturas')
    .update(atualizacaoAssinatura(d))
    .eq('hotmart_assinante_codigo', d.codigo);
  upd = d.ultimoEventoEm
    ? upd.or(filtroOrdem(d.ultimoEventoEm))
    : upd.is('ultimo_evento_em', null);
  const { error } = await upd;
  if (error) throw new Error(erroSeguro('Falha ao atualizar assinatura', error));
}
