import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tratarWebhook } from '../lib/hotmart/webhook.ts';
import { tokenValido } from '../lib/hotmart/hottok.ts';
import { telefoneDoComprador } from '../lib/hotmart/telefone.ts';
import {
  lerWebhook,
  mapearEvento,
  calcularVencimento,
  PRODUTO_ID,
} from '../lib/hotmart/eventos.ts';

const SEGREDO = 'segredo-de-teste';

function corpoValido(extra: { produto?: string; evento?: string } = {}): any {
  return {
    event: extra.evento ?? 'PURCHASE_APPROVED',
    creation_date: 1768000000000,
    data: {
      product: { id: extra.produto ?? PRODUTO_ID },
      buyer: { email: 'Cliente@Exemplo.com', name: 'Cliente', checkout_phone: '11999999999' },
      purchase: { transaction: 'HP123', approved_date: 1768000000000 },
      subscription: { subscriber: { code: 'SUB1' } },
    },
  };
}

function montar(sobrescrever: Record<string, unknown> = {}) {
  const chamadas = { lerWebhook: 0, criarDeps: 0, processar: [] as any[][] };
  const deps = { falsa: true };
  const ctx: any = {
    tokenValido,
    lerWebhook: (c: unknown) => {
      chamadas.lerWebhook++;
      return lerWebhook(c);
    },
    mapearEvento,
    calcularVencimento,
    telefoneDoComprador,
    processarEvento: async (...args: any[]) => {
      chamadas.processar.push(args);
      return { resultado: 'processado', convidou: true };
    },
    produtoId: PRODUTO_ID,
    hottokEsperado: SEGREDO,
    criarDeps: () => {
      chamadas.criarDeps++;
      return deps;
    },
    ...sobrescrever,
  };
  return { ctx, chamadas, deps };
}

const post = (body: unknown, token: string | null = SEGREDO) => ({
  method: 'POST',
  headers: token === null ? {} : { 'x-hotmart-hottok': token },
  body,
});

test('metodo diferente de POST -> 405', async () => {
  const { ctx, chamadas } = montar();
  const r = await tratarWebhook({ method: 'GET', headers: {}, body: undefined }, ctx);
  assert.equal(r.status, 405);
  assert.equal(chamadas.criarDeps, 0);
});

test('token errado -> 401 sem ler o corpo nem criar deps', async () => {
  const { ctx, chamadas } = montar();
  const r = await tratarWebhook(post(corpoValido(), 'errado'), ctx);
  assert.equal(r.status, 401);
  assert.deepEqual(r.corpo, { erro: 'não autorizado' });
  assert.equal(chamadas.lerWebhook, 0);
  assert.equal(chamadas.criarDeps, 0);
});

test('token ausente -> 401', async () => {
  const { ctx, chamadas } = montar();
  const r = await tratarWebhook(post(corpoValido(), null), ctx);
  assert.equal(r.status, 401);
  assert.equal(chamadas.lerWebhook, 0);
  assert.equal(chamadas.criarDeps, 0);
});

test('segredo nao configurado -> 401 mesmo com token enviado', async () => {
  for (const vazio of ['', undefined]) {
    const { ctx, chamadas } = montar({ hottokEsperado: vazio });
    const r = await tratarWebhook(post(corpoValido(), ''), ctx);
    assert.equal(r.status, 401);
    const r2 = await tratarWebhook(post(corpoValido(), 'qualquer'), ctx);
    assert.equal(r2.status, 401);
    assert.equal(chamadas.lerWebhook, 0);
    assert.equal(chamadas.criarDeps, 0);
  }
});

test('corpo malformado -> 200 ignorado', async () => {
  const { ctx, chamadas } = montar();
  for (const corpo of [undefined, null, 'texto', {}, { data: {} }]) {
    const r = await tratarWebhook(post(corpo), ctx);
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { ignorado: 'corpo' });
  }
  assert.equal(chamadas.criarDeps, 0);
  assert.equal(chamadas.processar.length, 0);
});

test('produto diferente -> 200 ignorado', async () => {
  const { ctx, chamadas } = montar();
  const r = await tratarWebhook(post(corpoValido({ produto: '999' })), ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ignorado: 'produto' });
  assert.equal(chamadas.criarDeps, 0);
  assert.equal(chamadas.processar.length, 0);
});

