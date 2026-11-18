import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularMes, limitesDoMes } from '../frontend/src/lib/dashboardAdmin.ts';

test('calcularMes: converte USD pela cotação e desconta taxas, custos fixos e serviços do lucro', () => {
  const r = calcularMes(
    { entradas: 1000, qtd_entradas: 10, taxas_hotmart: 99.9, custos_fixos: 200, custo_servicos_usd: 10, custo_servicos_brl: 4 },
    5.5,
  );
  assert.equal(r.servicosBrl, 59); // 10 USD x 5,5 + R$ 4
  assert.equal(r.despesas, 358.9); // 200 fixos + 59 serviços + 99,90 taxas
  assert.equal(r.lucro, 641.1);
});

test('calcularMes: mês sem vendas dá prejuízo igual às despesas', () => {
  const r = calcularMes(
    { entradas: 0, qtd_entradas: 0, taxas_hotmart: 0, custos_fixos: 50, custo_servicos_usd: 0, custo_servicos_brl: 0 },
    5,
  );
  assert.equal(r.lucro, -50);
});

test('limitesDoMes: primeiro e último dia, inclusive fevereiro bissexto e dezembro', () => {
  assert.deepEqual(limitesDoMes('2026-11-18'), { inicio: '2026-11-01', fim: '2026-11-30' });
  assert.deepEqual(limitesDoMes('2028-02-10'), { inicio: '2028-02-01', fim: '2028-02-29' });
  assert.deepEqual(limitesDoMes('2026-12-31'), { inicio: '2026-12-01', fim: '2026-12-31' });
});

test('noPeriodo: início e fim inclusivos, aceita timestamp, rejeita vazio; periodoValido', async () => {
  const { noPeriodo, periodoValido } = await import('../frontend/src/lib/dashboardAdmin.ts');
  const p = { inicio: '2026-11-01', fim: '2026-11-30' };
  assert.ok(noPeriodo('2026-11-01', p) && noPeriodo('2026-11-30', p) && noPeriodo('2026-11-15T10:00:00Z', p));
  assert.ok(!noPeriodo('2026-10-31', p) && !noPeriodo('2026-12-01', p) && !noPeriodo(null, p));
  assert.ok(periodoValido(p) && !periodoValido({ inicio: '2026-11-10', fim: '2026-11-01' }) && !periodoValido({ inicio: '', fim: '2026-11-01' }));
});
