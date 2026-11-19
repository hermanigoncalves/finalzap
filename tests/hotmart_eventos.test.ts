import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerWebhook,
  mapearEvento,
  calcularVencimento,
  PRODUTO_ID,
  TOLERANCIA_DIAS,
} from '../lib/hotmart/eventos.ts';
import type { EventoHotmart } from '../lib/hotmart/eventos.ts';

const corpo = () => ({
  event: 'PURCHASE_APPROVED',
  creation_date: 1700000000000,
  data: {
    product: { id: 8889619 },
    buyer: { email: 'ana@email.com', name: 'Ana Souza', phone: '11999990000' },
    purchase: {
      transaction: 'HP123',
      approved_date: 1700000100000,
      date_next_charge: '2023-12-14T10:00:00.000Z',
      status: 'APPROVED',
    },
    subscription: { subscriber: { code: 'SUB1' }, plan: { name: 'Mensal' } },
  },
});

test('constantes', () => {
  assert.equal(PRODUTO_ID, '8889619');
  assert.equal(TOLERANCIA_DIAS, 3);
});

test('mapearEvento: eventos conhecidos', () => {
  assert.deepEqual(mapearEvento('PURCHASE_APPROVED'), { status: 'Ativo', enviarConvite: true });
  assert.deepEqual(mapearEvento('PURCHASE_COMPLETE'), { status: 'Ativo', enviarConvite: false });
  assert.deepEqual(mapearEvento('PURCHASE_DELAYED'), { status: 'Inadimplente', enviarConvite: false });
  assert.equal(mapearEvento('SUBSCRIPTION_CANCELLATION')?.status, 'Cancelado'); // mantém acesso até o fim do período
  for (const t of ['PURCHASE_CANCELED', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK']) {
    assert.equal(mapearEvento(t)?.status, 'Inativo', t); // dinheiro devolvido: sem acesso
    assert.equal(mapearEvento(t)?.enviarConvite, false, t);
  }
});

test('mapearEvento: evento desconhecido e ignorado', () => {
  assert.equal(mapearEvento('ALGUM_EVENTO_NOVO'), null);
});

test('lerWebhook: corpo completo devolve os campos', () => {
  const e = lerWebhook(corpo());
  assert.ok(e);
  assert.equal(e.tipo, 'PURCHASE_APPROVED');
  assert.equal(e.produtoId, '8889619');
  assert.equal(e.transacao, 'HP123');
  assert.equal(e.assinanteCodigo, 'SUB1');
  assert.equal(e.email, 'ana@email.com');
  assert.equal(e.nome, 'Ana Souza');
  assert.equal(e.buyer.phone, '11999990000');
  assert.equal(e.criadoEm.getTime(), 1700000000000);
  assert.equal(e.aprovadoEm?.getTime(), 1700000100000);
  assert.equal(e.proximaCobranca?.toISOString(), '2023-12-14T10:00:00.000Z');
  assert.equal(e.plano, 'Mensal');
});

test('lerWebhook: sem buyer.email retorna null', () => {
  const c = corpo();
  delete (c.data.buyer as Record<string, unknown>).email;
  assert.equal(lerWebhook(c), null);
});

test('lerWebhook: sem produto ou transacao retorna null', () => {
  const a = corpo();
  delete (a.data.product as Record<string, unknown>).id;
  assert.equal(lerWebhook(a), null);
  const b = corpo();
  delete (b.data.purchase as Record<string, unknown>).transaction;
  assert.equal(lerWebhook(b), null);
});

test('lerWebhook: e-mail e normalizado', () => {
  const c = corpo();
  c.data.buyer.email = ' Ana@Email.COM ';
  assert.equal(lerWebhook(c)?.email, 'ana@email.com');
});

test('lerWebhook: corpo malformado nunca lanca', () => {
  for (const x of [null, undefined, 'texto', 42, [], {}, { data: null }, { data: { buyer: 'x' } }]) {
    assert.equal(lerWebhook(x), null);
  }
});

test('lerWebhook: data invalida vira null, sem lancar', () => {
  const c = corpo();
  c.data.purchase.date_next_charge = 'nao-e-data';
  c.data.purchase.approved_date = undefined as unknown as number;
  const e = lerWebhook(c);
  assert.ok(e);
  assert.equal(e.proximaCobranca, null);
  assert.equal(e.aprovadoEm, null);
});

const base = (p: Partial<EventoHotmart>): EventoHotmart => ({
  tipo: 'PURCHASE_APPROVED', produtoId: '1', transacao: 't', assinanteCodigo: null,
  email: 'a@b.c', nome: 'A', buyer: {}, criadoEm: null,
  proximaCobranca: null, aprovadoEm: null, plano: null, ...p,
});

test('calcularVencimento: usa proximaCobranca quando existe', () => {
  const prox = new Date('2024-01-10T00:00:00.000Z');
  assert.equal(calcularVencimento(base({ proximaCobranca: prox, aprovadoEm: new Date('2023-01-01') }))?.getTime(), prox.getTime());
});

test('calcularVencimento: senao aprovadoEm + 1 mes', () => {
  const v = calcularVencimento(base({ aprovadoEm: new Date('2024-01-15T12:00:00.000Z') }));
  assert.equal(v?.toISOString(), '2024-02-15T12:00:00.000Z');
});

test('calcularVencimento: sem nenhum dos dois retorna null (evento que nao e compra aprovada)', () => {
  assert.equal(calcularVencimento(base({ tipo: 'PURCHASE_REFUNDED' })), null);
});

test('calcularVencimento: compra aprovada sem datas usa agora + periodo do plano (nunca null)', () => {
  const agora = new Date('2024-01-31T10:00:00.000Z');
  assert.equal(calcularVencimento(base({}), agora)?.toISOString(), '2024-02-29T10:00:00.000Z');
  assert.equal(calcularVencimento(base({ plano: 'Plano Anual' }), agora)?.toISOString(), '2025-01-31T10:00:00.000Z');
});

test('lerWebhook: creation_date ausente -> criadoEm null e resto intacto', () => {
  const c = corpo() as Record<string, unknown>;
  delete c.creation_date;
  const e = lerWebhook(c);
  assert.ok(e);
  assert.equal(e.criadoEm, null);
  assert.equal(e.tipo, 'PURCHASE_APPROVED');
  assert.equal(e.transacao, 'HP123');
  assert.equal(e.email, 'ana@email.com');
  assert.equal(e.assinanteCodigo, 'SUB1');
  assert.equal(e.plano, 'Mensal');
});

test('lerWebhook: creation_date invalida -> criadoEm null', () => {
  const c = corpo() as Record<string, unknown>;
  c.creation_date = 'lixo';
  assert.equal(lerWebhook(c)?.criadoEm, null);
});

test('lerWebhook: sem creation_date e deterministico', () => {
  const c = corpo() as Record<string, unknown>;
  delete c.creation_date;
  assert.deepEqual(lerWebhook(c), lerWebhook(c));
});

test('lerWebhook: lê valor e moeda da compra; ausentes ou inválidos viram null', () => {
  const c: any = corpo();
  c.data.purchase.price = { value: 29.9, currency_value: 'brl' };
  c.data.purchase.hotmart_fee = { total: 2.5 };
  const e = lerWebhook(c)!;
  assert.equal(e.valor, 29.9);
  assert.equal(e.moeda, 'BRL');
  assert.equal(e.taxa, 2.5);
  assert.equal(lerWebhook(corpo())!.taxa, null);
  c.data.purchase.price = { value: -5 };
  assert.equal(lerWebhook(c)!.valor, null);
  assert.equal(lerWebhook(corpo())!.valor, null);
});
