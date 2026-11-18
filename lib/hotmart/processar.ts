// Regras de processamento de eventos da Hotmart: idempotencia, ordem e convite.
// Modulo puro: sem imports de arquivos do projeto (tipos redeclarados estruturalmente).

type StatusAssinatura = 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente';

type EventoHotmart = {
  tipo: string;
  produtoId: string;
  transacao: string;
  assinanteCodigo: string | null;
  email: string;
  nome: string;
  buyer: Record<string, unknown>;
  criadoEm: Date | null;
  proximaCobranca: Date | null;
  aprovadoEm: Date | null;
  plano: string | null;
};

type Efeito = { status: StatusAssinatura; enviarConvite: boolean } | null;

// O handler calcula o telefone a partir de `buyer` antes de chamar.
export type EventoComTelefone = EventoHotmart & { telefone: string | null };

export type Deps = {
  // true = evento novo; false = ja visto.
  registrarEvento(chave: string, e: EventoHotmart): Promise<boolean>;
  // Desfaz o registro de um evento, para a retentativa da Hotmart ser reprocessada.
  liberarEvento(chave: string): Promise<void>;
  buscarAssinatura(
    codigo: string,
  ): Promise<{ id: string; ultimoEventoEm: Date | null; conviteEnviadoEm: Date | null } | null>;
  // ultimoEventoEm null = sem marcador de ordem.
  // CONTRATO DA IMPLEMENTACAO REAL: deve ser um UPSERT CONDICIONAL, que so aplica
  // se `ultimo_evento_em IS NULL OR ultimo_evento_em <= novo`, e nunca sobrescreve
  // um marcador existente com null. O modulo puro le o marcador e grava em passos
  // separados, entao eventos DIFERENTES da mesma assinatura em paralelo so ficam
  // na ordem certa se a gravacao for condicional (Task 5).
  gravarAssinatura(dados: {
    codigo: string;
    status: string;
    vencimento: Date | null;
    ultimoEventoEm: Date | null;
    email: string;
    nome: string;
    telefone: string | null;
    plano: string | null;
  }): Promise<void>;
  convidar(dados: { email: string; nome: string; telefone: string | null }): Promise<void>;
  marcarConvite(codigo: string, erro: string | null): Promise<void>;
};

export type Resultado = { resultado: 'duplicado' | 'antigo' | 'processado'; convidou: boolean };

export function chaveEvento(e: EventoHotmart): string {
  return `${e.transacao}:${e.tipo}`;
}

export async function processarEvento(
  deps: Deps,
  e: EventoComTelefone,
  efeito: NonNullable<Efeito>,
  // Calculado pelo chamador (o handler usa calcularVencimento de eventos.ts).
  vencimento: Date | null,
): Promise<Resultado> {
  const chave = chaveEvento(e);
  if (!(await deps.registrarEvento(chave, e))) {
    return { resultado: 'duplicado', convidou: false };
  }

  // Qualquer falha depois do registro libera o evento (a retentativa da Hotmart
  // precisa ser reprocessada) e relanca o erro original.
  try {
    return await aplicar(deps, e, efeito, vencimento);
  } catch (erro) {
    try {
      await deps.liberarEvento(chave);
    } catch {
      // nao mascara o erro original
    }
    throw erro;
  }
}

async function aplicar(
  deps: Deps,
  e: EventoComTelefone,
  efeito: NonNullable<Efeito>,
  vencimento: Date | null,
): Promise<Resultado> {
  // Sem assinanteCodigo, a propria transacao identifica a assinatura.
  const codigo = e.assinanteCodigo ?? e.transacao;
  const atual = await deps.buscarAssinatura(codigo);
  const marcador = atual?.ultimoEventoEm ?? null;

  // Evento sem criadoEm nao tem ordenacao: nunca e antigo e nao mexe no marcador.
  if (e.criadoEm && marcador && e.criadoEm < marcador) {
    return { resultado: 'antigo', convidou: false };
  }

  await deps.gravarAssinatura({
    codigo,
    status: efeito.status,
    vencimento,
    ultimoEventoEm: e.criadoEm ?? marcador,
    email: e.email,
    nome: e.nome,
    telefone: e.telefone,
    plano: e.plano,
  });

  if (!efeito.enviarConvite || atual?.conviteEnviadoEm) {
    return { resultado: 'processado', convidou: false };
  }

  try {
    await deps.convidar({ email: e.email, nome: e.nome, telefone: e.telefone });
  } catch (erro) {
    // Registra o erro no convite sem mascarar o original; o evento e liberado pelo chamador.
    try {
      await deps.marcarConvite(codigo, erro instanceof Error ? erro.message : String(erro));
    } catch {
      // ignorado de proposito
    }
    throw erro;
  }
  // Convite ja enviado: falhar ao marcar NAO libera o evento (liberar causaria convite
  // duplicado) e nao relanca; so avisa.
  try {
    await deps.marcarConvite(codigo, null);
  } catch {
    console.warn('hotmart: convite enviado, mas falhou ao registrar o envio');
  }
  return { resultado: 'processado', convidou: true };
}
