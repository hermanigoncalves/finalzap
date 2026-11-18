import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefone, telefoneDoComprador } from '../lib/hotmart/telefone.ts';

test('normaliza telefone formatado sem DDI', () => {
  assert.equal(normalizarTelefone('(11) 99999-9999'), '5511999999999');
});

test('normaliza telefone com + e DDI', () => {
  assert.equal(normalizarTelefone('+55 11 99999-9999'), '5511999999999');
});

test('mantem telefone que ja esta no formato final', () => {
  assert.equal(normalizarTelefone('5511999999999'), '5511999999999');
});

test('acrescenta DDI a 11 digitos', () => {
  assert.equal(normalizarTelefone('11999999999'), '5511999999999');
});

test('aceita fixo de 10 digitos e 12 com DDI', () => {
  assert.equal(normalizarTelefone('1133334444'), '551133334444');
  assert.equal(normalizarTelefone('551133334444'), '551133334444');
});

test('entradas invalidas retornam null', () => {
  assert.equal(normalizarTelefone(''), null);
  assert.equal(normalizarTelefone('abc'), null);
  assert.equal(normalizarTelefone('123'), null);
  assert.equal(normalizarTelefone(null), null);
  assert.equal(normalizarTelefone(undefined), null);
  assert.equal(normalizarTelefone({}), null);
  assert.equal(normalizarTelefone('4411999999999'), null);
});

test('aceita numero como entrada', () => {
  assert.equal(normalizarTelefone(5511999999999), '5511999999999');
});

test('telefoneDoComprador le checkout_phone primeiro', () => {
  assert.equal(
    telefoneDoComprador({ checkout_phone: '11999999999', phone: '21988888888' }),
    '5511999999999',
  );
});

test('telefoneDoComprador cai para phone', () => {
  assert.equal(telefoneDoComprador({ phone: '(21) 98888-8888' }), '5521988888888');
});

test('telefoneDoComprador junta o DDI separado', () => {
  assert.equal(
    telefoneDoComprador({ checkout_phone: '11999999999', checkout_phone_code: '55' }),
    '5511999999999',
  );
  assert.equal(
    telefoneDoComprador({ checkout_phone: '11999999999', checkout_phone_code: '+55' }),
    '5511999999999',
  );
});

test('telefoneDoComprador junta DDI mesmo quando o DDD e 55', () => {
  assert.equal(
    telefoneDoComprador({ checkout_phone: '55999999999', checkout_phone_code: '55' }),
    '5555999999999',
  );
});

test('telefoneDoComprador pula campo invalido e usa o proximo', () => {
  assert.equal(
    telefoneDoComprador({ checkout_phone: 'abc', phone: '11999999999' }),
    '5511999999999',
  );
});

test('telefoneDoComprador retorna null sem dados', () => {
  assert.equal(telefoneDoComprador(undefined), null);
  assert.equal(telefoneDoComprador({}), null);
  assert.equal(telefoneDoComprador({ checkout_phone: '' }), null);
});

test('alinha com normalizar_telefone_br: 9o digito e zero de tronco', () => {
  assert.equal(normalizarTelefone('1188887777'), '5511988887777');
  assert.equal(normalizarTelefone('551188887777'), '5511988887777');
  assert.equal(normalizarTelefone('011 98888-7777'), '5511988887777');
  assert.equal(normalizarTelefone('5511988887777'), '5511988887777');
});
