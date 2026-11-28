import { supabase } from './supabase';
import { hojeISO, mesAtual, somarDias, vencimentosMensais } from './datas';
import { chamarMarcarContaPaga, type ResultadoContaPaga } from './contaPaga';

export type TipoMovimentacao = 'receita' | 'despesa';

export interface Movimentacao {
  id: string;
  telefone: string;
  tipo: TipoMovimentacao;
  valor: number;
  moeda: string;
  categoria: string;
  descricao: string;
  data: string;
  mes: string;
  fonte: string;
  idempotency_key?: string;
  created_at: string;
  updated_at: string;
}

export interface Orcamento {
  id: string;
  telefone: string;
  categoria: string;
  limite_mensal: number;
  mes?: string;
  created_at: string;
  updated_at: string;
}

export interface ContaAPagar {
  id: string;
  telefone: string;
  descricao: string;
  valor: number;
  categoria: string;
  vencimento: string;
  status: 'pendente' | 'paga' | 'cancelada';
  pago_em?: string;
  movimentacao_id?: string;
  lembrete_enviado_em?: string;
  created_at: string;
  updated_at: string;
}

export interface LancamentoRecorrente {
  id: string;
  telefone: string;
  tipo: TipoMovimentacao;
  valor: number;
  categoria: string;
  descricao: string;
  frequencia: 'semanal' | 'quinzenal' | 'mensal' | 'anual';
  proxima_execucao: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResumoMensal {
  mes: string;
  totalReceitas: number;
  totalDespesas: number;
  saldo: number;
}

const MOEDA_PADRAO = 'BRL';

function validarValor(valor: number): void {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('Valor inválido. Informe um número maior que zero.');
  }
}

let perfilEmCache: { userId: string; promessa: Promise<PerfilUsuario | null> } | null = null;

export function limparCachePerfil(): void {
  perfilEmCache = null;
}

export function atualizarCachePerfil(userId: string, perfil: PerfilUsuario | null): void {
  if (!perfil || !userId) {
    perfilEmCache = null;
    return;
  }
  perfilEmCache = { userId, promessa: Promise.resolve(perfil) };
}

export interface PerfilUsuario {
  id: string;
  auth_id: string | null;
  telefone: string;
  nome: string | null;
  email: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export async function resolverPerfilUsuario(): Promise<PerfilUsuario | null> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (sessionError || !userId) return null;

  if (perfilEmCache?.userId === userId) return perfilEmCache.promessa;

  const promessa = (async () => {
    const { data: perfil, error } = await supabase
      .from('perfis')
      .select('*')
      .eq('auth_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (perfil) return perfil as PerfilUsuario;

    const { data: vinculou } = await supabase.rpc('vincular_perfil_por_email');
    if (vinculou !== true) return null;
    const { data: depois } = await supabase.from('perfis').select('*').eq('auth_id', userId).maybeSingle();
    return (depois ?? null) as PerfilUsuario | null;
  })();
  perfilEmCache = { userId, promessa };
  promessa.then((p) => { if (!p && perfilEmCache?.promessa === promessa) perfilEmCache = null; })
    .catch(() => { if (perfilEmCache?.promessa === promessa) perfilEmCache = null; });
  return promessa;
}

export async function resolverTelefoneUsuario(): Promise<string | null> {
  const perfil = await resolverPerfilUsuario();
  return perfil?.telefone ?? null;
}

export async function atualizarPerfil(dados: { nome: string; email: string }): Promise<boolean> {
  const perfil = await resolverPerfilUsuario();
  if (!perfil) throw new Error('Perfil não encontrado.');
  const email = dados.email.trim();

  let confirmarEmail = false;
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email && user.email.toLowerCase() !== email.toLowerCase()) {
    const { error: errAuth } = await supabase.auth.updateUser({ email });
    if (errAuth) throw errAuth;
    confirmarEmail = true;
  }

  const { data: atualizado, error } = await supabase
    .from('perfis')
    .update({ nome: dados.nome.trim(), email })
    .eq('id', perfil.id)
    .select('*')
    .single();
  if (error) throw error;
  const uid = perfil.auth_id ?? user?.id ?? '';
  if (atualizado && uid) atualizarCachePerfil(uid, atualizado as PerfilUsuario);
  else limparCachePerfil();
  return confirmarEmail;
}

export async function ehUsuarioAdmin(): Promise<boolean> {
  const perfil = await resolverPerfilUsuario();
  return perfil?.role === 'admin';
}

