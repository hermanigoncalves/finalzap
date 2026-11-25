import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { linhaEvento } from '../lib/hotmart/linhas.ts';

type N8nNode = {
  name: string;
  type: string;
  onError?: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
};

type N8nWorkflow = {
  nodes: N8nNode[];
  connections: Record<string, { main?: Array<Array<{ node: string; type: string; index: number }>> }>;
};

const RAIZ = resolve(import.meta.dirname, '..');
const lerTexto = (rel: string) => readFileSync(resolve(RAIZ, rel), 'utf8');
const lerJson = <T = unknown>(rel: string): T => JSON.parse(lerTexto(rel)) as T;

const dateTimeStub = {
  now: () => {
    const inst = {
      setZone: () => inst,
      setLocale: () => inst,
      toFormat: (fmt: string) => (fmt === 'yyyy-MM-dd' ? '2026-11-25' : fmt === 'yyyy-MM' ? '2026-11' : '2026-11-25T10:00:00-03:00'),
    };
    return inst;
  },
};

describe('🔒 Segurança WAHA, n8n e sanitização de payload Hotmart', () => {
  it('fluxos WAHA (finalzap-waha.json, finalzap-supabase.json e finalzap-supabase-PRONTO.json) são idênticos', () => {
    const waha = lerTexto('n8n/finalzap-waha.json');
    const supa = lerTexto('n8n/finalzap-supabase.json');
    const pronto = lerTexto('n8n/finalzap-supabase-PRONTO.json');
    assert.strictEqual(waha, supa);
    assert.strictEqual(waha, pronto);
  });

  it('fluxos WAHA não contêm nós Meta whatsApp/whatsAppTrigger e arquivos legados foram removidos', () => {
    for (const arquivo of [
      'n8n/finalzap-waha.json',
      'n8n/finalzap-supabase.json',
      'n8n/finalzap-supabase-PRONTO.json',
    ]) {
      const wf = lerJson<N8nWorkflow>(arquivo);
      const nosMeta = wf.nodes.filter((n) => /whatsApp/i.test(n.type));
      assert.deepStrictEqual(nosMeta, [], `Nós Meta encontrados em ${arquivo}`);
    }

    for (const ausente of [
      'api/whatsapp/meta.ts',
      'api/whatsapp/metricas.ts',
      'supabase/conferir_simone.sql',
      'conferir_simone.sql',
      'supabase/criar_assinatura_simone.sql',
      'criar_assinatura_simone.sql',
      'n8n/whatsapp-fin-ai-agent.json',
      'whatsapp-fin-ai-agent.json',
      'n8n/whatsapp-fin-alertas.json',
      'whatsapp-fin-alertas.json',
    ]) {
      assert.strictEqual(existsSync(resolve(RAIZ, ausente)), false, `${ausente} não deve existir`);
    }
  });

  it('nó "Mensagem no WhatsApp" exige autenticação headerAuth com credencial httpHeaderAuth', () => {
    const wf = lerJson<N8nWorkflow>('n8n/finalzap-waha.json');
    const webhook = wf.nodes.find((n) => n.name === 'Mensagem no WhatsApp');
    assert.ok(webhook, 'Nó Mensagem no WhatsApp deve existir');
    assert.strictEqual(webhook.parameters.authentication, 'headerAuth');
    assert.ok(webhook.credentials?.httpHeaderAuth, 'Credencial httpHeaderAuth obrigatória');
  });

  it('nó "Normalizar mensagem" usa /\\D/g, normaliza BR 12/13 dígitos e rejeita estrangeiro 11 dígitos e @lid sem alt', () => {
    const wf = lerJson<N8nWorkflow>('n8n/finalzap-waha.json');
    const normalizar = wf.nodes.find((n) => n.name === 'Normalizar mensagem');
    assert.ok(normalizar, 'Nó Normalizar mensagem deve existir');

    const jsCode = String(normalizar.parameters.jsCode ?? '');
    assert.match(jsCode, /\/\\D\/g/);

    const executar = new Function('$input', 'DateTime', jsCode) as (
      input: { first: () => { json: unknown } },
      dt: typeof dateTimeStub
    ) => Array<{ json: Record<string, unknown> }>;

    const rodar = (payload: Record<string, unknown>) =>
      executar({ first: () => ({ json: { body: { payload } } }) }, dateTimeStub);

    const br12 = rodar({ id: 'm1', from: '551188887777@c.us', body: 'oi' });
    assert.strictEqual(br12.length, 1);
    assert.strictEqual(br12[0].json.telefone, '5511988887777');
    assert.strictEqual(br12[0].json.telefone_alt, '551188887777');

    const br13 = rodar({ id: 'm2', from: '5511988887777@c.us', body: 'oi' });
    assert.strictEqual(br13.length, 1);
    assert.strictEqual(br13[0].json.telefone, '5511988887777');
    assert.strictEqual(br13[0].json.telefone_alt, '551188887777');

    const estrangeiro11 = rodar({ id: 'm3', from: '13105551234@c.us', body: 'hi' });
    assert.deepStrictEqual(estrangeiro11, []);

    const lidSemAlt = rodar({ id: 'm4', from: '987654321@lid', body: 'oi' });
    assert.deepStrictEqual(lidSemAlt, []);

    const lidComAlt = rodar({
      id: 'm5',
      from: '987654321@lid',
      body: 'oi',
      _data: { key: { remoteJidAlt: '5511988887777@s.whatsapp.net' } },
    });
    assert.strictEqual(lidComAlt.length, 1);
    assert.strictEqual(lidComAlt[0].json.telefone, '5511988887777');
  });

  it('nó "Enviar lembrete no WhatsApp" usa onError continueErrorOutput e conecta em "Registrar falha do lembrete"', () => {
    const wf = lerJson<N8nWorkflow>('n8n/finalzap-waha.json');
    const enviar = wf.nodes.find((n) => n.name === 'Enviar lembrete no WhatsApp');
    assert.ok(enviar, 'Nó Enviar lembrete no WhatsApp deve existir');
    assert.strictEqual(enviar.onError, 'continueErrorOutput');

    const saidas = wf.connections['Enviar lembrete no WhatsApp']?.main ?? [];
    assert.ok(saidas.length >= 2, 'Deve possuir saída de sucesso e saída de erro');
    const destinosErro = saidas[1].map((c) => c.node);
    assert.ok(destinosErro.includes('Registrar falha do lembrete'));
  });

  it('finalzap-email-convite.json escapa HTML (&, <, >, ", \') e exige https:// em link', () => {
    const wf = lerJson<N8nWorkflow>('n8n/finalzap-email-convite.json');
    const gate = wf.nodes.find((n) => n.name === 'Segredo confere?');
    assert.ok(gate, 'Nó Segredo confere? deve existir');
    const conditions = (gate.parameters.conditions as { conditions: Array<{ leftValue: string; rightValue: string; operator: { operation: string } }> }).conditions;
    const condHttps = conditions.find(
      (c) => c.leftValue.includes('body.link') && c.operator?.operation === 'startsWith' && c.rightValue === 'https://'
    );
    assert.ok(condHttps, 'Deve exigir https:// no link');

    const gmail = wf.nodes.find((n) => n.name === 'Enviar e-mail (Gmail)');
    assert.ok(gmail, 'Nó Enviar e-mail (Gmail) deve existir');
    const msg = String(gmail.parameters.message ?? '');
    for (const entidade of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
      assert.ok(msg.includes(entidade), `Template deve escapar para ${entidade}`);
    }
    assert.ok(msg.includes('.replace(/&/g'));
    assert.ok(msg.includes('.replace(/</g'));
    assert.ok(msg.includes('.replace(/>/g'));
    assert.ok(msg.includes('.replace(/"/g'));
    assert.ok(msg.includes(".replace(/'/g"));
  });

  it('linhaEvento não persiste document, checkout_phone ou address em texto claro', () => {
    const evento = { tipo: 'PURCHASE_APPROVED', transacao: 'HP999', assinanteCodigo: 'SUB999' };
    const payload = {
      email: 'comprador@dominio.com',
      buyer: {
        name: 'Maria Silva',
        email: 'comprador@dominio.com',
        document: '12345678901',
        documents: [{ value: '12345678901' }],
        checkout_phone: '11999990000',
        address: { street: 'Rua Secreta, 100', zipcode: '01000-000' },
      },
      data: {
        buyer: {
          name: 'Maria Silva',
          email: 'comprador@dominio.com',
          document: '12345678901',
          checkout_phone: '11999990000',
          address: { city: 'São Paulo' },
        },
        subscriber: {
          email: 'comprador@dominio.com',
          document: '99988877766',
          checkout_phone: '11988887777',
          address: { street: 'Av Paulista, 1' },
        },
      },
    };

    const linha = linhaEvento('chave-teste', evento, payload);
    const serializado = JSON.stringify(linha.payload);

    assert.doesNotMatch(serializado, /"document"/);
    assert.doesNotMatch(serializado, /"documents"/);
    assert.doesNotMatch(serializado, /"checkout_phone"/);
    assert.doesNotMatch(serializado, /"address"/);
    assert.doesNotMatch(serializado, /12345678901|99988877766|Rua Secreta|Av Paulista|11999990000|11988887777/);
    assert.doesNotMatch(serializado, /comprador@dominio\.com/);
    assert.match(serializado, /co\*\*\*@dominio\.com/);
  });

  it('dados do WAHA vêm exclusivamente do banco (credenciais_servico) sem formulário na tela', () => {
    const adminFront = lerTexto('frontend/src/pages/AssinaturasAdmin.tsx');
    assert.doesNotMatch(adminFront, /WAHA_URL|WAHA_API_KEY|WAHA_WEBHOOK_SECRET|wahaHook/);

    const apiWaha = lerTexto('api/admin/waha.ts');
    for (const chave of ['WAHA_URL', 'WAHA_API_KEY', 'WAHA_WEBHOOK_SECRET', 'WAHA_WEBHOOK_URL', 'WAHA_SESSION']) {
      assert.ok(apiWaha.includes(`lerCredencial(supabase, '${chave}')`), `api/admin/waha.ts deve ler ${chave} do banco`);
    }
    assert.ok(apiWaha.includes("'FinalZap'"), 'api/admin/waha.ts deve usar FinalZap como instância padrão');

    const wahaWf = lerTexto('n8n/finalzap-waha.json');
    assert.doesNotMatch(wahaWf, /session:\s*'default'/);
    assert.match(wahaWf, /session:\s*'FinalZap'/);
  });
});
