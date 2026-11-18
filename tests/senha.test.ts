import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarSenha } from '../frontend/src/lib/senha.ts';

test('validarSenha: senha de 7 caracteres e rejeitada', () => {
  assert.equal(validarSenha('1234567', '1234567'), 'A senha deve ter pelo menos 8 caracteres.');
});
test('validarSenha: senhas diferentes nao conferem', () => {
  assert.equal(validarSenha('12345678', '12345679'), 'As senhas não conferem.');
});
test('validarSenha: 8 ou mais caracteres iguais e valida', () => {
  assert.equal(validarSenha('12345678', '12345678'), null);
  assert.equal(validarSenha('uma senha bem longa', 'uma senha bem longa'), null);
});
