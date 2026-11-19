// Admin escolhe no login se entra como administrador ou como usuário.
// sessionStorage: vale só nesta aba e some ao fechar; só muda a interface (a RLS segue pelo role do banco).
export type ModoAcesso = 'admin' | 'usuario';
const KEY = 'modo-acesso';

export function lerModo(): ModoAcesso | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === 'admin' || v === 'usuario' ? v : null;
  } catch {
    return null;
  }
}

export function salvarModo(modo: ModoAcesso): void {
  try { sessionStorage.setItem(KEY, modo); } catch { /* storage indisponível */ }
}

export function limparModo(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* storage indisponível */ }
}
