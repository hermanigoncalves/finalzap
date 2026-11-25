import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectarConflitos,
  extrairErroConflito,
  formatarDataHoraSP,
  montarIntervaloSP,
} from '../frontend/src/features/agenda/regras.ts';
import type { Compromisso } from '../frontend/src/features/agenda/tipos.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lerJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(raiz, rel), 'utf8'));

type DbClient = {
  exec: (sql: string) => Promise<unknown>;
  query: <T = Record<string, unknown>>(sql: string) => Promise<{ rows: T[] }>;
};

let PGliteCtor: (new () => DbClient) | null = null;
try {
  const mod = await import('@electric-sql/pglite');
  PGliteCtor = mod.PGlite as unknown as new () => DbClient;
} catch {
  PGliteCtor = null;
}

const migDir = path.join(raiz, 'supabase/migrations');
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
  '20261118000007_handle_new_user_definer.sql',
  '20261119000001_endurece_funcoes_indices.sql',
  '20261119000002_chave_conta_do_dono.sql',
  '20261119000003_vinculo_whatsapp.sql',
  '20261119000004_contas_idempotency.sql',
  '20261119000005_recorrentes_idempotency.sql',
  '20261123000001_compromissos.sql',
  '20261125000001_credenciais_waha.sql',
  '20261125000002_hardening_producao.sql',
];

function alcancaveis(connections: Record<string, { main?: Array<Array<{ node: string }>> }>, origem: string): Set<string> {
  const visitados = new Set<string>();
  const fila = [origem];
  while (fila.length) {
    const atual = fila.shift()!;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    for (const ramo of connections[atual]?.main ?? []) {
      for (const destino of ramo) fila.push(destino.node);
    }
  }
  return visitados;
}

