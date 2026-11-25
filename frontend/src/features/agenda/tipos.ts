export type StatusCompromisso = 'agendado' | 'concluido' | 'cancelado';

export type FonteCompromisso = 'whatsapp' | 'painel';

export interface Compromisso {
  id: string;
  telefone: string;
  titulo: string;
  descricao: string | null;
  local: string | null;
  inicio: string;
  fim: string;
  status: StatusCompromisso;
  permitir_conflito: boolean;
  fonte: FonteCompromisso;
  created_at: string;
  updated_at: string;
}

export interface NovoCompromissoInput {
  titulo: string;
  data: string;
  horaInicio: string;
  horaFim?: string;
  local?: string;
  descricao?: string;
  permitirConflito?: boolean;
}

export type RemarcarCompromissoInput = NovoCompromissoInput;

export type FiltroAgenda = 'proximos' | 'hoje' | 'concluidos' | 'cancelados';
