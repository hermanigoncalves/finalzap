import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linhaNovaAssinatura,
  atualizacaoAssinatura,
  filtroOrdem,
  usuarioJaCadastrado,
  violacaoUnica,
  truncarErro,
  erroSeguro,
  gravarAssinaturaCondicional,
} from '../lib/hotmart/linhas.ts';

const base = {
  codigo: 'SUB1',
  status: 'Ativo',
  vencimento: new Date('2026-02-10T00:00:00Z'),
  ultimoEventoEm: new Date('2026-01-11T00:00:00Z'),
  email: 'a@b.com',
  nome: 'Ana',
  telefone: '5511999990000',
  plano: 'Mensal',
};

test('linha nova usa a chave hotmart_assinante_codigo e datas ISO', () => {
  const l = linhaNovaAssinatura(base);
  assert.equal(l.hotmart_assinante_codigo, 'SUB1');
  assert.equal(l.ultimo_evento_em, '2026-01-11T00:00:00.000Z');
  assert.equal(l.data_vencimento, '2026-02-10T00:00:00.000Z');
});

test('atualizacao nunca grava ultimo_evento_em nulo nem apaga campos desconhecidos', () => {
  const u = atualizacaoAssinatura({
    ...base,
    ultimoEventoEm: null,
    vencimento: null,
    telefone: null,
    plano: null,
  });
  assert.equal('ultimo_evento_em' in u, false);
  assert.equal('data_vencimento' in u, false);
  assert.equal('telefone' in u, false);
  assert.equal('plano' in u, false);
  assert.equal(u.status, 'Ativo');
});

test('filtro de ordem aceita sem marcador ou marcador menor/igual', () => {
  assert.equal(
    filtroOrdem(base.ultimoEventoEm),
    'ultimo_evento_em.is.null,ultimo_evento_em.lte.2026-01-11T00:00:00.000Z',
  );
});

test('detecta usuario ja cadastrado', () => {
  assert.equal(usuarioJaCadastrado({ code: 'email_exists' }), true);
  assert.equal(
    usuarioJaCadastrado({ message: 'A user with this email address has already been registered' }),
    true,
  );
  assert.equal(usuarioJaCadastrado({ message: 'rate limit' }), false);
  assert.equal(usuarioJaCadastrado(null), false);
});

test('violacao unica e truncamento', () => {
  assert.equal(violacaoUnica({ code: '23505' }), true);
  assert.equal(violacaoUnica({ code: '42P01' }), false);
  assert.equal(truncarErro('x'.repeat(500)).length, 300);
});

// Banco falso minimo: registra a cadeia usada por gravarAssinaturaCondicional.
function bancoFalso() {
  const chamadas: { op: string; args: unknown[] }[] = [];
  const cadeia: any = {
    upsert: (...args: unknown[]) => (chamadas.push({ op: 'upsert', args }), Promise.resolve({ error: null })),
    update: (...args: unknown[]) => (chamadas.push({ op: 'update', args }), cadeia),
    eq: (...args: unknown[]) => (chamadas.push({ op: 'eq', args }), cadeia),
    or: (...args: unknown[]) => (chamadas.push({ op: 'or', args }), cadeia),
    is: (...args: unknown[]) => (chamadas.push({ op: 'is', args }), cadeia),
    then: (res: (v: unknown) => unknown) => res({ error: null }),
  };
  return { db: { from: () => cadeia }, chamadas };
}

test('gravar com marcador aplica o filtro de ordem no update', async () => {
  const { db, chamadas } = bancoFalso();
  await gravarAssinaturaCondicional(db, base);
  const or = chamadas.find((c) => c.op === 'or');
  assert.deepEqual(or?.args, [
    'ultimo_evento_em.is.null,ultimo_evento_em.lte.2026-01-11T00:00:00.000Z',
  ]);
  assert.equal(chamadas.some((c) => c.op === 'is'), false);
});

test('gravar sem marcador filtra por ultimo_evento_em nulo e nunca envia null no payload', async () => {
  const { db, chamadas } = bancoFalso();
  await gravarAssinaturaCondicional(db, { ...base, ultimoEventoEm: null });
  const is = chamadas.find((c) => c.op === 'is');
  assert.deepEqual(is?.args, ['ultimo_evento_em', null]);
  assert.equal(chamadas.some((c) => c.op === 'or'), false);
  const upd = chamadas.find((c) => c.op === 'update');
  assert.equal('ultimo_evento_em' in (upd!.args[0] as object), false);
});

test('erro seguro usa so o code e nao vaza o e-mail da message', () => {
  const msg = erroSeguro('Falha ao convidar', {
    code: 'email_address_invalid',
    message: 'Email address "fulano@x.com" is invalid',
  } as any);
  assert.equal(msg, 'Falha ao convidar (email_address_invalid)');
  assert.equal(msg.includes('fulano@x.com'), false);
  assert.equal(erroSeguro('X', { status: 500 }), 'X (500)');
  assert.equal(erroSeguro('X', {}), 'X (desconhecido)');
});