export async function verificarMinhaAssinaturaAtiva(telefone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verificar_assinatura_ativa', { p_telefone: telefone });
  if (error) throw error;
  return data === true;
}

export async function excluirMinhaConta(): Promise<{ ok: boolean; mensagem: string }> {
  const { data, error } = await supabase.rpc('excluir_minha_conta');
  if (error) throw error;
  if (typeof data === 'boolean') {
    return {
      ok: data,
      mensagem: data ? 'Conta e dados excluídos com sucesso.' : 'Não foi possível excluir sua conta.',
    };
  }
  const obj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const ok = typeof obj.ok === 'boolean' ? obj.ok : true;
  return {
    ok,
    mensagem:
      typeof obj.mensagem === 'string' && obj.mensagem
        ? obj.mensagem
        : ok
          ? 'Conta e dados excluídos com sucesso.'
          : 'Não foi possível excluir sua conta.',
  };
}

export interface RegistrarMovimentacaoInput {
  tipo: TipoMovimentacao;
  valor: number;
  categoria: string;
  descricao: string;
  data?: string;
  fonte?: string;
  telefone?: string;
}

export async function registrar_movimentacao(
  input: RegistrarMovimentacaoInput
): Promise<Movimentacao> {
  const telefone = input.telefone || (await resolverTelefoneUsuario());
  if (!telefone) {
    throw new Error('Usuário não identificado. Cadastre seu telefone no perfil.');
  }

  if (input.valor === undefined || input.valor === null) {
    throw new Error('Informe o valor antes de registrar.');
  }
  validarValor(input.valor);

  if (!input.categoria?.trim()) {
    throw new Error('Informe a categoria.');
  }
  if (!input.descricao?.trim()) {
    throw new Error('Informe a descrição.');
  }

  const data = input.data || hojeISO();
  const mes = data.slice(0, 7);
  const fonte = input.fonte || 'painel';
  const idempotencyKey = `${telefone}|${globalThis.crypto.randomUUID()}`;

  const { data: registro, error } = await supabase
    .from('movimentacoes')
    .insert({
      telefone,
      tipo: input.tipo,
      valor: input.valor,
      moeda: MOEDA_PADRAO,
      categoria: input.categoria.trim(),
      descricao: input.descricao.trim(),
      data,
      mes,
      fonte,
      idempotency_key: idempotencyKey,
    })
    .select()
    .single();

  if (error) throw error;
  return registro as Movimentacao;
}

export async function remover_movimentacao(id: string): Promise<void> {
  const telefone = await resolverTelefoneUsuario();
  if (!telefone) throw new Error('Usuário não identificado.');
  const { data, error } = await supabase
    .from('movimentacoes')
    .delete()
    .eq('id', id)
    .eq('telefone', telefone)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Movimentação não encontrada.');
}

export interface ConsultarMovimentacoesFiltro {
  telefone?: string;
  mes?: string;
  tipo?: TipoMovimentacao;
  categoria?: string;
  limite?: number;
}

const PAGINA_MOVIMENTACOES = 1000;

export async function consultar_movimentacoes(
  filtro: ConsultarMovimentacoesFiltro = {}
): Promise<Movimentacao[]> {
  const telefone = filtro.telefone || (await resolverTelefoneUsuario());
  if (!telefone) return [];

  const montar = () => {
    let q = supabase
      .from('movimentacoes')
      .select('*')
      .eq('telefone', telefone)
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id');
    if (filtro.mes) q = q.eq('mes', filtro.mes);
    if (filtro.tipo) q = q.eq('tipo', filtro.tipo);
    if (filtro.categoria) q = q.eq('categoria', filtro.categoria);
    return q;
  };

  if (filtro.limite) {
    const { data, error } = await montar().limit(filtro.limite);
    if (error) throw error;
    return (data || []) as Movimentacao[];
  }

  const todas: Movimentacao[] = [];
  for (let de = 0; ; de += PAGINA_MOVIMENTACOES) {
    const { data, error } = await montar().range(de, de + PAGINA_MOVIMENTACOES - 1);
    if (error) throw error;
    todas.push(...((data || []) as Movimentacao[]));
    if (!data || data.length < PAGINA_MOVIMENTACOES) break;
  }
  return todas;
}

