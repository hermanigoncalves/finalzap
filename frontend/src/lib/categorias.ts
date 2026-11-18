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

export function idDaCategoria(nome: string): string {
  const alvo = nome.trim().toLowerCase();
  const cat = useStore
    .getState()
    .categories.find((c) => c.name.toLowerCase() === alvo || c.id === nome);
  return cat ? cat.id : nome;
}
