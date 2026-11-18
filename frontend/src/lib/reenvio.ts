// Traducao pura da resposta de POST /api/admin/reenviar-convite. Sem imports.
// Nunca devolve texto cru do servidor, exceto o motivo de recusa do 409.

export type ResultadoReenvio =
  | { ok: true; tipo: 'convite' | 'redefinicao' }
  | { ok: false; motivo: string };

const GENERICA = 'Não foi possível reenviar o convite agora.';

export function traduzirRespostaReenvio(status: number, corpo: unknown): ResultadoReenvio {
  const obj =
    typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};

  if (status === 200) {
    if (obj.tipo === 'convite' || obj.tipo === 'redefinicao') return { ok: true, tipo: obj.tipo };
    return { ok: false, motivo: GENERICA };
  }
  if (status === 409) {
    const erro = obj.erro;
    return { ok: false, motivo: typeof erro === 'string' && erro.trim() ? erro : GENERICA };
  }
  if (status === 401) return { ok: false, motivo: 'Sessão expirada. Entre novamente.' };
  if (status === 403) return { ok: false, motivo: 'Você não tem permissão para esta ação.' };
  if (status === 404) return { ok: false, motivo: 'Assinatura não encontrada.' };
  return { ok: false, motivo: GENERICA };
}