export async function consultar_saldo(
  telefone?: string,
  mes?: string
): Promise<{ saldo: number; totalReceitas: number; totalDespesas: number }> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return { saldo: 0, totalReceitas: 0, totalDespesas: 0 };

  const rows = await consultar_movimentacoes({ telefone: t, mes });
  let receitas = 0;
  let despesas = 0;
  for (const r of rows) {
    if (r.tipo === 'receita') receitas += Number(r.valor);
    else despesas += Number(r.valor);
  }
  return { saldo: receitas - despesas, totalReceitas: receitas, totalDespesas: despesas };
}

export async function consultar_resumo_mensal(
  telefone?: string,
  mes?: string
): Promise<ResumoMensal> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return { mes: mes || mesAtual(), totalReceitas: 0, totalDespesas: 0, saldo: 0 };

  const m = mes || mesAtual();
  const rows = await consultar_movimentacoes({ telefone: t, mes: m });

  let receitas = 0;
  let despesas = 0;
  for (const r of rows) {
    if (r.tipo === 'receita') receitas += Number(r.valor);
    else despesas += Number(r.valor);
  }

  return { mes: m, totalReceitas: receitas, totalDespesas: despesas, saldo: receitas - despesas };
}

export async function consultar_resumo_varios_meses(
  telefone?: string,
  quantidade: number = 6
): Promise<ResumoMensal[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];

  const data = await consultar_movimentacoes({ telefone: t });

  const porMes = new Map<string, { receitas: number; despesas: number }>();
  for (const r of (data || [])) {
    if (!porMes.has(r.mes)) porMes.set(r.mes, { receitas: 0, despesas: 0 });
    const atual = porMes.get(r.mes)!;
    if (r.tipo === 'receita') atual.receitas += Number(r.valor);
    else atual.despesas += Number(r.valor);
  }

  return Array.from(porMes.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, quantidade)
    .map(([mes, v]) => ({
      mes,
      totalReceitas: v.receitas,
      totalDespesas: v.despesas,
      saldo: v.receitas - v.despesas,
    }));
}

export async function consultar_orcamentos(
  telefone?: string,
  categoria?: string,
  mes?: string
): Promise<Orcamento[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];

  let query = supabase.from('orcamentos').select('*').eq('telefone', t);
  if (categoria) query = query.eq('categoria', categoria);
  if (mes) query = query.eq('mes', mes);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Orcamento[];
}

export interface DefinirOrcamentoInput {
  categoria: string;
  limite_mensal: number;
  mes?: string;
  telefone?: string;
}

export async function definir_orcamento(input: DefinirOrcamentoInput): Promise<Orcamento> {
  const telefone = input.telefone || (await resolverTelefoneUsuario());
  if (!telefone) throw new Error('Usuário não identificado.');
  validarValor(input.limite_mensal);
  if (!input.categoria?.trim()) throw new Error('Informe a categoria.');

  const { data, error } = await supabase
    .from('orcamentos')
    .upsert(
      {
        telefone,
        categoria: input.categoria.trim(),
        limite_mensal: input.limite_mensal,
        mes: input.mes || null,
      },
      { onConflict: 'telefone, categoria, mes' }
    )
    .select()
    .single();

  if (error) throw error;
  return data as Orcamento;
}

export async function remover_orcamento(
  categoria: string,
  telefone?: string,
  mes?: string
): Promise<string[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];
  let q = supabase.from('orcamentos').delete().eq('telefone', t).eq('categoria', categoria);
  q = mes ? q.eq('mes', mes) : q.is('mes', null);
  const { data, error } = await q.select('id');
  if (error) throw error;
  return (data ?? []).map((r) => String((r as { id: string }).id));
}

export interface CadastrarContaAPagarInput {
  descricao: string;
  valor: number;
  categoria: string;
  vencimento: string;
  telefone?: string;
}

export async function cadastrar_conta_a_pagar(
  input: CadastrarContaAPagarInput
): Promise<ContaAPagar> {
  const telefone = input.telefone || (await resolverTelefoneUsuario());
  if (!telefone) throw new Error('Usuário não identificado.');
  validarValor(input.valor);
  if (!input.descricao?.trim()) throw new Error('Informe a descrição.');
  if (!input.vencimento) throw new Error('Informe o vencimento.');

  const { data, error } = await supabase
    .from('contas_a_pagar')
    .insert({
      telefone,
      descricao: input.descricao.trim(),
      valor: input.valor,
      categoria: input.categoria.trim() || 'Contas',
      vencimento: input.vencimento,
      status: 'pendente',
    })
    .select()
    .single();

  if (error) throw error;
  return data as ContaAPagar;
}

