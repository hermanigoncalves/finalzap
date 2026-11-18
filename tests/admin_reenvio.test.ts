import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirReenvio, tratarReenvio } from '../lib/admin/reenvio.ts';

const AGORA = new Date('2026-11-16T12:00:00Z');
const dias = (n: number) => new Date(AGORA.getTime() + n * 86400000);

test('decidirReenvio: Ativo com vencimento futuro', () => {
  assert.deepEqual(decidirReenvio({ status: 'Ativo', dataVencimento: dias(10) }, AGORA, 3), { ok: true });
});
test('decidirReenvio: vencido ha 2 dias com tolerancia 3', () => {
  assert.deepEqual(decidirReenvio({ status: 'Ativo', dataVencimento: dias(-2) }, AGORA, 3), { ok: true });
});
test('decidirReenvio: vencido ha 5 dias', () => {
  assert.deepEqual(decidirReenvio({ status: 'Ativo', dataVencimento: dias(-5) }, AGORA, 3), {
    ok: false,
    motivo: 'Assinatura vencida',
  });
});
test('decidirReenvio: Cancelado', () => {
  assert.deepEqual(decidirReenvio({ status: 'Cancelado', dataVencimento: null }, AGORA, 3), {
    ok: false,
    motivo: 'Assinatura cancelada',
  });
});
test('decidirReenvio: Inadimplente', () => {
  assert.deepEqual(decidirReenvio({ status: 'Inadimplente', dataVencimento: null }, AGORA, 3), {
    ok: false,
    motivo: 'Assinatura inadimplente',
  });
});
test('decidirReenvio: Inativo', () => {
  assert.deepEqual(decidirReenvio({ status: 'Inativo', dataVencimento: null }, AGORA, 3), {
    ok: false,
    motivo: 'Assinatura inativa',
  });
});
test('decidirReenvio: Ativo sem dataVencimento', () => {
  assert.deepEqual(decidirReenvio({ status: 'Ativo', dataVencimento: null }, AGORA, 3), { ok: true });
});

const EMAIL = 'cliente@exemplo.com';

function montar(over: Record<string, unknown> = {}, reqOver: Record<string, unknown> = {}) {
  const c = {
    validar: 0,
    papel: 0,
    buscar: 0,
    enviar: 0,
    registrar: [] as any[][],
    corpo: 0,
    logs: [] as any[][],
  };
  const ctx: any = {
    validarToken: async (t: string) => {
      c.validar++;
      return t === 'tok-admin' ? { id: 'admin-1' } : null;
    },
    papelDoUsuario: async () => {
      c.papel++;
      return 'admin';
    },
    buscarAssinatura: async (id: string) => {
      c.buscar++;
      return id === 'a1'
        ? { id: 'a1', status: 'Ativo', dataVencimento: dias(5), email: EMAIL }
        : null;
    },
    enviarEmail: async () => {
      c.enviar++;
      return 'convite';
    },
    registrarReenvio: async (...a: any[]) => {
      c.registrar.push(a);
    },
    agora: () => AGORA,
    toleranciaDias: 3,
    log: (...a: any[]) => c.logs.push(a),
    ...over,
  };
  const req: any = {
    method: 'POST',
    headers: { authorization: 'Bearer tok-admin' },
    get body() {
      c.corpo++;
      return { assinaturaId: 'a1' };
    },
    ...reqOver,
  };
  return { c, ctx, req };
}

test('405 para metodo diferente de POST', async () => {
  const { ctx, req, c } = montar({}, { method: 'GET' });
  const r = await tratarReenvio(req, ctx);
  assert.equal(r.status, 405);
  assert.equal(c.validar, 0);
});

test('401 sem cabecalho, esquema errado, token invalido e validarToken lancando', async () => {
  for (const headers of [{}, { authorization: 'Basic tok-admin' }, { authorization: 'Bearer ' }]) {
    const { ctx, req, c } = montar({}, { headers });
    const r = await tratarReenvio(req, ctx);
    assert.equal(r.status, 401);
    assert.deepEqual(r.corpo, { erro: 'não autenticado' });
    assert.equal(c.corpo, 0);
  }
  let m = montar({}, { headers: { authorization: 'Bearer ruim' } });
  assert.equal((await tratarReenvio(m.req, m.ctx)).status, 401);
  m = montar({
    validarToken: async () => {
      throw new Error(`falha ${EMAIL}`);
    },
  });
  const r = await tratarReenvio(m.req, m.ctx);
  assert.equal(r.status, 401);
  assert.equal(m.c.papel, 0);
  assert.equal(m.c.corpo, 0);
});

