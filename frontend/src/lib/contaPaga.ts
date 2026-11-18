export interface ResultadoContaPaga {
  sucesso: boolean;
  mensagem: string;
  movimentacao_id?: string;
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

// A RPC devolve {success, message, movimentacao_id} (e, por compatibilidade, sucesso/mensagem).
export function mapearResultadoContaPaga(data: unknown): ResultadoContaPaga {
  const d = (data ?? {}) as Record<string, unknown>;
  const ok = d.success ?? d.sucesso;
  const msg = d.message ?? d.mensagem;
  return {
    sucesso: ok === true,
    mensagem: typeof msg === 'string' ? msg : ok === true ? 'Conta marcada como paga.' : 'Não foi possível marcar a conta como paga.',
    movimentacao_id: typeof d.movimentacao_id === 'string' ? d.movimentacao_id : undefined,
  };
}

export async function chamarMarcarContaPaga(rpc: Rpc, contaId: string, telefone: string): Promise<ResultadoContaPaga> {
  const { data, error } = await rpc('marcar_conta_paga_com_despesa', { p_conta_id: contaId, p_telefone: telefone });
  if (error) throw error;
  return mapearResultadoContaPaga(data);
}
