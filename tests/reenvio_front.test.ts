import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traduzirRespostaReenvio } from '../frontend/src/lib/reenvio.ts';

const GENERICA = 'Não foi possível reenviar o convite agora.';

test('200 com tipo convite', () => {
  assert.deepEqual(traduzirRespostaReenvio(200, { ok: true, tipo: 'convite' }), { ok: true, tipo: 'convite' });
});
test('200 com tipo redefinicao', () => {
  assert.deepEqual(traduzirRespostaReenvio(200, { ok: true, tipo: 'redefinicao' }), { ok: true, tipo: 'redefinicao' });
});
test('200 com corpo malformado -> generica', () => {
  for (const corpo of [null, undefined, 'x', {}, { ok: true }, { ok: true, tipo: 'outro' }]) {
    assert.deepEqual(traduzirRespostaReenvio(200, corpo), { ok: false, motivo: GENERICA });
  }
});
test('409 com erro -> motivo do servidor', () => {
  assert.deepEqual(traduzirRespostaReenvio(409, { erro: 'Assinatura cancelada' }), { ok: false, motivo: 'Assinatura cancelada' });
});
test('409 sem corpo legivel -> generica', () => {
  for (const corpo of [null, undefined, 'x', {}, { erro: '' }, { erro: 5 }]) {
    assert.deepEqual(traduzirRespostaReenvio(409, corpo), { ok: false, motivo: GENERICA });
  }
});
test('401', () => {
  assert.deepEqual(traduzirRespostaReenvio(401, { erro: 'não autenticado' }), { ok: false, motivo: 'Sessão expirada. Entre novamente.' });
});
test('403', () => {
  assert.deepEqual(traduzirRespostaReenvio(403, { erro: 'acesso negado' }), { ok: false, motivo: 'Você não tem permissão para esta ação.' });
});
test('404', () => {
  assert.deepEqual(traduzirRespostaReenvio(404, { erro: 'x' }), { ok: false, motivo: 'Assinatura não encontrada.' });
});
test('500 e outros -> generica, sem vazar texto do servidor', () => {
  assert.deepEqual(traduzirRespostaReenvio(500, { erro: 'falha ao reenviar' }), { ok: false, motivo: GENERICA });
  assert.deepEqual(traduzirRespostaReenvio(400, { erro: 'detalhe interno' }), { ok: false, motivo: GENERICA });
});
