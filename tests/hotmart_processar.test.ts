import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processarEvento, chaveEvento } from '../lib/hotmart/processar.ts';

const T0 = new Date('2026-01-10T00:00:00Z');
const T1 = new Date('2026-01-11T00:00:00Z');
const VENC = new Date('2026-02-10T00:00:00Z');
const T2 = new Date('2026-01-12T00:00:00Z');

function evento(extra: Record<string, unknown> = {}): any {
  return {
    tipo: 'PURCHASE_APPROVED',
    produtoId: '8889619',
    transacao: 'HP1',
    assinanteCodigo: 'SUB1',
    email: 'a@b.com',
    nome: 'Ana',
    buyer: {},
    criadoEm: T1,
    proximaCobranca: new Date('2026-02-10T00:00:00Z'),
    aprovadoEm: T0,
    plano: 'Mensal',
    telefone: '5511999999999',
    ...extra,
  };
}

const APROVADO = { status: 'Ativo', enviarConvite: true } as const;
const SEM_CONVITE = { status: 'Ativo', enviarConvite: false } as const;

function falsas(assinatura: any = null, falhaConvite?: Error) {
  const vistos = new Set<string>();
  let estado = assinatura; // reflete o ultimo gravarAssinatura / marcarConvite
  const chamadas = { liberar: [] as string[], gravar: [] as any[], convidar: [] as any[], marcar: [] as any[], buscar: [] as string[] };
  const deps = {
    registrarEvento: async (chave: string) => {
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    },
    liberarEvento: async (chave: string) => {
      chamadas.liberar.push(chave);
      vistos.delete(chave);
    },
    buscarAssinatura: async (codigo: string) => {
      chamadas.buscar.push(codigo);
      return estado;
    },
    gravarAssinatura: async (d: any) => {
      chamadas.gravar.push(d);
      estado = { id: '1', ultimoEventoEm: d.ultimoEventoEm, conviteEnviadoEm: estado?.conviteEnviadoEm ?? null };
    },
    convidar: async (d: any) => {
      chamadas.convidar.push(d);
      if (falhaConvite) throw falhaConvite;
    },
    marcarConvite: async (codigo: string, erro: string | null) => {
      chamadas.marcar.push([codigo, erro]);
      if (erro === null) estado = { ...estado, conviteEnviadoEm: new Date() };
    },
  };
  return { deps, chamadas };
}

test('chaveEvento e determinística: transação + tipo', () => {
  assert.equal(chaveEvento(evento()), chaveEvento(evento()));
  assert.notEqual(chaveEvento(evento()), chaveEvento(evento({ tipo: 'PURCHASE_DELAYED' })));
  assert.notEqual(chaveEvento(evento()), chaveEvento(evento({ transacao: 'HP2' })));
});

test('mesmo evento duas vezes: 2a é duplicado, grava e convida uma vez só', async () => {
  const { deps, chamadas } = falsas();
  const r1 = await processarEvento(deps, evento(), APROVADO, VENC);
  const r2 = await processarEvento(deps, evento(), APROVADO, VENC);
  assert.deepEqual(r1, { resultado: 'processado', convidou: true });
  assert.deepEqual(r2, { resultado: 'duplicado', convidou: false });
  assert.equal(chamadas.gravar.length, 1);
  assert.equal(chamadas.convidar.length, 1);
});

test('grava os dados da assinatura e o marcador de ordem', async () => {
  const { deps, chamadas } = falsas();
  await processarEvento(deps, evento(), APROVADO, VENC);
  assert.deepEqual(chamadas.gravar[0], {
    codigo: 'SUB1',
    status: 'Ativo',
    vencimento: VENC,
    ultimoEventoEm: T1,
    email: 'a@b.com',
    nome: 'Ana',
    telefone: '5511999999999',
    plano: 'Mensal',
  });
});

test('evento anterior ao ultimoEventoEm: antigo, nada gravado nem convidado', async () => {
  const { deps, chamadas } = falsas({ id: '1', ultimoEventoEm: T2, conviteEnviadoEm: null });
  const r = await processarEvento(deps, evento({ criadoEm: T1 }), APROVADO, VENC);
  assert.deepEqual(r, { resultado: 'antigo', convidou: false });
  assert.equal(chamadas.gravar.length, 0);
  assert.equal(chamadas.convidar.length, 0);
  assert.equal(chamadas.marcar.length, 0);
});

