import type { Compromisso } from './tipos.ts';

export const DURACAO_PADRAO_MINUTOS = 60;

const OFFSET_SP_MS = 3 * 60 * 60 * 1000;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function dataRealValida(dataISO: string): boolean {
  if (!RE_DATA.test(dataISO)) return false;
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export function montarIntervaloSP(
  dataISO: string,
  horaInicio: string,
  horaFim?: string | null,
): { inicio: string; fim: string } {
  if (!dataRealValida(dataISO)) throw new Error('Data inválida. Use o formato AAAA-MM-DD.');
  if (!RE_HORA.test(horaInicio)) throw new Error('Horário inicial inválido. Use HH:MM.');

  const inicio = `${dataISO}T${horaInicio}:00-03:00`;
  const inicioMs = Date.parse(inicio);

  let fim: string;
  const horaFimLimpa = horaFim?.trim();
  if (horaFimLimpa) {
    if (!RE_HORA.test(horaFimLimpa)) throw new Error('Horário final inválido. Use HH:MM.');
    fim = `${dataISO}T${horaFimLimpa}:00-03:00`;
  } else {
    const fimSP = new Date(inicioMs + DURACAO_PADRAO_MINUTOS * 60 * 1000 - OFFSET_SP_MS);
    fim = `${fimSP.toISOString().slice(0, 19)}-03:00`;
  }

  if (Date.parse(fim) <= inicioMs) {
    throw new Error('O horário de término precisa ser posterior ao início.');
  }
  return { inicio, fim };
}

export function detectarConflitos(
  candidato: { inicio: string; fim: string; id?: string },
  existentes: readonly Compromisso[],
): Compromisso[] {
  const inicioCand = Date.parse(candidato.inicio);
  const fimCand = Date.parse(candidato.fim);
  if (!Number.isFinite(inicioCand) || !Number.isFinite(fimCand)) return [];

  return existentes
    .filter((item) => {
      if (item.status !== 'agendado') return false;
      if (candidato.id && item.id === candidato.id) return false;
      const inicioItem = Date.parse(item.inicio);
      const fimItem = Date.parse(item.fim);
      return inicioCand < fimItem && fimCand > inicioItem;
    })
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
}

const formatadorSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatarDataHoraSP(iso: string): { data: string; hora: string; dataISO: string } {
  const partes = Object.fromEntries(formatadorSP.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const horaBruta = partes['hour'] === '24' ? '00' : (partes['hour'] ?? '00');
  const ano = partes['year'] ?? '0000';
  const mes = partes['month'] ?? '00';
  const dia = partes['day'] ?? '00';
  const minuto = partes['minute'] ?? '00';
  return {
    data: `${dia}/${mes}/${ano}`,
    hora: `${horaBruta}:${minuto}`,
    dataISO: `${ano}-${mes}-${dia}`,
  };
}

export function extrairErroConflito(erro: unknown): string | null {
  const msg = erro instanceof Error
    ? erro.message
    : typeof erro === 'object' && erro !== null && 'message' in erro
      ? String((erro as { message: unknown }).message)
      : '';
  const idx = msg.indexOf('CONFLITO_HORARIO:');
  if (idx === -1) return null;
  return msg.slice(idx + 'CONFLITO_HORARIO:'.length).trim();
}
