// Datas no fuso do negócio (America/Sao_Paulo), nunca UTC: após 21h em Brasília o UTC já é "amanhã".
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

export function hojeISO(agora: Date = new Date()): string {
  return fmt.format(agora); // YYYY-MM-DD
}

export function mesAtual(agora: Date = new Date()): string {
  return hojeISO(agora).slice(0, 7); // YYYY-MM
}

/** Soma dias a uma data YYYY-MM-DD sem passar por fuso (meio-dia UTC evita virada de dia). */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Soma meses a um mês YYYY-MM (aceita negativo). */
export function somarMeses(mes: string, meses: number): string {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + meses;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
