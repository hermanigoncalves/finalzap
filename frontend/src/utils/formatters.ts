import { hojeISO, somarDias } from '../lib/datas';

export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

/** Data YYYY-MM-DD do banco, tratada como texto: new Date('YYYY-MM-DD') é UTC e andaria um dia para trás. */
export const formatDate = (isoDate: string): string => {
  const dia = isoDate.slice(0, 10);
  const hoje = hojeISO();
  if (dia === hoje) return 'Hoje';
  if (dia === somarDias(hoje, -1)) return 'Ontem';
  return new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};
