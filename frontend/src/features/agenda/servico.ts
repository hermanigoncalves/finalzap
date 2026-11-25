import { supabase } from '../../lib/supabase';
import { resolverTelefoneUsuario } from '../../lib/financeService';
import { montarIntervaloSP } from './regras.ts';
import type { Compromisso, NovoCompromissoInput, RemarcarCompromissoInput, StatusCompromisso } from './tipos.ts';

function textoOpcional(valor?: string): string | null {
  const limpo = valor?.trim();
  return limpo ? limpo : null;
}

export async function listarCompromissos(): Promise<Compromisso[]> {
  const { data, error } = await supabase
    .from('compromissos')
    .select('*')
    .order('inicio', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Compromisso[];
}

export async function criarCompromisso(input: NovoCompromissoInput): Promise<Compromisso> {
  const titulo = input.titulo.trim();
  if (!titulo) throw new Error('Informe o título do compromisso.');

  const telefone = await resolverTelefoneUsuario();
  if (!telefone) throw new Error('Perfil sem telefone vinculado.');

  const { inicio, fim } = montarIntervaloSP(input.data, input.horaInicio, input.horaFim);
  const { data, error } = await supabase
    .from('compromissos')
    .insert({
      telefone,
      titulo,
      local: textoOpcional(input.local),
      descricao: textoOpcional(input.descricao),
      inicio,
      fim,
      status: 'agendado',
      permitir_conflito: Boolean(input.permitirConflito),
      fonte: 'painel',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as Compromisso;
}

export async function remarcarCompromisso(id: string, input: RemarcarCompromissoInput): Promise<Compromisso> {
  const titulo = input.titulo.trim();
  if (!titulo) throw new Error('Informe o título do compromisso.');

  const { inicio, fim } = montarIntervaloSP(input.data, input.horaInicio, input.horaFim);
  const { data, error } = await supabase
    .from('compromissos')
    .update({
      titulo,
      local: textoOpcional(input.local),
      descricao: textoOpcional(input.descricao),
      inicio,
      fim,
      permitir_conflito: Boolean(input.permitirConflito),
    })
    .eq('id', id)
    .eq('status', 'agendado')
    .select('*')
    .single();

  if (error) throw error;
  return data as Compromisso;
}

export async function atualizarStatusCompromisso(id: string, status: StatusCompromisso): Promise<Compromisso> {
  const { data, error } = await supabase
    .from('compromissos')
    .update({ status })
    .eq('id', id)
    .eq('status', 'agendado')
    .select('*')
    .single();

  if (error) throw error;
  return data as Compromisso;
}
