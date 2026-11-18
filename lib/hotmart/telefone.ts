// Nomes dos campos do comprador no payload da Hotmart.
// A confirmar com o evento de teste da Hotmart (ainda nao validado com payload real).
const CAMPOS_TELEFONE = ['checkout_phone', 'phone'];
const CAMPO_DDI = 'checkout_phone_code';

// Espelha a funcao SQL normalizar_telefone_br: so digitos, sem zeros de tronco, DDI 55 e
// 9o digito acrescentado em celular de 8 digitos (55 + DDD + [6-9]xxxxxxx). Invalido retorna null.
export function normalizarTelefone(entrada: unknown): string | null {
  if (typeof entrada !== 'string' && typeof entrada !== 'number') return null;
  let d = String(entrada).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d : null;
}

// Le o telefone do comprador, juntando o DDI quando vier separado.
export function telefoneDoComprador(
  buyer: Record<string, unknown> | undefined,
): string | null {
  if (!buyer) return null;
  const ddi = String(buyer[CAMPO_DDI] ?? '').replace(/\D/g, '');
  for (const campo of CAMPOS_TELEFONE) {
    const valor = buyer[campo];
    if (typeof valor !== 'string' && typeof valor !== 'number') continue;
    const digitos = String(valor).replace(/\D/g, '');
    const normalizado = normalizarTelefone(
      ddi && digitos.length <= 11 ? ddi + digitos : digitos,
    );
    if (normalizado) return normalizado;
  }
  return null;
}
