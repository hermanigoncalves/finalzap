// Funcoes puras (sem imports) que montam linhas e decidem erros para os adaptadores
// do Supabase. Ficam separadas para serem testaveis sem rede.

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

// Mensagem fixa, sem dados pessoais, gravada em assinaturas.convite_erro.
export const ERRO_TELEFONE_VINCULADO = 'Telefone já vinculado a outra conta';
export const ERRO_SEM_TELEFONE = 'Compra sem telefone brasileiro válido: perfil não criado';

// assinaturas.plano só aceita 'Mensal' ou 'Anual'; a Hotmart manda o nome livre do plano.
export function normalizarPlano(nome: string | null): 'Mensal' | 'Anual' | null {
  if (nome === null) return null;
  return /anual|annual|year/i.test(nome) ? 'Anual' : 'Mensal';
}

// Linha completa para criar a assinatura. Sem telefone gravamos NULL (nunca '').
// Exige assinaturas.telefone NULLABLE no banco (unicidade por indice parcial WHERE telefone IS NOT NULL).
// Regra de acesso (SQL verificar_assinatura_ativa): status 'Ativo' com data_vencimento NULL conta como ativa.
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

// Campos a atualizar numa assinatura existente. Valores desconhecidos (null) sao
// omitidos: nunca apagam dado existente, em especial `ultimo_evento_em`.
export function atualizacaoAssinatura(d: DadosAssinatura): Record<string, unknown> {
  const campos: Record<string, unknown> = { status: d.status, email: d.email };
  if (d.nome) campos.nome = d.nome;
  if (d.telefone !== null) campos.telefone = d.telefone;
  if (d.plano !== null) campos.plano = normalizarPlano(d.plano);
  if (d.vencimento) campos.data_vencimento = d.vencimento.toISOString();
  if (d.ultimoEventoEm) campos.ultimo_evento_em = d.ultimoEventoEm.toISOString();
  return campos;
}

// Filtro PostgREST: so aplica se nao ha marcador ou ele e <= ao novo.
export function filtroOrdem(ultimoEventoEm: Date): string {
  return `ultimo_evento_em.is.null,ultimo_evento_em.lte.${ultimoEventoEm.toISOString()}`;
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
    payload,
  };
}

export function violacaoUnica(erro: { code?: string } | null | undefined): boolean {
  return erro?.code === '23505';
}

// O Auth devolve email_exists / user_already_exists (422); versoes antigas so a mensagem.
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

// Mensagem de erro SEM `message`/`details` (podem conter e-mail ou telefone do cliente):
// so o codigo (ou status HTTP) do erro.
export function erroSeguro(
  prefixo: string,
  erro: { code?: string; status?: number } | null | undefined,
): string {
  return `${prefixo} (${erro?.code ?? erro?.status ?? 'desconhecido'})`;
}

// Upsert condicional: cria se nao existe; atualiza SO se o marcador da linha for nulo ou
// <= ao novo. Sem marcador novo, so atualiza linha cujo marcador tambem e nulo (nunca
// roda update sem condicao). `db` e o SupabaseClient (tipado estruturalmente).
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
