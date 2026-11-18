import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.resolve('supabase/migrations/20261116000003_hotmart.sql'), 'utf8')
  .replace(/\s+/g, ' ')
  .toLowerCase();

test('cria a tabela hotmart_eventos de forma idempotente', () => {
  assert.match(sql, /create table if not exists public\.hotmart_eventos/);
});

test('chave é unique (idempotência dos webhooks)', () => {
  assert.match(sql, /chave text (not null )?unique/);
});

test('RLS ligada em hotmart_eventos, sem policy (só chave de serviço)', () => {
  assert.match(sql, /alter table public\.hotmart_eventos enable row level security/);
  assert.doesNotMatch(sql, /create policy/);
});

for (const coluna of [
  'hotmart_assinante_codigo text unique',
  'ultimo_evento_em timestamptz',
  'convite_enviado_em timestamptz',
  'convite_erro text',
  'convite_reenviado_por uuid',
  'convite_reenviado_em timestamptz',
]) {
  test(`assinaturas ganha a coluna ${coluna}`, () => {
    assert.ok(
      sql.includes(`add column if not exists ${coluna}`),
      `faltou "add column if not exists ${coluna}"`,
    );
  });
}
