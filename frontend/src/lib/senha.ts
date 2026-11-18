export function validarSenha(senha: string, confirmacao: string): string | null {
  if (senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (senha !== confirmacao) return 'As senhas não conferem.';
  return null;
}
