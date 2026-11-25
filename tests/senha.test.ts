import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarSenha } from '../frontend/src/lib/senha.ts';

test('validarSenha: senha de 7 caracteres e rejeitada', () => {
  assert.equal(validarSenha('1234567', '1234567'), 'A senha deve ter pelo menos 8 caracteres.');
});
test('validarSenha: senha curta sem letra ou sem numero e rejeitada', () => {
  assert.notEqual(validarSenha('12345678', '12345678'), null);
  assert.notEqual(validarSenha('abcdefgh', 'abcdefgh'), null);
});
test('validarSenha: senhas diferentes nao conferem', () => {
  assert.equal(validarSenha('Senha123', 'Senha124'), 'As senhas não conferem.');
});
test('validarSenha: letra e numero ou 12+ caracteres e valida', () => {
  assert.equal(validarSenha('Senha123', 'Senha123'), null);
  assert.equal(validarSenha('uma senha bem longa', 'uma senha bem longa'), null);
});