test('403 para usuario comum, papel nulo e papelDoUsuario lancando; nada mais e chamado', async () => {
  const papeis = [
    async () => 'user',
    async () => null,
    async () => {
      throw new Error('x');
    },
  ];
  for (const papel of papeis) {
    const { ctx, req, c } = montar({ papelDoUsuario: papel });
    const r = await tratarReenvio(req, ctx);
    assert.equal(r.status, 403);
    assert.deepEqual(r.corpo, { erro: 'acesso negado' });
    assert.equal(c.buscar, 0);
    assert.equal(c.enviar, 0);
    assert.equal(c.corpo, 0);
  }
});

test('400 para corpo ilegivel ou sem assinaturaId string; corpo so lido apos autenticar', async () => {
  const ilegivel = montar();
  Object.defineProperty(ilegivel.req, 'body', {
    get() {
      throw new Error('json invalido');
    },
  });
  let r = await tratarReenvio(ilegivel.req, ilegivel.ctx);
  assert.deepEqual(r, { status: 400, corpo: { erro: 'requisição inválida' } });
  for (const corpo of [null, {}, { assinaturaId: 5 }, 'texto']) {
    const m = montar({}, { body: corpo });
    r = await tratarReenvio(m.req, m.ctx);
    assert.equal(r.status, 400);
    assert.equal(m.c.buscar, 0);
  }
  const m = montar({}, { headers: {} });
  await tratarReenvio(m.req, m.ctx);
  assert.equal(m.c.corpo, 0);
});

test('404 para assinatura inexistente', async () => {
  const { ctx, req } = montar({}, { body: { assinaturaId: 'zzz' } });
  const r = await tratarReenvio(req, ctx);
  assert.deepEqual(r, { status: 404, corpo: { erro: 'assinatura não encontrada' } });
});

test('409 para Cancelado, Inadimplente, Inativo e vencido; sem enviar e-mail', async () => {
  const casos: [string, Date | null, string][] = [
    ['Cancelado', null, 'Assinatura cancelada'],
    ['Inadimplente', null, 'Assinatura inadimplente'],
    ['Inativo', null, 'Assinatura inativa'],
    ['Ativo', dias(-5), 'Assinatura vencida'],
  ];
  for (const [status, dataVencimento, motivo] of casos) {
    const { ctx, req, c } = montar({
      buscarAssinatura: async () => ({ id: 'a1', status, dataVencimento, email: EMAIL }),
    });
    const r = await tratarReenvio(req, ctx);
    assert.deepEqual(r, { status: 409, corpo: { erro: motivo } });
    assert.equal(c.enviar, 0);
    assert.equal(c.registrar.length, 0);
  }
});

test('200 com convite e com redefinicao; registra (assinaturaId, adminId)', async () => {
  for (const tipo of ['convite', 'redefinicao']) {
    const { ctx, req, c } = montar({ enviarEmail: async () => tipo });
    const r = await tratarReenvio(req, ctx);
    assert.deepEqual(r, { status: 200, corpo: { ok: true, tipo } });
    assert.deepEqual(c.registrar, [['a1', 'admin-1']]);
  }
});

test('500 generico quando enviarEmail lanca; nao registra; log sem PII', async () => {
  const { ctx, req, c } = montar({
    enviarEmail: async () => {
      throw new TypeError(`smtp falhou para ${EMAIL}`);
    },
  });
  const r = await tratarReenvio(req, ctx);
  assert.deepEqual(r, { status: 500, corpo: { erro: 'falha ao reenviar' } });
  assert.equal(c.registrar.length, 0);
  const todo = JSON.stringify([r, c.logs]);
  assert.ok(!todo.includes(EMAIL));
  assert.ok(!todo.includes('tok-admin'));
  assert.ok(!todo.includes('smtp falhou'));
  assert.equal(c.logs.length, 1);
  assert.deepEqual(c.logs[0], ['error', { etapa: 'enviar', erro: 'TypeError' }]);
});

test('500 quando registrarReenvio lanca, com etapa registrar e sem PII', async () => {
  const { ctx, req, c } = montar({
    registrarReenvio: async () => {
      throw new Error(EMAIL);
    },
  });
  const r = await tratarReenvio(req, ctx);
  assert.deepEqual(r, { status: 500, corpo: { erro: 'falha ao reenviar' } });
  assert.ok(!JSON.stringify(c.logs).includes(EMAIL));
  assert.deepEqual(c.logs[0], ['error', { etapa: 'registrar', erro: 'Error' }]);
});
