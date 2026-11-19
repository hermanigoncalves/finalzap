import { useStore } from '../store/useStore';

/**
 * O banco (e o agente do WhatsApp) guardam a categoria pelo NOME
 * ("Alimentação"). A interface usa o id local ("cat_1"). Estas funções
 * convertem nos dois sentidos e aceitam valores desconhecidos como estão.
 */
export function nomeDaCategoria(idOuNome: string): string {
  const cat = useStore.getState().categories.find((c) => c.id === idOuNome);
  return cat ? cat.name : idOuNome;
}

export function idDaCategoria(nome: string, tipo?: 'income' | 'expense'): string {
  const alvo = nome.trim().toLowerCase();
  const iguais = useStore
    .getState()
    .categories.filter((c) => c.name.toLowerCase() === alvo || c.id === nome);
  // "Outros" existe como despesa e como receita: o tipo desempata.
  const cat = iguais.find((c) => !tipo || c.type === tipo) ?? iguais[0];
  return cat ? cat.id : nome;
}
