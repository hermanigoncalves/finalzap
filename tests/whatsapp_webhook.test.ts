import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../api/whatsapp/webhook.ts', import.meta.url), 'utf8');

test('webhook interno grava via RPC por telefone, sem tabela antiga nem user_id do corpo', () => {
  assert.match(src, /rpc\('registrar_movimentacao'/);
  assert.match(src, /p_idempotency_key/);
  assert.doesNotMatch(src, /from\('transacoes'\)/);
  assert.doesNotMatch(src, /user_id/);
});

test('webhook confere assinatura ativa antes de chamar a OpenAI', () => {
  assert.match(src, /rpc\('verificar_assinatura_ativa'/);
  assert.ok(src.indexOf('verificar_assinatura_ativa') < src.indexOf('analisarMensagemFinanceira(rawText'));
});

test('webhook exige message_id string nao vazia com status 400 e sem fallback null', () => {
  assert.match(src, /typeof message_id !== 'string' \|\| !message_id\.trim\(\)/);
  assert.match(src, /status\(400\)\.json\(\{ error: 'Campo message_id é obrigatório\.' \}\)/);
  assert.doesNotMatch(src, /p_idempotency_key:.*\?\s*`wa:.*\s*:\s*null/);
});