test('evento desconhecido -> 200 ignorado', async () => {
  const { ctx, chamadas } = montar();
  const r = await tratarWebhook(post(corpoValido({ evento: 'ALGO_NOVO' })), ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ignorado: 'evento' });
  assert.equal(chamadas.criarDeps, 0);
  assert.equal(chamadas.processar.length, 0);
});

test('compra aprovada -> 200 e processarEvento recebe telefone e vencimento calculados', async () => {
  const { ctx, chamadas, deps } = montar();
  const r = await tratarWebhook(post(corpoValido()), ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { resultado: { resultado: 'processado', convidou: true } });
  assert.equal(chamadas.criarDeps, 1);
  assert.equal(chamadas.processar.length, 1);
  const [d, e, efeito, venc] = chamadas.processar[0];
  assert.equal(d, deps);
  assert.equal(e.telefone, '5511999999999');
  assert.equal(e.email, 'cliente@exemplo.com');
  assert.deepEqual(efeito, { status: 'Ativo', enviarConvite: true });
  const esperado = new Date(1768000000000);
  esperado.setUTCMonth(esperado.getUTCMonth() + 1);
  assert.equal(venc.getTime(), esperado.getTime());
});

test('excecao em processarEvento -> 500 generico sem vazar detalhes', async () => {
  const { ctx } = montar({
    processarEvento: async () => {
      throw new Error('falhou para fulano@exemplo.com 5511999999999');
    },
  });
  const r = await tratarWebhook(post(corpoValido()), ctx);
  assert.equal(r.status, 500);
  assert.deepEqual(r.corpo, { erro: 'falha ao processar' });
});

test('excecao em criarDeps (variaveis ausentes) -> 500 generico', async () => {
  const { ctx } = montar({
    criarDeps: () => {
      throw new Error('SUPABASE_URL ausente');
    },
  });
  const r = await tratarWebhook(post(corpoValido()), ctx);
  assert.equal(r.status, 500);
  assert.deepEqual(r.corpo, { erro: 'falha ao processar' });
});

function reqComGetter(token: string | null) {
  const contador = { acessos: 0 };
  const req: any = {
    method: 'POST',
    headers: token === null ? {} : { 'x-hotmart-hottok': token },
    get body() {
      contador.acessos++;
      throw new Error('Invalid JSON');
    },
  };
  return { req, contador };
}

test('sem token ou token errado: body nunca e acessado', async () => {
  for (const t of [null, 'errado']) {
    const { ctx } = montar();
    const { req, contador } = reqComGetter(t);
    const r = await tratarWebhook(req, ctx);
    assert.equal(r.status, 401);
    assert.equal(contador.acessos, 0);
  }
});

test('token correto e getter do body lancando -> 200 ignorado corpo', async () => {
  const { ctx, chamadas } = montar();
  const { req, contador } = reqComGetter(SEGREDO);
  const r = await tratarWebhook(req, ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ignorado: 'corpo' });
  assert.equal(contador.acessos, 1);
  assert.equal(chamadas.criarDeps, 0);
});

test('excecao: log so com o NOME da excecao, sem PII; resposta generica', async () => {
  const logs: any[] = [];
  const { ctx } = montar({
    log: (nivel: string, dados: any) => logs.push({ nivel, dados }),
    processarEvento: async () => {
      const e = new TypeError('falhou fulano@exemplo.com 5511999999999');
      throw e;
    },
  });
  const r = await tratarWebhook(post(corpoValido()), ctx);
  assert.equal(r.status, 500);
  assert.deepEqual(r.corpo, { erro: 'falha ao processar' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].nivel, 'error');
  assert.equal(logs[0].dados.erro, 'TypeError');
  const serial = JSON.stringify(logs);
  assert.ok(!serial.includes('fulano@exemplo.com'));
  assert.ok(!serial.includes('5511999999999'));
  assert.ok(!serial.includes('cliente@exemplo.com'));
});

test('segredo nao configurado gera warn sem valores', async () => {
  const logs: any[] = [];
  const { ctx } = montar({
    hottokEsperado: undefined,
    log: (nivel: string, dados: any) => logs.push({ nivel, dados }),
  });
  const r = await tratarWebhook(post(corpoValido(), 'x'), ctx);
  assert.equal(r.status, 401);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].nivel, 'warn');
  assert.ok(!JSON.stringify(logs).includes('x"'.slice(0, 0) + SEGREDO));
});
