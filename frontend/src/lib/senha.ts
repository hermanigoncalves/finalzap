export function validarSenha(senha: string, confirmacao: string): string | null {
  if (senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  const ehFraseLonga = senha.length >= 12;
  const temLetraENumero = /[A-Za-z]/.test(senha) && /\d/.test(senha);
  if (!ehFraseLonga && !temLetraENumero) {
    return 'Use pelo menos 1 letra e 1 número, ou uma frase-senha com 12 ou mais caracteres.';
  }
  if (senha !== confirmacao) return 'As senhas não conferem.';
  return null;
}
