// Roda a cadeia de migrações em português num Postgres de verdade (PGlite, em memória)
// e testa as RPCs e a RLS. Pula sozinho se @electric-sql/pglite não estiver instalado:
//   npm i --no-save @electric-sql/pglite && node --test tests/sql_banco_limpo.test.mjs
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
const cadeia = [
  '20261116000001_tabelas_pt.sql',
  '20261116000002_funcoes_pt.sql',
  '20261116000003_hotmart.sql',
  '20261117000001_seguranca_rls.sql',
  '20261118000001_n8n_no_supabase.sql',
  '20261118000002_correcoes_qa.sql',
  '20261118000003_credenciais_servico.sql',
  '20261118000004_entradas_dashboard_admin.sql',
  '20261118000005_taxas_hotmart_custos_usd.sql',
  '20261118000006_resumo_admin_periodo.sql',
];

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  /* sem pglite: testes pulados */
}

describe('Banco limpo: schema mestre + RPCs + RLS', { skip: !PGlite && 'pglite não instalado' }, () => {
  let db;
  const q = async (sql) => (await db.query(sql)).rows;
  // Literais inline: parâmetros sem tipo não resolvem funções sobrecarregáveis no PGlite.
  const lit = (v) =>
    v === null ? 'null' : Array.isArray(v) ? `array[${v.map(lit).join(',')}]::uuid[]`
    : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  const rpc = async (fn, ...args) => (await q(`select public.${fn}(${args.map(lit).join(',')}) r`))[0].r;
  const T = '5511987654321';
  const T12 = '551187654321'; // mesmo celular sem o 9º dígito
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  before(async () => {
    db = new PGlite();
    // Stubs do que o Supabase fornece.
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create publication supabase_realtime;`);
  });

  it('a cadeia roda sem erro e pode rodar duas vezes', async () => {
    for (let rodada = 0; rodada < 2; rodada++) {
      for (const f of cadeia) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    const t = await q(`select count(*)::int c from pg_tables where schemaname='public'`);
    assert.equal(t[0].c, 12);
  });

  it('normaliza telefone BR', async () => {
    assert.equal((await rpc('normalizar_telefone_br', '(11) 8765-4321')), T);
    assert.equal((await rpc('normalizar_telefone_br', '+55 11 3333-4444')), '551133334444'); // fixo não ganha 9
    assert.equal((await rpc('normalizar_telefone_br', '011987654321')), T); // zero de tronco
    assert.equal((await rpc('normalizar_telefone_br', null)), null);
    assert.equal((await rpc('normalizar_telefone_br', '123')), null);
  });

  it('registrar_movimentacao: idempotência, telefone 12 x 13 dígitos, validações, mes do banco', async () => {
    await db.exec('set role service_role');
    assert.equal((await rpc('registrar_movimentacao', T, 'despesa', 50.5, 'Mercado', 'arroz', null, 'k1')).duplicado, false);
    assert.equal((await rpc('registrar_movimentacao', T12, 'despesa', 50.5, 'Mercado', 'arroz', null, 'k1')).duplicado, true);
    assert.equal((await rpc('registrar_movimentacao', T, 'despesa', 50.5, 'Mercado', 'arroz', null, 'k2')).duplicado, false);
    await rpc('registrar_movimentacao', T, 'receita', 1000, 'Salário', null, '2026-11-05', 'k3');
    assert.equal((await q(`select mes from movimentacoes where idempotency_key='k3'`))[0].mes, '2026-11');
    for (const args of [[T, 'xx', 1, 'a'], [T, 'despesa', -1, 'a'], ['123', 'despesa', 1, 'a'], [T, 'despesa', 1, ' ']]) {
      assert.equal((await rpc('registrar_movimentacao', ...args)).success, false);
    }
  });

  it('orçamento não duplica (mes nulo) e valida entrada', async () => {
    await rpc('definir_orcamento', T, 'Mercado', 300);
    await rpc('definir_orcamento', T12, 'Mercado', 400);
    assert.equal((await q(`select count(*)::int c from orcamentos`))[0].c, 1);
    assert.equal((await rpc('definir_orcamento', T, 'x', 0)).success, false);
    assert.equal((await rpc('definir_orcamento', T, 'x', 5, 'novembro')).success, false);
  });

  it('resumo_mensal e saldo_total', async () => {
    assert.equal((await rpc('resumo_mensal', T, '2026-11')).receitas, 1000);
    const hoje = (await q(`select to_char(timezone('America/Sao_Paulo',now()),'YYYY-MM') m`))[0].m;
    const r = await rpc('resumo_mensal', T, hoje);
    assert.equal(r.despesas, 101);
    assert.equal(r.orcamentos[0].gasto, 101);
    assert.equal((await rpc('resumo_mensal', T, 'novembro')).success, false);
    assert.equal((await rpc('saldo_total', T)).saldo, 899);
    assert.equal((await rpc('consultar_saldo_por_usuario', T)).sucesso, true);
    assert.equal((await rpc('filtrar_movimentacoes_periodo', T, '2026-01')).total, 3);
  });

  it('conta a pagar: valida data, deduplica, lembra, paga sem duplicar despesa', async () => {
    let r = await rpc('cadastrar_conta_a_pagar', T, 'Luz', 120, '2026-11-20', 'Casa');
    assert.equal(r.duplicado, false);
    const id = r.conta_id;
    assert.equal((await rpc('cadastrar_conta_a_pagar', T12, 'luz', 120, '2026-11-20')).duplicado, true);
    assert.equal((await rpc('cadastrar_conta_a_pagar', T, 'x', 1, '2026-02-30')).success, false);
    assert.equal((await rpc('cadastrar_conta_a_pagar', T, 'x', 1, 'amanhã')).success, false);

    await db.exec('reset role');
    await db.exec(`insert into assinaturas(telefone,status,data_vencimento)
                   values ('${T}','Ativo', now()+interval '10 days'), (null,'Ativo',null)`);
    await db.exec('set role service_role');
    assert.equal(await rpc('verificar_assinatura_ativa', T12), true);
    assert.equal(await rpc('verificar_assinatura_ativa', ''), false);
    assert.equal(await rpc('verificar_assinatura_ativa', null), false); // telefone NULL nunca casa
    assert.equal(await rpc('verificar_assinatura_ativa', '5511900000000'), false);

    r = await rpc('contas_para_lembrar', '2026-11-18');
    assert.equal(r.length, 1);
    assert.equal(r[0].contas.length, 1);

    // conta vencida: lembra uma única vez
    await db.exec(`update contas_a_pagar set vencimento=(timezone('America/Sao_Paulo',now()))::date-2, lembrete_enviado_em=null`);
    assert.equal((await rpc('contas_para_lembrar', null)).length, 1);
    assert.equal(await rpc('marcar_lembretes_enviados', [id]), 1);
    assert.equal((await rpc('contas_para_lembrar', null)).length, 0);

    r = await rpc('marcar_conta_paga_com_despesa', id, T);
    assert.equal(r.success, true);
    assert.equal(r.sucesso, true);
    const r2 = await rpc('marcar_conta_paga_com_despesa', id, T);
    assert.match(r2.message, /já estava/);
    assert.equal(r2.movimentacao_id, r.movimentacao_id);
    assert.equal((await rpc('marcar_conta_paga_com_despesa', id, '5511999999999')).success, false);
    assert.equal((await q(`select count(*)::int c from movimentacoes where idempotency_key='conta_${id}'`))[0].c, 1);
  });

  it('RLS: usuário B não vê nem paga conta de A; anon e authenticated sem RPC de escrita', async () => {
    await db.exec('reset role');
    const c = (await q(`select id from contas_a_pagar limit 1`))[0].id;
    await db.exec(`insert into auth.users(id,email) values ('${A}','a@x'),('${B}','b@x');
      insert into perfis(auth_id,telefone) values ('${A}','${T}'),('${B}','5511911112222');
      update contas_a_pagar set status='pendente', movimentacao_id=null;`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${B}'`);
    assert.equal((await q(`select count(*)::int c from movimentacoes`))[0].c, 0);
    assert.equal((await rpc('marcar_conta_paga_com_despesa', c, T)).success, false);
    await assert.rejects(() => rpc('registrar_movimentacao', T, 'despesa', 1, 'a'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${A}'`);
    // 3, não 4: o setup acima volta uma conta 'paga' para 'pendente', e isso agora remove a despesa gerada (B8).
    assert.equal((await q(`select count(*)::int c from movimentacoes`))[0].c, 3);
    assert.equal((await rpc('marcar_conta_paga_com_despesa', c, T)).success, true);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => q('select count(*) from movimentacoes'), /permission denied/); // anon sem privilégio
    await db.exec('reset role');
  });
  it('nó nativo do n8n: INSERT direto, trigger de conta paga, views e grants', async () => {
    await db.exec('reset role; set role service_role');
    const T2 = '551195555444'; // 12 dígitos: o trigger grava o canônico (13)
    const T2c = '5511995555444';
    await db.exec(`insert into movimentacoes(telefone,tipo,valor,categoria,data,idempotency_key)
                   values ('${T2}','despesa',20,'Mercado','2026-05-09','n8n:1'), ('${T2}','receita',100,'Salário','2026-05-01','n8n:2')`);
    const m = (await q(`select telefone, mes from movimentacoes where idempotency_key='n8n:1'`))[0];
    assert.deepEqual(m, { telefone: T2c, mes: '2026-05' });
    await assert.rejects(() => db.exec(`insert into movimentacoes(telefone,tipo,valor,categoria,idempotency_key) values ('${T2c}','despesa',1,'a','n8n:1')`),
      /movimentacoes_idempotency_key_key/); // 23505
    await assert.rejects(() => db.exec(`insert into movimentacoes(telefone,tipo,valor,categoria) values ('${T2c}','gasto',1,'a')`), /tipo_check/);

    await db.exec(`insert into contas_a_pagar(telefone,descricao,valor,vencimento) values ('${T2}','Luz n8n',50,'2026-06-01')`);
    const c = (await q(`select id, status, telefone from contas_a_pagar where descricao='Luz n8n'`))[0];
    assert.equal(c.status, 'pendente');
    assert.equal(c.telefone, T2c);
    await db.exec(`update contas_a_pagar set status='Pago' where id='${c.id}'`); // legado normaliza e paga
    await db.exec(`update contas_a_pagar set status='paga' where id='${c.id}'`); // 2ª vez: sem efeito
    const p = (await q(`select status, pago_em, movimentacao_id from contas_a_pagar where id='${c.id}'`))[0];
    assert.equal(p.status, 'paga');
    assert.ok(p.pago_em && p.movimentacao_id);
    assert.equal((await q(`select count(*)::int n from movimentacoes where idempotency_key='conta_${c.id}'`))[0].n, 1);
    assert.equal((await rpc('marcar_conta_paga_com_despesa', c.id, T2)).success, true); // RPC e trigger não duplicam
    assert.equal((await q(`select count(*)::int n from movimentacoes where idempotency_key='conta_${c.id}'`))[0].n, 1);

    await db.exec(`insert into contas_a_pagar(telefone,descricao,valor,vencimento,status) values ('${T2c}','Velha',5,'2026-06-01','Cancelada')`);
    await assert.rejects(() => db.exec(`update contas_a_pagar set status='paga' where descricao='Velha'`), /cancelada não pode ser paga/);

    const s1 = (await q(`select receitas::float r, despesas::float d, saldo::float s from vw_saldo where telefone='${T2c}'`))[0];
    assert.deepEqual(s1, { r: 100, d: 70, s: 30 });
    assert.equal((await q(`select count(*)::int n from vw_resumo_mensal where telefone='${T2c}' and mes='2026-05'`))[0].n, 2);

    await db.exec('reset role; set role authenticated');
    await assert.rejects(() => q('select * from vw_saldo'), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => q('select * from vw_resumo_mensal'), /permission denied/);
    await assert.rejects(() => q('select * from contas_a_pagar'), /permission denied/);
    await db.exec('reset role');
  });
  it('QA M2: custo de uma chamada de IA (fração de centavo) não arredonda para zero', async () => {
    await q(`insert into public.uso_servico(telefone, servico, custo_usd, custo_brl) values ('${T}','openai',0.000045,0.000248)`);
    const r = await q(`select custo_usd::float8 u, custo_brl::float8 b from public.uso_servico where telefone='${T}' and servico='openai' order by created_at desc limit 1`);
    assert.ok(r[0].u > 0 && r[0].b > 0);
  });

  it('QA M3: assinatura e perfil gravam o telefone canônico (13 dígitos)', async () => {
    await q(`insert into public.assinaturas(telefone, nome, email) values ('(11) 98765-1234','Teste QA','qa@teste.local')`);
    const r = await q(`select telefone from public.assinaturas where email='qa@teste.local'`);
    assert.equal(r[0].telefone, '5511987651234');
  });
  it('QA B8: desfazer o pagamento remove a despesa; apagar a despesa reabre a conta', async () => {
    const TB = '5511955550001';
    await q(`insert into public.contas_a_pagar(telefone, descricao, valor, vencimento, status) values ('${TB}','Conta B8',50,current_date,'pendente')`);
    const id = (await q(`select id from public.contas_a_pagar where telefone='${TB}'`))[0].id;
    const despesas = async () => (await q(`select count(*)::int n from public.movimentacoes where telefone='${TB}'`))[0].n;

    await q(`update public.contas_a_pagar set status='paga' where id='${id}'`);
    assert.equal(await despesas(), 1);

    // a) voltar para pendente: some a despesa e o vínculo
    await q(`update public.contas_a_pagar set status='pendente' where id='${id}'`);
    assert.equal(await despesas(), 0);
    const c1 = (await q(`select status, movimentacao_id, pago_em from public.contas_a_pagar where id='${id}'`))[0];
    assert.deepEqual(c1, { status: 'pendente', movimentacao_id: null, pago_em: null });

    // pagar de novo cria uma despesa nova (sem duplicar)
    await q(`update public.contas_a_pagar set status='paga' where id='${id}'`);
    assert.equal(await despesas(), 1);

    // b) apagar a despesa: a conta volta a pendente
    await q(`delete from public.movimentacoes where telefone='${TB}'`);
    const c2 = (await q(`select status, movimentacao_id from public.contas_a_pagar where id='${id}'`))[0];
    assert.deepEqual(c2, { status: 'pendente', movimentacao_id: null });
  });
  it('QA acesso mensal: Ativo até vencer; Cancelado só dentro do período pago; Inativo/Inadimplente nunca', async () => {
    const casos = [
      ['Ativo', `now() + interval '5 days'`, true],
      ['Ativo', `now() - interval '1 day'`, false], // sem renovação: bloqueia após o período
      ['Cancelado', `now() + interval '5 days'`, true], // cancelou, mas o mês pago continua
      ['Cancelado', `now() - interval '1 day'`, false],
      ['Cancelado', 'null', false],
      ['Inativo', `now() + interval '5 days'`, false], // reembolso/chargeback
      ['Inadimplente', `now() + interval '5 days'`, false],
    ];
    for (const [i, [status, venc, esperado]] of casos.entries()) {
      const tel = `55119777700${String(i).padStart(2, '0')}`;
      await q(`insert into public.assinaturas(telefone, nome, email, status, data_vencimento) values ('${tel}','Acesso','acesso${i}@t.local','${status}',${venc})`);
      assert.equal(await rpc('verificar_assinatura_ativa', tel), esperado, `${status} / ${venc}`);
    }
  });
  it('Login Google: religa perfil órfão só por e-mail verificado; não rouba perfil de outro nem aceita anon', async () => {
    const G = '33333333-3333-3333-3333-333333333333'; // Google, e-mail verificado
    const U = '44444444-4444-4444-4444-444444444444'; // e-mail não verificado
    const D = '55555555-5555-5555-5555-555555555555'; // dono de um perfil já ligado
    await db.exec('reset role');
    await db.exec(`
      insert into auth.users(id,email,email_confirmed_at) values
        ('${G}','cliente@x.com', now()), ('${U}','naoverificado@x.com', null), ('${D}','dono@x.com', now());
      insert into public.perfis(auth_id, telefone, email) values
        (null,'5511966660001','Cliente@X.com'),   -- órfão do cliente Google
        (null,'5511966660002','naoverificado@x.com'),
        ('${D}','5511966660003','dono@x.com');`);

    await db.exec(`set role authenticated; set request.jwt.claim.sub='${G}'`);
    assert.equal(await rpc('vincular_perfil_por_email'), true);
    await db.exec('reset role');
    assert.equal((await q(`select auth_id from public.perfis where telefone='5511966660001'`))[0].auth_id, G);

    await db.exec(`set role authenticated; set request.jwt.claim.sub='${U}'`);
    assert.equal(await rpc('vincular_perfil_por_email'), false); // e-mail não verificado: não liga
    await db.exec('reset role');
    assert.equal((await q(`select auth_id from public.perfis where telefone='5511966660002'`))[0].auth_id, null);

    // perfil que já tem dono nunca é trocado
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values ('66666666-6666-6666-6666-666666666666','dono@x.com', now())`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='66666666-6666-6666-6666-666666666666'`);
    assert.equal(await rpc('vincular_perfil_por_email'), false);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => rpc('vincular_perfil_por_email'), /permission denied/);
    await db.exec('reset role');
    assert.equal((await q(`select auth_id from public.perfis where telefone='5511966660003'`))[0].auth_id, D);
  });
  it('resumo_admin_mensal: só admin enxerga; soma entradas BRL, custos fixos e uso do mês', async () => {
    const ADM = '77777777-7777-7777-7777-777777777777';
    const USR = '88888888-8888-8888-8888-888888888888';
    await db.exec(`
      insert into auth.users(id,email) values ('${ADM}','adm@x.com'), ('${USR}','usr@x.com');
      insert into public.perfis(auth_id, telefone, email, role) values
        ('${ADM}','5511955550001','adm@x.com','admin'), ('${USR}','5511955550002','usr@x.com','user');
      insert into public.entradas(transacao, valor, moeda, taxa) values ('HP-A', 100, 'BRL', 7), ('HP-B', 50, 'USD', 3);
      insert into public.custos_fixos(telefone, descricao, valor, categoria, vencimento) values
        ('5511955550001','VPS', 30, 'servidor', current_date),
        ('5511955550001','Cancelado', 99, 'outro', current_date);
      update public.custos_fixos set status='cancelado' where descricao='Cancelado';
      insert into public.uso_servico(telefone, servico, custo_usd, custo_brl) values ('5511955550001','openai', 2, 11), ('5511955550001','whatsapp', 0, 4);`);

    await db.exec(`set role authenticated; set request.jwt.claim.sub='${USR}'`);
    assert.equal((await q(`select count(*)::int c from public.entradas`))[0].c, 0); // RLS: cliente não vê
    assert.equal(Number((await q(`select sum(entradas) s from public.resumo_admin_mensal(6)`))[0].s), 0);

    await db.exec(`set request.jwt.claim.sub='${ADM}'`);
    const linhas = await q(`select * from public.resumo_admin_mensal(6)`);
    assert.equal(linhas.length, 6);
    const atual = linhas[linhas.length - 1];
    assert.equal(atual.qtd_entradas, 1);
    assert.equal(Number(atual.entradas), 100); // USD não entra na soma em reais
    assert.equal(Number(atual.custos_fixos), 30); // cancelado fora
    assert.equal(Number(atual.taxas_hotmart), 7); // taxa em USD fora
    assert.ok(Math.abs(Number(atual.custo_servicos_usd) - 2) < 0.01); // inclui uso de outros testes
    assert.ok(Math.abs(Number(atual.custo_servicos_brl) - 4) < 0.01); // linha com USD não conta em BRL
    // período: início e fim inclusivos; fora do intervalo não conta
    const p = (await q(`select * from public.resumo_admin_periodo(current_date, current_date)`))[0];
    assert.equal(Number(p.entradas), 100);
    assert.equal(Number(p.taxas_hotmart), 7);
    assert.equal(Number(p.custos_fixos), 30);
    const vazio = (await q(`select * from public.resumo_admin_periodo(current_date - 40, current_date - 30)`))[0];
    assert.equal(Number(vazio.entradas) + Number(vazio.custos_fixos), 0);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => q(`select * from public.resumo_admin_mensal(6)`), /permission denied/);
    await db.exec('reset role');
  });
});
