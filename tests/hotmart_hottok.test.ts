import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenValido } from '../lib/hotmart/hottok.ts';

test('aceita token igual', () => {
  assert.equal(tokenValido('abc', 'abc'), true);
});

test('rejeita token diferente de mesmo tamanho', () => {
  assert.equal(tokenValido('abc', 'abd'), false);
});

test('rejeita token ausente', () => {
  assert.equal(tokenValido(undefined, 'abc'), false);
});

test('rejeita quando o segredo esperado esta vazio', () => {
  assert.equal(tokenValido('', ''), false);
  assert.equal(tokenValido('abc', ''), false);
});

test('rejeita quando o segredo esperado nao esta configurado', () => {
  assert.equal(tokenValido('abc', undefined), false);
  assert.equal(tokenValido(undefined, undefined), false);
});

test('tamanhos diferentes retornam false sem lancar erro', () => {
  assert.doesNotThrow(() => tokenValido('abcd', 'abc'));
  assert.equal(tokenValido('abcd', 'abc'), false);
  assert.equal(tokenValido('ab', 'abc'), false);
});

test('rejeita cabecalho repetido (array)', () => {
  assert.equal(tokenValido(['abc', 'abc'], 'abc'), false);
  assert.equal(tokenValido(['abc'], 'abc'), false);
});