test('enviarConvite e conviteEnviadoEm nulo: convida e marca sem erro', async () => {
  const { deps, chamadas } = falsas({ id: '1', ultimoEventoEm: T0, conviteEnviadoEm: null });
  const r = await processarEvento(deps, evento(), APROVADO, VENC);
  assert.equal(r.convidou, true);
  assert.deepEqual(chamadas.convidar, [{ email: 'a@b.com', nome: 'Ana', telefone: '5511999999999' }]);
  assert.deepEqual(chamadas.marcar, [['SUB1', null]]);
});

test('convite já enviado (renovação reprocessada): não convida, mas grava', async () => {
  const { deps, chamadas } = falsas({ id: '1', ultimoEventoEm: T0, conviteEnviadoEm: T0 });
  const r = await processarEvento(deps, evento(), APROVADO, VENC);
  assert.deepEqual(r, { resultado: 'processado', convidou: false });
  assert.equal(chamadas.convidar.length, 0);
  assert.equal(chamadas.marcar.length, 0);
  assert.equal(chamadas.gravar.length, 1);
});

test('enviarConvite false: nunca convida', async () => {
  const { deps, chamadas } = falsas();
  const r = await processarEvento(deps, evento(), SEM_CONVITE, VENC);
  assert.equal(r.convidou, false);
  assert.equal(chamadas.convidar.length, 0);
  assert.equal(chamadas.gravar.length, 1);
});

test('convidar lança: marca o erro e relança', async () => {
  const { deps, chamadas } = falsas(null, new Error('falha no convite'));
  await assert.rejects(processarEvento(deps, evento(), APROVADO, VENC), /falha no convite/);
  assert.deepEqual(chamadas.marcar, [['SUB1', 'falha no convite']]);
  assert.equal(chamadas.gravar.length, 1);
});

test('telefone null: grava, convida e não lança', async () => {
  const { deps, chamadas } = falsas();
  const r = await processarEvento(deps, evento({ telefone: null }), APROVADO, VENC);
  assert.equal(r.convidou, true);
  assert.equal(chamadas.gravar[0].telefone, null);
  assert.equal(chamadas.convidar[0].telefone, null);
});

test('criadoEm null: processa, não é antigo e não regride o marcador', async () => {
  const { deps, chamadas } = falsas({ id: '1', ultimoEventoEm: T2, conviteEnviadoEm: null });
  const r = await processarEvento(deps, evento({ criadoEm: null }), APROVADO, VENC);
  assert.deepEqual(r, { resultado: 'processado', convidou: true });
  assert.equal(chamadas.gravar.length, 1);
  assert.equal(chamadas.gravar[0].ultimoEventoEm, T2);
});

test('criadoEm null em assinatura nova: marcador fica null', async () => {
  const { deps, chamadas } = falsas();
  await processarEvento(deps, evento({ criadoEm: null }), APROVADO, VENC);
  assert.equal(chamadas.gravar[0].ultimoEventoEm, null);
});

test('criadoEm mais novo avança o marcador', async () => {
  const { deps, chamadas } = falsas({ id: '1', ultimoEventoEm: T0, conviteEnviadoEm: T0 });
  await processarEvento(deps, evento({ criadoEm: T2 }), SEM_CONVITE, VENC);
  assert.equal(chamadas.gravar[0].ultimoEventoEm, T2);
});

test('assinanteCodigo null: usa a transação como código', async () => {
  const { deps, chamadas } = falsas();
  await processarEvento(deps, evento({ assinanteCodigo: null }), APROVADO, VENC);
  assert.deepEqual(chamadas.buscar, ['HP1']);
  assert.equal(chamadas.gravar[0].codigo, 'HP1');
  assert.deepEqual(chamadas.marcar, [['HP1', null]]);
});

test('vencimento informado pelo chamador é gravado como veio (inclusive null)', async () => {
  let f = falsas();
  await processarEvento(f.deps, evento(), SEM_CONVITE, VENC);
  assert.equal(f.chamadas.gravar[0].vencimento, VENC);
  f = falsas();
  await processarEvento(f.deps, evento(), SEM_CONVITE, null);
  assert.equal(f.chamadas.gravar[0].vencimento, null);
});

test('falha no convite libera o evento e a retentativa é reprocessada e convida', async () => {
  const { deps, chamadas } = falsas(null, new Error('falha no convite'));
  await assert.rejects(processarEvento(deps, evento(), APROVADO, VENC), /falha no convite/);
  assert.deepEqual(chamadas.liberar, [chaveEvento(evento())]);
  assert.deepEqual(chamadas.marcar, [['SUB1', 'falha no convite']]);
  // após liberar, registrarEvento volta a devolver true: reprocessa e tenta convidar de novo
  await assert.rejects(processarEvento(deps, evento(), APROVADO, VENC), /falha no convite/);
  assert.equal(chamadas.convidar.length, 2);
});

