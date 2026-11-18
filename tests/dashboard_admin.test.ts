import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularMes } from '../frontend/src/lib/dashboardAdmin.ts';

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
