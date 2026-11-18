import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chamarMarcarContaPaga, mapearResultadoContaPaga } from '../frontend/src/lib/contaPaga.ts';
import { hojeISO, mesAtual } from '../frontend/src/lib/datas.ts';

test('RPC {success,message,movimentacao_id} -> {sucesso,mensagem}', async () => {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    assert.equal(fn, 'marcar_conta_paga_com_despesa');
    assert.deepEqual(args, { p_conta_id: 'c1', p_telefone: '5511999999999' });
    return { data: { success: true, message: 'ok', movimentacao_id: 'm1' }, error: null };
  };
  assert.deepEqual(await chamarMarcarContaPaga(rpc, 'c1', '5511999999999'), { sucesso: true, mensagem: 'ok', movimentacao_id: 'm1' });
});
test('RPC com falha de negócio', () => {
  assert.deepEqual(mapearResultadoContaPaga({ success: false, message: 'Conta não encontrada.' }), { sucesso: false, mensagem: 'Conta não encontrada.', movimentacao_id: undefined });
});
test('corpo vazio nunca vira sucesso', () => {
  assert.equal(mapearResultadoContaPaga(null).sucesso, false);
});
test('erro da RPC propaga', async () => {
  await assert.rejects(chamarMarcarContaPaga(async () => ({ data: null, error: { message: 'boom' } }), 'c', 't'));
});
test('datas em America/Sao_Paulo, não UTC', () => {
  const d = new Date('2026-11-18T01:30:00Z'); // 22:30 de 17/11 em Brasília
  assert.equal(hojeISO(d), '2026-11-17');
  assert.equal(mesAtual(new Date('2026-12-01T01:00:00Z')), '2026-11');
});