test('se liberarEvento também falhar, relança o erro original do convite', async () => {
  const { deps } = falsas(null, new Error('falha no convite'));
  deps.liberarEvento = async () => {
    throw new Error('falha ao liberar');
  };
  await assert.rejects(processarEvento(deps, evento(), APROVADO, VENC), /falha no convite/);
});

test('criadoEm igual ao marcador: processado e convida (não é antigo)', async () => {
  const { deps, chamadas } = falsas({ id: '1', ultimoEventoEm: T1, conviteEnviadoEm: null });
  const r = await processarEvento(deps, evento({ criadoEm: T1 }), APROVADO, VENC);
  assert.deepEqual(r, { resultado: 'processado', convidou: true });
  assert.equal(chamadas.gravar.length, 1);
});

function falhaUmaVez<T extends (...a: any[]) => Promise<any>>(fn: T, msg: string): T {
  let falhou = false;
  return (async (...a: any[]) => {
    if (!falhou) {
      falhou = true;
      throw new Error(msg);
    }
    return fn(...a);
  }) as T;
}

test('gravarAssinatura lança: libera o evento, relança e a retentativa processa', async () => {
  const { deps, chamadas } = falsas();
  deps.gravarAssinatura = falhaUmaVez(deps.gravarAssinatura, 'falha gravar');
  await assert.rejects(processarEvento(deps, evento(), APROVADO, VENC), /falha gravar/);
  assert.deepEqual(chamadas.liberar, [chaveEvento(evento())]);
  const r = await processarEvento(deps, evento(), APROVADO, VENC);
  assert.deepEqual(r, { resultado: 'processado', convidou: true });
});

test('buscarAssinatura lança: libera o evento, relança e a retentativa processa', async () => {
  const { deps, chamadas } = falsas();
  deps.buscarAssinatura = falhaUmaVez(deps.buscarAssinatura, 'falha buscar');
  await assert.rejects(processarEvento(deps, evento(), APROVADO, VENC), /falha buscar/);
  assert.deepEqual(chamadas.liberar, [chaveEvento(evento())]);
  const r = await processarEvento(deps, evento(), APROVADO, VENC);
  assert.deepEqual(r, { resultado: 'processado', convidou: true });
});

test('marcarConvite(erro) lança: ainda libera o evento e relança o erro do convite', async () => {
  const { deps, chamadas } = falsas(null, new Error('falha no convite'));
  deps.marcarConvite = async () => {
    throw new Error('falha ao marcar');
  };
  await assert.rejects(processarEvento(deps, evento(), APROVADO, VENC), /falha no convite/);
  assert.deepEqual(chamadas.liberar, [chaveEvento(evento())]);
});

test('convite OK mas marcarConvite(null) lança: processado, convidou, sem liberar', async () => {
  const { deps, chamadas } = falsas();
  deps.marcarConvite = async () => {
    throw new Error('falha ao marcar');
  };
  const r = await processarEvento(deps, evento(), APROVADO, VENC);
  assert.deepEqual(r, { resultado: 'processado', convidou: true });
  assert.equal(chamadas.liberar.length, 0);
  assert.equal(chamadas.convidar.length, 1);
});

test('compra aprovada com valor registra a entrada; sem valor não registra', async () => {
  const entradas: any[] = [];
  const { deps } = falsas();
  (deps as any).registrarEntrada = async (d: any) => { entradas.push(d); };
  await processarEvento(deps, evento({ valor: 29.9, moeda: 'BRL', taxa: 2.5 }), APROVADO, VENC);
  await processarEvento(deps, evento({ transacao: 'HP2', valor: null }), APROVADO, VENC);
  assert.deepEqual(entradas, [{ transacao: 'HP1', assinanteCodigo: 'SUB1', valor: 29.9, moeda: 'BRL', taxa: 2.5 }]);
});

test('reembolso, chargeback e cancelamento removem a entrada da transação', async () => {
  const removidas: string[] = [];
  const { deps } = falsas();
  (deps as any).removerEntrada = async (t: string) => { removidas.push(t); };
  const inativo = { status: 'Inativo', enviarConvite: false } as const;
  for (const tipo of ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_CANCELED']) {
    await processarEvento(deps, evento({ tipo, transacao: `T-${tipo}` }), inativo, null);
  }
  assert.deepEqual(removidas, ['T-PURCHASE_REFUNDED', 'T-PURCHASE_CHARGEBACK', 'T-PURCHASE_CANCELED']);
});