export async function listar_contas_a_pagar(
  telefone?: string,
  status?: 'pendente' | 'paga' | 'cancelada'
): Promise<ContaAPagar[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];

  let query = supabase.from('contas_a_pagar').select('*').eq('telefone', t);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('vencimento', { ascending: true });
  if (error) throw error;
  return (data || []) as ContaAPagar[];
}

export async function contas_vencendo(
  dias: number = 7,
  telefone?: string
): Promise<ContaAPagar[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];

  const hoje = hojeISO();
  const limite = somarDias(hoje, dias);

  const todas = await listar_contas_a_pagar(t, 'pendente');
  return todas.filter((c) => {
    const d = c.vencimento.slice(0, 10);
    return d >= hoje && d <= limite;
  });
}

export async function marcar_conta_paga(
  contaId: string,
  telefone?: string
): Promise<ResultadoContaPaga> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) throw new Error('Usuário não identificado.');

  return chamarMarcarContaPaga((fn, args) => supabase.rpc(fn, args), contaId, t);
}

export interface DicaEconomia {
  titulo: string;
  texto: string;
  categoria?: string;
  prioridade: 'baixa' | 'media' | 'alta';
}

const DICAS_PADRAO: DicaEconomia[] = [
  {
    titulo: 'Anote todos os gastos, mesmo os pequenos',
    texto: 'Cafés, lanches e compras por impulso somam bastante no final do mês. Registre cada despesa no WhatsApp Fin para ver para onde o dinheiro vai.',
    categoria: 'Alimentação',
    prioridade: 'media',
  },
  {
    titulo: 'Defina um limite por categoria',
    texto: 'Use o orçamento mensal para categorias como Alimentação, Transporte e Lazer. Quando atingir o limite, evite novas compras naquela categoria até o próximo mês.',
    prioridade: 'alta',
  },
  {
    texto: 'Pague contas fixas no dia do vencimento para evitar multas e juros. Ative os lembretes de vencimento nas configurações.',
    titulo: 'Evite atrasos em contas fixas',
    categoria: 'Moradia',
    prioridade: 'alta',
  },
  {
    titulo: 'Compare preços antes de comprar',
    texto: 'Pesquise em mais de um estabelecimento antes de compras maiores. Pequenas diferenças de preço fazem diferença no orçamento anual.',
    prioridade: 'baixa',
  },
  {
    titulo: 'Crie uma reserva de emergência',
    texto: 'Separe uma parte de toda receita para uma reserva. Comece com um valor pequeno e aumente gradualmente. Isso evita endividamento em imprevistos.',
    categoria: 'Renda',
    prioridade: 'alta',
  },
  {
    titulo: 'Revise assinaturas mensais',
    texto: 'Verifique streaming, apps e serviços que você paga todo mês. Cancele os que não usa mais e inclua a economia no orçamento.',
    prioridade: 'media',
  },
];

export function gerar_dicas_economia(
  gastosPorCategoria: Record<string, number>,
  orcamentos: Orcamento[] = []
): DicaEconomia[] {
  const dicas: DicaEconomia[] = [...DICAS_PADRAO];

  for (const orc of orcamentos) {
    const gasto = gastosPorCategoria[orc.categoria] ?? 0;
    if (orc.limite_mensal > 0 && gasto >= orc.limite_mensal) {
      dicas.unshift({
        titulo: `Orçamento de ${orc.categoria} estourou`,
        texto: `Você gastou R$ ${gasto.toFixed(2)} neste mês, acima do limite de R$ ${orc.limite_mensal.toFixed(2)}. Revise os lançamentos de ${orc.categoria} e adie compras não essenciais.`,
        categoria: orc.categoria,
        prioridade: 'alta',
      });
    } else if (orc.limite_mensal > 0 && gasto / orc.limite_mensal >= 0.8) {
      dicas.unshift({
        titulo: `Atenção: ${orc.categoria} próximo do limite`,
        texto: `Você usou ${((gasto / orc.limite_mensal) * 100).toFixed(0)}% do orçamento de ${orc.categoria}.`,
        categoria: orc.categoria,
        prioridade: 'media',
      });
    }
  }

  return dicas.slice(0, 8);
}

