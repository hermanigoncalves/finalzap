import type { TipoMovimentacao } from './financeService';

// Mapeamento transitório entre o modelo antigo (store) e o novo (financeService).
export function paraTipoMovimentacao(t: 'income' | 'expense'): TipoMovimentacao {
  return t === 'income' ? 'receita' : 'despesa';
}

export function deTipoMovimentacao(t: TipoMovimentacao): 'income' | 'expense' {
  return t === 'receita' ? 'income' : 'expense';
}
