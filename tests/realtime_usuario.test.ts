import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarEventoLista,
  compararCompromissos,
  compararContas,
  compararOrcamentos,
  compararTransacoes,
  ControladorCargaUnica,
  filtrarContasVencendo,
  mapearContaLinha,
  mapearMovimentacaoLinha,
  normalizarOrcamentoLinha,
} from '../frontend/src/lib/realtimeEstado.ts';

describe('Realtime e deduplicação de consultas do usuário', () => {
  it('ControladorCargaUnica deduplica chamadas simultâneas e evita refetch quando já pronto', async () => {
    const ctrl = new ControladorCargaUnica<'movimentacoes' | 'orcamentos'>();
    let chamadas = 0;
    let liberar!: () => void;
    const bloqueio = new Promise<void>((resolve) => {
      liberar = resolve;
    });

    const carregador = async () => {
      chamadas += 1;
      await bloqueio;
    };

    const p1 = ctrl.garantir('movimentacoes', carregador);
    const p2 = ctrl.garantir('movimentacoes', carregador);
    assert.equal(p1, p2);
    assert.equal(chamadas, 1);

    liberar();
    await Promise.all([p1, p2]);
    assert.equal(ctrl.obterStatus('movimentacoes'), 'ready');

    await ctrl.garantir('movimentacoes', carregador);
    assert.equal(chamadas, 1);

    await ctrl.garantir('movimentacoes', carregador, { forcar: true });
    assert.equal(chamadas, 2);
  });

  it('ControladorCargaUnica.resetar invalida carga antiga em voo', async () => {
    const ctrl = new ControladorCargaUnica<'movimentacoes'>();
    const statusLog: string[] = [];
    let liberarAntigo!: () => void;

    const pAntigo = ctrl.garantir(
      'movimentacoes',
      () => new Promise<void>((resolve) => { liberarAntigo = resolve; }),
      { aoMudarStatus: (s) => statusLog.push(s) }
    );

    ctrl.resetar();
    assert.equal(ctrl.obterStatus('movimentacoes'), 'idle');

    liberarAntigo();
    await pAntigo;

    assert.equal(ctrl.obterStatus('movimentacoes'), 'idle');
    assert.deepEqual(statusLog, ['loading']);
  });

  it('aplicarEventoLista é idempotente em INSERT duplicado, ordena UPDATE e preserva referência em DELETE inexistente', () => {
    const t1 = { id: 'a', date: '2026-11-10', createdAt: '2026-11-10T10:00:00Z', nome: 'Almoço' };
    const t2 = { id: 'b', date: '2026-11-12', createdAt: '2026-11-12T10:00:00Z', nome: 'Mercado' };

    const comT1 = aplicarEventoLista([], { eventType: 'INSERT', novo: t1 }, compararTransacoes);
    const ecoT1 = aplicarEventoLista(comT1, { eventType: 'INSERT', novo: t1 }, compararTransacoes);
    assert.equal(ecoT1.length, 1);

    const comT2 = aplicarEventoLista(ecoT1, { eventType: 'INSERT', novo: t2 }, compararTransacoes);
    assert.deepEqual(comT2.map((x) => x.id), ['b', 'a']);

    const t1Editado = { ...t1, date: '2026-11-15', nome: 'Jantar' };
    const atualizado = aplicarEventoLista(comT2, { eventType: 'UPDATE', novo: t1Editado }, compararTransacoes);
    assert.deepEqual(atualizado.map((x) => x.id), ['a', 'b']);
    assert.equal(atualizado[0].nome, 'Jantar');

    const semMudanca = aplicarEventoLista(atualizado, { eventType: 'DELETE', antigoId: 'inexistente' }, compararTransacoes);
    assert.equal(semMudanca, atualizado);

    const removido = aplicarEventoLista(atualizado, { eventType: 'DELETE', antigoId: 'b' }, compararTransacoes);
    assert.deepEqual(removido.map((x) => x.id), ['a']);
  });

  it('comparadores de contas, orçamentos e compromissos ordenam de forma determinística', () => {
    const contas = [
      { id: 'c2', date: '2026-11-20', vencimento: '2026-11-20' },
      { id: 'c1', date: '2026-11-10', vencimento: '2026-11-10' },
    ].sort(compararContas);
    assert.deepEqual(contas.map((c) => c.id), ['c1', 'c2']);

    const orcs = [
      { id: 'o1', created_at: '2026-11-01T10:00:00Z' },
      { id: 'o2', created_at: '2026-11-05T10:00:00Z' },
    ].sort(compararOrcamentos);
    assert.deepEqual(orcs.map((o) => o.id), ['o2', 'o1']);

    const comp = [
      { id: 'ag2', inicio: '2026-11-28T15:00:00-03:00' },
      { id: 'ag1', inicio: '2026-11-28T09:00:00-03:00' },
    ].sort(compararCompromissos);
    assert.deepEqual(comp.map((c) => c.id), ['ag1', 'ag2']);
  });

  it('filtrarContasVencendo filtra pendentes na janela [hoje, hoje + dias]', () => {
    const contas = [
      { id: 'ontem', status: 'pendente', vencimento: '2026-11-27', date: '2026-11-27' },
      { id: 'hoje', status: 'pendente', vencimento: '2026-11-28', date: '2026-11-28' },
      { id: 'paga-hoje', status: 'paga', vencimento: '2026-11-28', date: '2026-11-28' },
      { id: 'd5', status: 'pendente', vencimento: '2026-12-03', date: '2026-12-03' },
      { id: 'd8', status: 'pendente', vencimento: '2026-12-06', date: '2026-12-06' },
    ];

    assert.deepEqual(
      filtrarContasVencendo(contas, 0, '2026-11-28').map((c) => c.id),
      ['hoje']
    );
    assert.deepEqual(
      filtrarContasVencendo(contas, 7, '2026-11-28').map((c) => c.id),
      ['hoje', 'd5']
    );
  });

  it('mappers convertem valores numéricos vindos como string do WAL/PostgREST', () => {
    const mov = mapearMovimentacaoLinha(
      {
        id: 'm1',
        telefone: '5511999990000',
        tipo: 'despesa',
        valor: '149.90',
        categoria: 'Alimentação',
        descricao: 'Supermercado',
        data: '2026-11-28',
        mes: '2026-11',
        fonte: 'whatsapp',
        created_at: '2026-11-28T10:00:00Z',
      },
      (nome) => `cat:${nome}`
    );
    assert.equal(mov.amount, 149.9);
    assert.equal(mov.type, 'expense');
    assert.equal(mov.categoryId, 'cat:Alimentação');

    const conta = mapearContaLinha(
      {
        id: 'ct1',
        telefone: '5511999990000',
        descricao: 'Internet',
        valor: '99.90',
        categoria: null,
        vencimento: '2026-11-30',
        status: 'pendente',
      },
      (nome) => `cat:${nome}`
    );
    assert.equal(conta.amount, 99.9);
    assert.equal(conta.categoryId, 'cat:Contas');

    const orc = normalizarOrcamentoLinha({
      id: 'or1',
      telefone: '5511999990000',
      categoria: 'Alimentação',
      limite_mensal: '1200.50',
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    });
    assert.equal(orc.limite_mensal, 1200.5);
  });
});
