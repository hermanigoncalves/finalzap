import { timingSafeEqual } from 'node:crypto';

// Compara o hottok recebido com o segredo esperado em tempo constante.
// Nunca aceita quando o segredo esperado nao esta configurado.
export function tokenValido(
  recebido: string | string[] | undefined,
  esperado: string | undefined,
): boolean {
  if (typeof recebido !== 'string' || !esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
