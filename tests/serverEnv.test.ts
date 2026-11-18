import test from 'node:test';
import assert from 'node:assert/strict';
import { segredoConfere, aplicarCors, clienteServico } from '../lib/serverEnv.ts';

test('segredoConfere: aceita só o segredo exato', () => {
  assert.equal(segredoConfere('abc123', 'abc123'), true);
  assert.equal(segredoConfere('abc124', 'abc123'), false);
  assert.equal(segredoConfere('abc', 'abc123'), false);
});

test('segredoConfere: falha fechado sem segredo configurado ou recebido', () => {
  assert.equal(segredoConfere('qualquer', undefined), false);
  assert.equal(segredoConfere('qualquer', ''), false);
  assert.equal(segredoConfere(undefined, 'abc'), false);
  assert.equal(segredoConfere('', 'abc'), false);
  assert.equal(segredoConfere(['abc'], 'abc'), false);
});

function fakeRes() {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (k: string, v: string) => { headers[k] = v; } };
}

test('aplicarCors: só libera origens da lista', () => {
  process.env.ALLOWED_ORIGINS = 'https://app.exemplo.com, http://localhost:5173';
  const ok = fakeRes();
  aplicarCors({ headers: { origin: 'https://app.exemplo.com' } }, ok, 'POST');
  assert.equal(ok.headers['Access-Control-Allow-Origin'], 'https://app.exemplo.com');

  const ruim = fakeRes();
  aplicarCors({ headers: { origin: 'https://malicioso.com' } }, ruim, 'POST');
  assert.equal(ruim.headers['Access-Control-Allow-Origin'], undefined);
});

test('aplicarCors: sem ALLOWED_ORIGINS nenhuma origem é liberada', () => {
  delete process.env.ALLOWED_ORIGINS;
  const res = fakeRes();
  aplicarCors({ headers: { origin: 'https://app.exemplo.com' } }, res, 'GET');
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});

test('clienteServico: falha sem env, nunca usa chave embutida', () => {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.throws(() => clienteServico(), /obrigat/);
  } finally {
    if (url) process.env.SUPABASE_URL = url;
    if (chave) process.env.SUPABASE_SERVICE_ROLE_KEY = chave;
  }
});
