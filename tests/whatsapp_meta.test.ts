import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assinaturaValida, extrairCobrancas, custoDaCobranca, lerTarifas, TARIFAS_PADRAO_USD } from '../lib/whatsapp/meta.ts';

const assinar = (corpo: string, segredo: string) =>
  'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex');

test('assinatura: aceita a correta e recusa adulterada, ausente ou sem segredo', () => {
  const corpo = '{"a":1}';
  assert.equal(assinaturaValida(corpo, assinar(corpo, 's3'), 's3'), true);
  assert.equal(assinaturaValida(corpo + ' ', assinar(corpo, 's3'), 's3'), false);
  assert.equal(assinaturaValida(corpo, assinar(corpo, 'outro'), 's3'), false);
  assert.equal(assinaturaValida(corpo, undefined, 's3'), false);
  assert.equal(assinaturaValida(corpo, 'sha256=zzzz', 's3'), false);
  assert.equal(assinaturaValida(corpo, assinar(corpo, 's3'), undefined), false);
});

const payload = (statuses: unknown[]) => ({
  entry: [{ changes: [{ field: 'messages', value: { statuses } }] }],
});

test('extrairCobrancas: só conta "sent" cobrável, uma vez por mensagem', () => {
  const r = extrairCobrancas(
    payload([
      { id: 'wamid.1', status: 'sent', recipient_id: '5511999990000', pricing: { billable: true, category: 'utility' } },
      { id: 'wamid.1', status: 'delivered', recipient_id: '5511999990000', pricing: { billable: true, category: 'utility' } },
      { id: 'wamid.2', status: 'sent', recipient_id: '5511888880000', pricing: { billable: false, category: 'service' } },
      { id: 'wamid.3', status: 'sent', recipient_id: '5511777770000' },
      { status: 'sent', pricing: { billable: true, category: 'marketing' } },
    ])
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].referencia, 'meta:wamid.1:sent');
  assert.equal(r[0].categoria, 'utility');
  assert.equal(r[0].telefone, '5511999990000');
});

test('extrairCobrancas: payload estranho não quebra', () => {
  assert.deepEqual(extrairCobrancas(null), []);
  assert.deepEqual(extrairCobrancas({ entry: 'x' }), []);
  assert.deepEqual(extrairCobrancas({ entry: [{ changes: [{ value: {} }] }] }), []);
});

test('custo: tarifa x cotação; categoria desconhecida custa zero', () => {
  const c = custoDaCobranca('marketing', TARIFAS_PADRAO_USD, 5);
  assert.equal(c.custoUsd, 0.0625);
  assert.equal(c.custoBrl, 0.3125);
  assert.equal(custoDaCobranca('nova', TARIFAS_PADRAO_USD, 5).custoBrl, 0);
});

test('lerTarifas: env válida sobrescreve, inválida cai no padrão', () => {
  assert.equal(lerTarifas('{"utility":0.01}').utility, 0.01);
  assert.equal(lerTarifas('{"utility":0.01}').marketing, 0.0625);
  assert.deepEqual(lerTarifas('lixo'), TARIFAS_PADRAO_USD);
  assert.equal(lerTarifas('{"utility":-1}').utility, 0.0068);
});
