import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularUsoOpenAI, cotacaoDolar } from '../lib/financeiro/usoOpenAI.ts';

test('gpt-4o-mini: 1M tokens de entrada e 1M de saída custam US$ 0,75', () => {
  const u = calcularUsoOpenAI('gpt-4o-mini', 1_000_000, 1_000_000, 5);
  assert.equal(u.custoUsd, 0.75);
  assert.equal(u.custoBrl, 3.75);
});

test('uma mensagem típica custa frações de centavo', () => {
  const u = calcularUsoOpenAI('gpt-4o-mini', 400, 60, 5.5);
  assert.ok(u.custoUsd > 0 && u.custoUsd < 0.001);
});

test('modelo desconhecido não inventa custo, mas guarda os tokens', () => {
  const u = calcularUsoOpenAI('modelo-x', 100, 50, 5.5);
  assert.equal(u.custoUsd, 0);
  assert.equal(u.tokensEntrada, 100);
  assert.equal(u.tokensSaida, 50);
});

test('tokens inválidos viram zero', () => {
  const u = calcularUsoOpenAI('gpt-4o-mini', -5, NaN, 5.5);
  assert.equal(u.tokensEntrada, 0);
  assert.equal(u.tokensSaida, 0);
});

test('cotacaoDolar: usa a env válida ou 5,50', () => {
  assert.equal(cotacaoDolar('5.9'), 5.9);
  assert.equal(cotacaoDolar('abc'), 5.5);
  assert.equal(cotacaoDolar(undefined), 5.5);
  assert.equal(cotacaoDolar('0'), 5.5);
});