const fimDoDiaSP = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59-03:00` : d);

export interface TipoAssinatura {
  id: string;
  telefone: string;
  nome: string;
  email: string;
  hotmart_id: string;
  plano: string;
  status: 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente';
  data_inicio: string;
  data_vencimento: string;
  metodo_pagamento: string;
  created_at: string;
  updated_at: string;
}

export interface CadastrarAssinaturaInput {
  telefone: string;
  nome: string;
  email: string;
  hotmart_id: string;
  plano: string;
  status: 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente';
  data_inicio: string;
  data_vencimento: string;
  metodo_pagamento: string;
}

export interface AtualizarAssinaturaInput {
  nome?: string;
  email?: string;
  hotmart_id?: string;
  plano?: string;
  status?: 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente';
  data_inicio?: string;
  data_vencimento?: string;
  metodo_pagamento?: string;
}

export async function listar_assinaturas(
  telefone?: string
): Promise<TipoAssinatura[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];

  const { data, error } = await supabase
    .from('assinaturas')
    .select('*')
    .eq('telefone', t)
    .order('data_vencimento', { ascending: true });

  if (error) throw error;
  return (data || []) as TipoAssinatura[];
}

export async function listar_todas_assinaturas(): Promise<TipoAssinatura[]> {
  const { data, error } = await supabase
    .from('assinaturas')
    .select('*')
    .order('data_vencimento', { ascending: true });
  if (error) throw error;
  return (data || []) as TipoAssinatura[];
}

export async function cadastrar_assinatura(
  input: CadastrarAssinaturaInput
): Promise<TipoAssinatura> {
  const telefone = input.telefone || (await resolverTelefoneUsuario());
  if (!telefone) throw new Error('Usuário não identificado.');
  if (!input.hotmart_id?.trim()) throw new Error('Informe o ID da Hotmart.');
  if (!input.data_inicio) throw new Error('Informe a data da venda.');
  if (!input.data_vencimento) throw new Error('Informe a data de vencimento/recebimento.');

  const { data, error } = await supabase
    .from('assinaturas')
    .insert({
      telefone,
      nome: input.nome.trim(),
      email: input.email.trim(),
      hotmart_id: input.hotmart_id.trim(),
      plano: input.plano || 'Mensal',
      status: input.status || 'Ativo',
      data_inicio: input.data_inicio,
      data_vencimento: fimDoDiaSP(input.data_vencimento),
      metodo_pagamento: input.metodo_pagamento.trim(),
    })
    .select()
    .single();

  if (error) throw error;
  return data as TipoAssinatura;
}

export async function atualizar_assinatura(
  id: string,
  input: AtualizarAssinaturaInput
): Promise<TipoAssinatura> {
  const updates: Record<string, unknown> = {};
  if (input.nome !== undefined) updates.nome = input.nome.trim();
  if (input.email !== undefined) updates.email = input.email.trim();
  if (input.hotmart_id !== undefined) updates.hotmart_id = input.hotmart_id.trim();
  if (input.plano !== undefined) updates.plano = input.plano;
  if (input.status !== undefined) updates.status = input.status;
  if (input.data_inicio !== undefined) updates.data_inicio = input.data_inicio || null;
  if (input.data_vencimento !== undefined) updates.data_vencimento = input.data_vencimento ? fimDoDiaSP(input.data_vencimento) : null;
  if (input.metodo_pagamento !== undefined)
    updates.metodo_pagamento = input.metodo_pagamento.trim();

  const { data, error } = await supabase
    .from('assinaturas')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as TipoAssinatura;
}

export async function remover_assinatura(id: string): Promise<void> {
  const { error } = await supabase.from('assinaturas').delete().eq('id', id);
  if (error) throw error;
}

export type ServicoUso = 'openai' | 'whatsapp' | 'pluggy' | 'outro';

export interface UsoServico {
  id: string;
  telefone: string;
  servico: ServicoUso;
  modelo?: string;
  tokens_entrada?: number;
  tokens_saida?: number;
  mensagens_enviadas?: number;
  mensagens_recebidas?: number;
  custo_usd?: number;
  custo_brl?: number;
  data: string;
  created_at: string;
}

export interface RegistrarUsoServicoInput {
  servico: ServicoUso;
  modelo?: string;
  tokens_entrada?: number;
  tokens_saida?: number;
  mensagens_enviadas?: number;
  mensagens_recebidas?: number;
  custo_usd?: number;
  custo_brl?: number;
  data?: string;
  telefone?: string;
}

export async function listar_uso_servico(
  telefone?: string,
  servico?: ServicoUso
): Promise<UsoServico[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];

  let query = supabase.from('uso_servico').select('*').eq('telefone', t);
  if (servico) query = query.eq('servico', servico);
  const { data, error } = await query.order('data', { ascending: false });
  if (error) throw error;
  return (data || []) as UsoServico[];
}

export async function listar_todo_uso_servico(inicio: string, fim: string): Promise<UsoServico[]> {
  const { data, error } = await supabase
    .from('uso_servico')
    .select('*')
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []) as UsoServico[];
}

export async function registrar_uso_servico(
  input: RegistrarUsoServicoInput
): Promise<UsoServico> {
  const telefone = input.telefone || (await resolverTelefoneUsuario());
  if (!telefone) throw new Error('Usuário não identificado.');

  const data = input.data || hojeISO();

  const { data: registro, error } = await supabase
    .from('uso_servico')
    .insert({
      telefone,
      servico: input.servico,
      modelo: input.modelo || null,
      tokens_entrada: input.tokens_entrada || 0,
      tokens_saida: input.tokens_saida || 0,
      mensagens_enviadas: input.mensagens_enviadas || 0,
      mensagens_recebidas: input.mensagens_recebidas || 0,
      custo_usd: input.custo_usd || 0,
      custo_brl: input.custo_brl || 0,
      data,
    })
    .select()
    .single();

  if (error) throw error;
  return registro as UsoServico;
}

export async function resumo_uso_servico(
  telefone?: string,
  mes?: string
): Promise<{ total_custo_brl: number; total_tokens: number; por_servico: Record<string, number> }> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return { total_custo_brl: 0, total_tokens: 0, por_servico: {} };

  const m = mes || mesAtual();
  const rows = await listar_uso_servico(t);
  const filtrado = rows.filter((r) => r.data.slice(0, 7) === m);

  let totalCusto = 0;
  let totalTokens = 0;
  const porServico: Record<string, number> = {};

  for (const r of filtrado) {
    totalCusto += Number(r.custo_brl || 0);
    totalTokens += Number(r.tokens_entrada || 0) + Number(r.tokens_saida || 0);
    porServico[r.servico] = (porServico[r.servico] || 0) + Number(r.custo_brl || 0);
  }

  return { total_custo_brl: totalCusto, total_tokens: totalTokens, por_servico: porServico };
}

export type TipoCustoFixo = 'servidor' | 'ferramenta' | 'marketing' | 'telefone' | 'outro';

export interface CustoFixo {
  id: string;
  telefone: string;
  descricao: string;
  valor: number;
  categoria: TipoCustoFixo;
  vencimento: string;
  status: 'pendente' | 'pago' | 'cancelado';
  pago_em?: string;
  created_at: string;
  updated_at: string;
}

export interface CadastrarCustoFixoInput {
  descricao: string;
  valor: number;
  categoria: TipoCustoFixo;
  vencimento: string;
  status?: 'pendente' | 'pago';
  telefone?: string;
}

export async function listar_custos_fixos(
  telefone?: string,
  status?: 'pendente' | 'pago' | 'cancelado'
): Promise<CustoFixo[]> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return [];

  let query = supabase.from('custos_fixos').select('*').eq('telefone', t);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('vencimento', { ascending: true });
  if (error) throw error;
  return (data || []) as CustoFixo[];
}

export async function listar_todos_custos_fixos(): Promise<CustoFixo[]> {
  const { data, error } = await supabase
    .from('custos_fixos')
    .select('*')
    .order('vencimento', { ascending: true });
  if (error) throw error;
  return (data || []) as CustoFixo[];
}

export async function cadastrar_custo_fixo(
  input: CadastrarCustoFixoInput
): Promise<CustoFixo> {
  const telefone = input.telefone || (await resolverTelefoneUsuario());
  if (!telefone) throw new Error('Usuário não identificado.');
  validarValor(input.valor);
  if (!input.descricao?.trim()) throw new Error('Informe a descrição.');
  if (!input.vencimento) throw new Error('Informe o vencimento.');

  const { data, error } = await supabase
    .from('custos_fixos')
    .insert({
      telefone,
      descricao: input.descricao.trim(),
      valor: input.valor,
      categoria: input.categoria,
      vencimento: input.vencimento,
      status: input.status ?? 'pendente',
    })
    .select()
    .single();

  if (error) throw error;
  return data as CustoFixo;
}

export async function cadastrar_custo_fixo_recorrente(
  input: CadastrarCustoFixoInput,
  meses: number
): Promise<CustoFixo[]> {
  const telefone = input.telefone || (await resolverTelefoneUsuario());
  if (!telefone) throw new Error('Usuário não identificado.');
  validarValor(input.valor);
  if (!input.descricao?.trim()) throw new Error('Informe a descrição.');
  if (!input.vencimento) throw new Error('Informe o vencimento.');
  if (!Number.isInteger(meses) || meses < 2 || meses > 60) throw new Error('Informe de 2 a 60 meses.');

  const linhas = vencimentosMensais(input.vencimento, meses).map((vencimento, i) => ({
    telefone,
    descricao: input.descricao.trim(),
    valor: input.valor,
    categoria: input.categoria,
    vencimento,
    status: i === 0 ? input.status ?? 'pendente' : 'pendente',
  }));
  const { data, error } = await supabase.from('custos_fixos').insert(linhas).select();
  if (error) throw error;
  return (data || []) as CustoFixo[];
}

export async function atualizar_custo_fixo(
  id: string,
  input: Partial<{
    descricao: string;
    valor: number;
    categoria: TipoCustoFixo;
    vencimento: string;
    status: 'pendente' | 'pago' | 'cancelado';
  }>
): Promise<CustoFixo> {
  const updates: Record<string, unknown> = {};
  if (input.descricao !== undefined) updates.descricao = input.descricao.trim();
  if (input.valor !== undefined) updates.valor = input.valor;
  if (input.categoria !== undefined) updates.categoria = input.categoria;
  if (input.vencimento !== undefined) updates.vencimento = input.vencimento;
  if (input.status !== undefined) updates.status = input.status;

  const { data, error } = await supabase
    .from('custos_fixos')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as CustoFixo;
}

export async function remover_custo_fixo(id: string): Promise<void> {
  const { error } = await supabase.from('custos_fixos').delete().eq('id', id);
  if (error) throw error;
}

export async function total_custos_fixos(
  telefone?: string,
  status: 'pendente' | 'pago' | 'cancelado' = 'pendente'
): Promise<number> {
  const t = telefone || (await resolverTelefoneUsuario());
  if (!t) return 0;
  const rows = await listar_custos_fixos(t, status);
  return rows.reduce((s, r) => s + Number(r.valor), 0);
}

export function formatar_moeda_brl(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor);
}

export interface ResumoAdminMes {
  mes: string;
  entradas: number;
  qtd_entradas: number;
  taxas_hotmart: number;
  custos_fixos: number;
  custo_servicos_usd: number;
  custo_servicos_brl: number;
}

export async function resumo_admin_mensal(meses = 6): Promise<ResumoAdminMes[]> {
  const { data, error } = await supabase.rpc('resumo_admin_mensal', { meses });
  if (error) throw error;
  return (data || []).map((r: Record<string, unknown>) => ({
    mes: String(r.mes),
    entradas: Number(r.entradas) || 0,
    qtd_entradas: Number(r.qtd_entradas) || 0,
    taxas_hotmart: Number(r.taxas_hotmart) || 0,
    custos_fixos: Number(r.custos_fixos) || 0,
    custo_servicos_usd: Number(r.custo_servicos_usd) || 0,
    custo_servicos_brl: Number(r.custo_servicos_brl) || 0,
  }));
}

export type ResumoAdminPeriodo = Omit<ResumoAdminMes, 'mes'>;

export async function resumo_admin_periodo(inicio: string, fim: string): Promise<ResumoAdminPeriodo> {
  const { data, error } = await supabase.rpc('resumo_admin_periodo', { p_inicio: inicio, p_fim: fim });
  if (error) throw error;
  const r = ((data || [])[0] || {}) as Record<string, unknown>;
  return {
    entradas: Number(r.entradas) || 0,
    qtd_entradas: Number(r.qtd_entradas) || 0,
    taxas_hotmart: Number(r.taxas_hotmart) || 0,
    custos_fixos: Number(r.custos_fixos) || 0,
    custo_servicos_usd: Number(r.custo_servicos_usd) || 0,
    custo_servicos_brl: Number(r.custo_servicos_brl) || 0,
  };
}