describe('Regras puras e fluxos n8n da Agenda', () => {
  it('[R-001] gerenciar_agenda fica ligado ao Assistente FINALZAP apenas após Assinatura ativa', () => {
    const wf = lerJson('n8n/finalzap-supabase.json');
    const tool = wf.nodes.find((n: { name: string }) => n.name === 'gerenciar_agenda');
    assert.ok(tool, 'nó gerenciar_agenda ausente');
    assert.equal(tool.type, '@n8n/n8n-nodes-langchain.toolWorkflow');
    assert.equal(wf.connections.gerenciar_agenda?.ai_tool?.[0]?.[0]?.node, 'Assistente FINALZAP');

    const ramoAtivo = wf.connections['Assinatura ativa?']?.main?.[0]?.[0]?.node;
    const ramoInativo = wf.connections['Assinatura ativa?']?.main?.[1]?.[0]?.node;
    assert.ok(ramoAtivo && ramoInativo);
    assert.equal(alcancaveis(wf.connections, ramoAtivo).has('Assistente FINALZAP'), true);
    assert.equal(alcancaveis(wf.connections, ramoInativo).has('Assistente FINALZAP'), false);
  });

  it('[R-002] telefone e filtros vêm sempre do webhook, nunca de $fromAI', () => {
    const mainWf = lerJson('n8n/finalzap-supabase.json');
    const agendaWf = lerJson('n8n/finalzap-agente-agenda.json');

    const toolMain = mainWf.nodes.find((n: { name: string }) => n.name === 'gerenciar_agenda');
    const inputs = toolMain.parameters.workflowInputs.value;
    assert.match(inputs.telefone, /\$\('Normalizar mensagem'\)/);
    assert.match(inputs.telefone_alt, /\$\('Normalizar mensagem'\)/);
    assert.doesNotMatch(inputs.telefone, /\$fromAI/);
    assert.doesNotMatch(inputs.telefone_alt, /\$fromAI/);

    const toolsAgenda = agendaWf.nodes.filter((n: { type: string }) => n.type === 'n8n-nodes-base.supabaseTool');
    assert.equal(toolsAgenda.length, 4);
    for (const t of toolsAgenda) {
      const serializado = JSON.stringify(t.parameters);
      assert.match(serializado, /\$\('Quando chamado pelo FINALZAP'\)/, t.name);
      const campoTel = t.parameters.fieldsUi?.fieldValues?.find((f: { fieldId: string }) => f.fieldId === 'telefone');
      if (campoTel) assert.doesNotMatch(campoTel.fieldValue, /\$fromAI/, t.name);
    }
  });

  it('[R-003] Assistente FINALZAP integra registrar_movimentacao e gerenciar_agenda no mesmo número', () => {
    const wf = lerJson('n8n/finalzap-supabase.json');
    const assistente = wf.nodes.find((n: { name: string }) => n.name === 'Assistente FINALZAP');
    assert.equal(wf.connections.registrar_movimentacao?.ai_tool?.[0]?.[0]?.node, 'Assistente FINALZAP');
    assert.equal(wf.connections.gerenciar_agenda?.ai_tool?.[0]?.[0]?.node, 'Assistente FINALZAP');
    assert.match(assistente.parameters.options.systemMessage, /gerenciar_agenda/);
  });

  it('[R-004] montarIntervaloSP usa America/Sao_Paulo, assume 60min padrão e valida fim > inicio', () => {
    const noite = montarIntervaloSP('2026-12-10', '22:30');
    assert.deepEqual(noite, {
      inicio: '2026-12-10T22:30:00-03:00',
      fim: '2026-12-10T23:30:00-03:00',
    });

    const virada = montarIntervaloSP('2026-12-10', '23:30');
    assert.deepEqual(virada, {
      inicio: '2026-12-10T23:30:00-03:00',
      fim: '2026-12-11T00:30:00-03:00',
    });

    assert.deepEqual(formatarDataHoraSP('2026-12-10T22:30:00-03:00'), {
      data: '10/12/2026',
      hora: '22:30',
      dataISO: '2026-12-10',
    });

    assert.throws(() => montarIntervaloSP('2026-12-10', '15:00', '14:00'));
    assert.throws(() => montarIntervaloSP('2026-12-10', '15:00', '15:00'));
  });

  it('[R-005] detectarConflitos bloqueia sobreposição e ignora adjacentes, cancelados e o próprio id', () => {
    const base: Compromisso[] = [
      {
        id: 'c1',
        telefone: '5511987654321',
        titulo: 'Dentista',
        descricao: null,
        local: null,
        inicio: '2026-12-10T14:00:00-03:00',
        fim: '2026-12-10T15:00:00-03:00',
        status: 'agendado',
        permitir_conflito: false,
        fonte: 'whatsapp',
        created_at: '2026-11-23T10:00:00Z',
        updated_at: '2026-11-23T10:00:00Z',
      },
      {
        id: 'c2',
        telefone: '5511987654321',
        titulo: 'Cancelado',
        descricao: null,
        local: null,
        inicio: '2026-12-10T15:00:00-03:00',
        fim: '2026-12-10T16:00:00-03:00',
        status: 'cancelado',
        permitir_conflito: false,
        fonte: 'painel',
        created_at: '2026-11-23T10:00:00Z',
        updated_at: '2026-11-23T10:00:00Z',
      },
    ];

    assert.equal(detectarConflitos({ inicio: '2026-12-10T14:30:00-03:00', fim: '2026-12-10T15:30:00-03:00' }, base).length, 1);
    assert.equal(detectarConflitos({ inicio: '2026-12-10T15:00:00-03:00', fim: '2026-12-10T16:00:00-03:00' }, base).length, 0);
    assert.equal(detectarConflitos({ id: 'c1', inicio: '2026-12-10T14:30:00-03:00', fim: '2026-12-10T15:30:00-03:00' }, base).length, 0);
    assert.equal(
      extrairErroConflito(new Error('CONFLITO_HORARIO: Já existe compromisso neste horário: Dentista (10/12/2026 14:00-15:00).')),
      'Já existe compromisso neste horário: Dentista (10/12/2026 14:00-15:00).',
    );
  });

  it('[R-006] remarcar e cancelar exigem id, filtro do próprio telefone e status agendado', () => {
    const agendaWf = lerJson('n8n/finalzap-agente-agenda.json');
    const agente = agendaWf.nodes.find((n: { name: string }) => n.name === 'Agente de Agenda');
    assert.match(agente.parameters.options.systemMessage, /consultar_compromissos/);

    for (const nome of ['remarcar_compromisso', 'cancelar_compromisso']) {
      const no = agendaWf.nodes.find((n: { name: string }) => n.name === nome);
      assert.ok(no, nome);
      const filtro = no.parameters.filterString as string;
      assert.match(filtro, /id=eq\./, nome);
      assert.match(filtro, /encodeURIComponent/, nome);
      assert.match(filtro, /telefone=in\.\(/, nome);
      assert.match(filtro, /status=eq\.agendado/, nome);
    }
  });

  it('[R-007] áudio segue o mesmo fluxo do texto e agendamento envia idempotency_key wa:<msg>', () => {
    const mainWf = lerJson('n8n/finalzap-supabase.json');
    const agendaWf = lerJson('n8n/finalzap-agente-agenda.json');
    assert.equal(mainWf.connections['Transcrever áudio']?.main?.[0]?.[0]?.node, 'Assistente FINALZAP');

    const criar = agendaWf.nodes.find((n: { name: string }) => n.name === 'agendar_compromisso');
    const idem = criar.parameters.fieldsUi.fieldValues.find((f: { fieldId: string }) => f.fieldId === 'idempotency_key');
    assert.ok(idem);
    assert.match(idem.fieldValue, /wa:/);
    assert.match(idem.fieldValue, /message_id/);
  });
});

describe('Banco de dados e RLS de compromissos (PGlite)', { skip: !PGliteCtor && 'pglite não instalado' }, () => {
  let db: DbClient;
  const q = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
  const T_A_13 = '5511987654321';
  const T_A_12 = '551187654321';
  const T_B = '5511911112222';
  const UID_A = '11111111-1111-1111-1111-111111111111';
  const UID_B = '22222222-2222-2222-2222-222222222222';

  before(async () => {
    db = new PGliteCtor!();
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create publication supabase_realtime;`);
    for (const f of cadeia) {
      await db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
    }
    await db.exec(`
      insert into auth.users(id, email) values ('${UID_A}', 'a@t.local'), ('${UID_B}', 'b@t.local');
      insert into public.perfis(auth_id, telefone, nome) values ('${UID_A}', '${T_A_13}', 'Ana'), ('${UID_B}', '${T_B}', 'Beto');
      insert into public.assinaturas(telefone, nome, email, status, data_vencimento)
      values ('${T_A_13}', 'Ana', 'a@t.local', 'Ativo', now() + interval '30 days');
    `);
  });

  it('[R-002] [R-003] canoniza telefone no INSERT, não cria linhas financeiras e isola por RLS', async () => {
    await db.exec('reset role');
    await db.exec(`
      insert into public.compromissos(telefone, titulo, inicio, fim, fonte)
      values ('${T_A_12}', 'Dentista', '2026-12-10T14:00:00-03:00', '2026-12-10T15:00:00-03:00', 'whatsapp');
    `);
    const rows = await q<{ telefone: string }>(`select telefone from public.compromissos where titulo='Dentista'`);
    assert.equal(rows[0]?.telefone, T_A_13);
    assert.equal((await q<{ n: number }>(`select count(*)::int n from public.movimentacoes`))[0]?.n, 0);
    assert.equal((await q<{ n: number }>(`select count(*)::int n from public.contas_a_pagar`))[0]?.n, 0);

    await db.exec(`set role authenticated; set request.jwt.claim.sub='${UID_B}'`);
    assert.equal((await q<{ n: number }>(`select count(*)::int n from public.compromissos`))[0]?.n, 0);
    await assert.rejects(
      () => db.exec(`insert into public.compromissos(telefone, titulo, inicio, fim, fonte) values ('${T_A_13}', 'Invasão', '2026-12-11T10:00:00-03:00', '2026-12-11T11:00:00-03:00', 'painel')`),
      /row-level security/,
    );

    await db.exec(`set request.jwt.claim.sub='${UID_A}'`);
    assert.equal((await q<{ n: number }>(`select count(*)::int n from public.compromissos`))[0]?.n, 1);

    await db.exec('reset role; set role anon');
    await assert.rejects(() => q(`select * from public.compromissos`), /permission denied/);
    await db.exec('reset role');
  });

  it('[R-004] [R-005] banco bloqueia fim <= inicio e conflito de horário, mas permite adjacente, própria remarcação e confirmação explícita', async () => {
    await db.exec('reset role');
    await assert.rejects(
      () => db.exec(`insert into public.compromissos(telefone, titulo, inicio, fim) values ('${T_A_13}', 'Inválido', '2026-12-10T15:00:00-03:00', '2026-12-10T15:00:00-03:00')`),
      /compromissos_fim_maior_inicio/,
    );

    await assert.rejects(
      () => db.exec(`insert into public.compromissos(telefone, titulo, inicio, fim) values ('${T_A_12}', 'Choque', '2026-12-10T14:30:00-03:00', '2026-12-10T15:30:00-03:00')`),
      /CONFLITO_HORARIO/,
    );

    await db.exec(`insert into public.compromissos(telefone, titulo, inicio, fim) values ('${T_A_13}', 'Adjacente', '2026-12-10T15:00:00-03:00', '2026-12-10T16:00:00-03:00')`);

    const dentista = (await q<{ id: string }>(`select id from public.compromissos where titulo='Dentista'`))[0]!;
    await db.exec(`update public.compromissos set inicio='2026-12-10T14:15:00-03:00', fim='2026-12-10T14:45:00-03:00' where id='${dentista.id}'`);

    await db.exec(`insert into public.compromissos(telefone, titulo, inicio, fim, permitir_conflito) values ('${T_A_13}', 'Confirmado', '2026-12-10T14:20:00-03:00', '2026-12-10T14:50:00-03:00', true)`);
    await db.exec(`update public.compromissos set status='cancelado' where titulo='Confirmado'`);
  });

  it('[R-006] [R-007] usuário B não altera nem cancela compromisso de A e idempotency_key bloqueia duplicação no WhatsApp', async () => {
    await db.exec('reset role');
    const alvo = (await q<{ id: string }>(`select id from public.compromissos where titulo='Dentista'`))[0]!;

    await db.exec(`set role authenticated; set request.jwt.claim.sub='${UID_B}'`);
    const upd = await q(`update public.compromissos set status='cancelado' where id='${alvo.id}' returning id`);
    assert.equal(upd.length, 0);

    await db.exec('reset role');
    await db.exec(`
      insert into public.compromissos(telefone, titulo, inicio, fim, fonte, idempotency_key)
      values ('${T_B}', 'Call', '2026-12-12T09:00:00-03:00', '2026-12-12T10:00:00-03:00', 'whatsapp', 'wa:wamid-1:abc');
    `);
    await assert.rejects(
      () => db.exec(`
        insert into public.compromissos(telefone, titulo, inicio, fim, fonte, idempotency_key)
        values ('${T_B}', 'Call', '2026-12-12T11:00:00-03:00', '2026-12-12T12:00:00-03:00', 'whatsapp', 'wa:wamid-1:abc');
      `),
      /duplicate key/,
    );

    await db.exec(`
      insert into public.compromissos(telefone, titulo, inicio, fim, fonte, idempotency_key)
      values
        ('${T_B}', 'Painel 1', '2026-12-13T09:00:00-03:00', '2026-12-13T10:00:00-03:00', 'painel', null),
        ('${T_B}', 'Painel 2', '2026-12-13T10:00:00-03:00', '2026-12-13T11:00:00-03:00', 'painel', null);
    `);
  });

  it('[DSEC-04] assinatura Inativo bloqueia leitura e escrita em compromissos via RLS', async () => {
    await db.exec('reset role');
    await db.exec(`update public.assinaturas set status='Inativo' where telefone='${T_A_13}'`);
    try {
      await db.exec(`set role authenticated; set request.jwt.claim.sub='${UID_A}'`);
      assert.equal((await q<{ n: number }>(`select count(*)::int n from public.compromissos`))[0]?.n, 0);
      await assert.rejects(
        () => db.exec(`insert into public.compromissos(telefone, titulo, inicio, fim, fonte) values ('${T_A_13}', 'Bloqueado', '2026-12-14T10:00:00-03:00', '2026-12-14T11:00:00-03:00', 'painel')`),
        /row-level security/,
      );
      const upd = await q(`update public.compromissos set status='cancelado' where telefone='${T_A_13}' returning id`);
      assert.equal(upd.length, 0);
    } finally {
      await db.exec('reset role');
      await db.exec(`update public.assinaturas set status='Ativo' where telefone='${T_A_13}'`);
    }
  });
});
