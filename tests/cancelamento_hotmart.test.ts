import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lerTexto = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const lerJson = (rel: string) => JSON.parse(lerTexto(rel));

type Conexoes = Record<string, { main?: Array<Array<{ node: string }>>; ai_tool?: Array<Array<{ node: string }>> }>;
type No = {
  name: string;
  type: string;
  onError?: string;
  retryOnFail?: boolean;
  parameters: Record<string, unknown>;
};

function alcancaveis(connections: Conexoes, origem: string, indiceSaida?: number): Set<string> {
  const visitados = new Set<string>();
  const fila: string[] = [];
  const saidas = connections[origem]?.main ?? [];
  if (indiceSaida !== undefined) {
    for (const destino of saidas[indiceSaida] ?? []) fila.push(destino.node);
  } else {
    fila.push(origem);
  }
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

function criarLuxonFake(agoraIso = '2026-11-24T12:00:00-03:00') {
  class FakeDateTime {
    private readonly ms: number;
    readonly isValid: boolean;

    constructor(ms: number, valid: boolean) {
      this.ms = ms;
      this.isValid = valid;
    }

    static now() {
      return FakeDateTime.fromISO(agoraIso);
    }

    static fromISO(raw: string) {
      const parsed = Date.parse(raw);
      return new FakeDateTime(parsed, !Number.isNaN(parsed));
    }

    setZone() {
      return this;
    }

    valueOf() {
      return this.ms;
    }

    toFormat(fmt: string) {
      if (!this.isValid || fmt !== 'dd/MM/yyyy') return '';
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(this.ms));
    }
  }
  return FakeDateTime;
}

function executarAvaliarEtapa(
  jsCode: string,
  entrada: { telefone: string; telefone_alt: string; confirmacao_explicita: boolean },
  linhas: Array<Record<string, unknown>>,
) {
  const fn = new Function('$', '$input', 'DateTime', jsCode);
  const $ = (nome: string) => ({
    first: () => ({ json: nome === 'Quando chamado pelo FINALZAP' ? entrada : {} }),
  });
  const $input = {
    all: () => linhas.map((json) => ({ json })),
  };
  return fn($, $input, criarLuxonFake()) as Array<{ json: Record<string, unknown> }>;
}

function avaliarExpressaoEfetivou(exprRaw: string, respostaHttp: unknown): boolean {
  const corpoExpr = exprRaw.trim().replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const fn = new Function('$', `return (${corpoExpr});`);
  const $ = (nome: string) => ({
    first: () => ({ json: nome === 'Cancelar assinatura na Hotmart' ? respostaHttp : {} }),
  });
  return Boolean(fn($));
}

describe('Regras e fluxos n8n de cancelamento na Hotmart', () => {
  it('[R-008] [R-001] [R-002] orquestrador conecta cancelar_assinatura apenas após Assinatura ativa com telefone do webhook e prompt de 2 etapas', () => {
    const rawMain = lerTexto('n8n/finalzap-supabase.json');
    const rawPronto = lerTexto('n8n/finalzap-supabase-PRONTO.json');
    assert.equal(rawMain, rawPronto, 'finalzap-supabase.json e finalzap-supabase-PRONTO.json devem ser idênticos');

    const mainWf = JSON.parse(rawMain) as { nodes: No[]; connections: Conexoes };
    const subWf = lerJson('n8n/finalzap-cancelar-assinatura-hotmart.json') as { nodes: No[]; connections: Conexoes };

    const tool = mainWf.nodes.find((n) => n.name === 'cancelar_assinatura');
    assert.ok(tool, 'nó cancelar_assinatura ausente no orquestrador');
    assert.equal(tool.type, '@n8n/n8n-nodes-langchain.toolWorkflow');
    assert.equal(mainWf.connections.cancelar_assinatura?.ai_tool?.[0]?.[0]?.node, 'Assistente FINALZAP');

    const workflowId = tool.parameters.workflowId as { value?: string };
    assert.ok(workflowId?.value && !/SUBSTITUIR/i.test(workflowId.value), 'workflowId real deve estar preenchido');
    assert.equal(workflowId.value, 'c3Pv5Uvyx0lA2v48');

    const ramoAtivo = mainWf.connections['Assinatura ativa?']?.main?.[0]?.[0]?.node;
    const ramoInativo = mainWf.connections['Assinatura ativa?']?.main?.[1]?.[0]?.node;
    assert.ok(ramoAtivo && ramoInativo);
    assert.equal(alcancaveis(mainWf.connections, ramoAtivo).has('Assistente FINALZAP'), true);
    assert.equal(alcancaveis(mainWf.connections, ramoInativo).has('Assistente FINALZAP'), false);

    const inputs = (tool.parameters.workflowInputs as { value: Record<string, string> }).value;
    assert.match(inputs.telefone, /\$\('Normalizar mensagem'\)/);
    assert.match(inputs.telefone_alt, /\$\('Normalizar mensagem'\)/);
    assert.doesNotMatch(inputs.telefone, /\$fromAI/);
    assert.doesNotMatch(inputs.telefone_alt, /\$fromAI/);
    assert.match(inputs.confirmacao_explicita, /\$fromAI\('confirmacao_explicita'/);

    const assistente = mainWf.nodes.find((n) => n.name === 'Assistente FINALZAP');
    const prompt = (assistente?.parameters.options as { systemMessage: string }).systemMessage;
    assert.match(prompt, /cancelar_assinatura/);
    assert.match(prompt, /2 etapas/);
    assert.match(prompt, /confirmacao_explicita=false/);
    assert.match(prompt, /confirmacao_explicita=true/);
    assert.match(prompt, /cancelado=true/);

    assert.ok(subWf.nodes.length >= 10);
  });

  it('[R-008] sub-workflow Hotmart usa inputs tipados, credencial segura sem segredos hardcoded e endpoint oficial POST /cancel', () => {
    const rawSub = lerTexto('n8n/finalzap-cancelar-assinatura-hotmart.json');
    assert.doesNotMatch(rawSub, /Authorization["']?\s*:\s*["']Basic\s+[A-Za-z0-9+/=]{8,}/i);
    assert.doesNotMatch(rawSub, /client_secret=[A-Za-z0-9_-]{8,}/i);
    assert.doesNotMatch(rawSub, /Bearer\s+[A-Za-z0-9._-]{16,}/i);

    const subWf = JSON.parse(rawSub) as { nodes: No[]; connections: Conexoes };
    const trigger = subWf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
    assert.ok(trigger);
    assert.equal(trigger.parameters.inputSource, 'workflowInputs');
    const valoresTrigger = (trigger.parameters.workflowInputs as { values: Array<{ name: string; type: string }> }).values;
    assert.deepEqual(
      valoresTrigger.map((v) => `${v.name}:${v.type}`),
      ['telefone:string', 'telefone_alt:string', 'confirmacao_explicita:boolean'],
    );

    const gerarToken = subWf.nodes.find((n) => n.name === 'Gerar token Hotmart');
    assert.ok(gerarToken);
    assert.equal(gerarToken.parameters.method, 'POST');
    assert.equal(gerarToken.parameters.url, 'https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials');
    assert.equal(gerarToken.parameters.authentication, 'genericCredentialType');
    assert.equal(gerarToken.parameters.genericAuthType, 'httpTemplatedCustomAuth');
    assert.equal(gerarToken.retryOnFail, true);
    assert.equal(gerarToken.onError, 'continueErrorOutput');
    assert.equal(subWf.connections['Gerar token Hotmart']?.main?.[1]?.[0]?.node, 'Retornar falha Hotmart');

    const cancelarHotmart = subWf.nodes.find((n) => n.name === 'Cancelar assinatura na Hotmart');
    assert.ok(cancelarHotmart);
    assert.equal(cancelarHotmart.parameters.method, 'POST');
    assert.match(String(cancelarHotmart.parameters.url), /https:\/\/developers\.hotmart\.com\/payments\/api\/v1\/subscriptions\//);
    assert.match(String(cancelarHotmart.parameters.url), /encodeURIComponent/);
    assert.match(String(cancelarHotmart.parameters.url), /\/cancel/);
    assert.equal(cancelarHotmart.parameters.jsonBody, '{"send_mail": true}');
    assert.equal(cancelarHotmart.retryOnFail, true);
    assert.equal(cancelarHotmart.onError, 'continueErrorOutput');
    const respOpts = (cancelarHotmart.parameters.options as { response: { response: { fullResponse: boolean } } }).response.response;
    assert.equal(respOpts.fullResponse, true);
    assert.equal(subWf.connections['Cancelar assinatura na Hotmart']?.main?.[1]?.[0]?.node, 'Retornar falha Hotmart');
  });

  it('[R-008] [R-001] [R-002] atualização no Supabase e confirmação de sucesso só são alcançáveis após Hotmart efetivar cancelamento', () => {
    const subWf = lerJson('n8n/finalzap-cancelar-assinatura-hotmart.json') as { nodes: No[]; connections: Conexoes };
    const conns = subWf.connections;

    // A partir do ramo verdadeiro de Hotmart efetivou cancelamento?
    const ramoEfetivado = alcancaveis(conns, 'Hotmart efetivou cancelamento?', 0);
    assert.equal(ramoEfetivado.has('Atualizar assinatura no Supabase'), true);
    assert.equal(ramoEfetivado.has('Retornar cancelamento efetivado'), true);

    // Ramos de erro, falso ou sem confirmação jamais chegam em Atualizar assinatura no Supabase nem Retornar cancelamento efetivado
    const ramosBloqueados: Array<[string, number]> = [
      ['Buscar assinaturas do cliente', 1],
      ['Deve cancelar na Hotmart?', 1],
      ['Gerar token Hotmart', 1],
      ['Token Hotmart válido?', 1],
      ['Cancelar assinatura na Hotmart', 1],
      ['Hotmart efetivou cancelamento?', 1],
    ];
    for (const [origem, idx] of ramosBloqueados) {
      const alc = alcancaveis(conns, origem, idx);
      assert.equal(alc.has('Atualizar assinatura no Supabase'), false, `${origem}[${idx}] não pode atualizar Supabase`);
      assert.equal(alc.has('Retornar cancelamento efetivado'), false, `${origem}[${idx}] não pode confirmar sucesso`);
    }

    const upd = subWf.nodes.find((n) => n.name === 'Atualizar assinatura no Supabase');
    assert.ok(upd);
    const filtro = String(upd.parameters.filterString);
    assert.match(filtro, /id=eq\./);
    assert.match(filtro, /telefone=in\.\(/);
    assert.match(filtro, /\$\('Quando chamado pelo FINALZAP'\)/);
    assert.doesNotMatch(filtro, /\$fromAI/);

    const campos = (upd.parameters.fieldsUi as { fieldValues: Array<{ fieldId: string; fieldValue: string }> }).fieldValues;
    assert.deepEqual(campos, [{ fieldId: 'status', fieldValue: 'Cancelado' }]);
  });

  it('[R-008] Avaliar assinatura e etapa trata corretamente os 5 cenários antes de chamar a Hotmart', () => {
    const subWf = lerJson('n8n/finalzap-cancelar-assinatura-hotmart.json') as { nodes: No[] };
    const avaliar = subWf.nodes.find((n) => n.name === 'Avaliar assinatura e etapa');
    assert.ok(avaliar);
    const jsCode = String(avaliar.parameters.jsCode);

    const entradaBase = { telefone: '5511987654321', telefone_alt: '551187654321', confirmacao_explicita: false };

    const pedir = executarAvaliarEtapa(jsCode, entradaBase, [
      {
        id: 'ass-1',
        telefone: '5511987654321',
        hotmart_assinante_codigo: 'SUB123456',
        plano: 'Mensal',
        status: 'Ativo',
        data_vencimento: '2026-12-24T12:00:00-03:00',
      },
    ])[0].json;
    assert.equal(pedir.acao, 'pedir_confirmacao');
    assert.equal(pedir.cancelado, false);
    assert.equal(pedir.precisa_confirmacao, true);
    assert.equal(pedir.vencimento_formatado, '24/12/2026');

    const executar = executarAvaliarEtapa(
      jsCode,
      { ...entradaBase, confirmacao_explicita: true },
      [
        {
          id: 'ass-1',
          telefone: '5511987654321',
          hotmart_assinante_codigo: 'SUB123456',
          plano: 'Anual',
          status: 'Ativo',
          data_vencimento: '2027-11-24T12:00:00-03:00',
        },
      ],
    )[0].json;
    assert.equal(executar.acao, 'executar_hotmart');
    assert.equal(executar.subscriber_code, 'SUB123456');
    assert.equal(executar.assinatura_id, 'ass-1');

    const semCodigo = executarAvaliarEtapa(
      jsCode,
      { ...entradaBase, confirmacao_explicita: true },
      [
        {
          id: 'ass-2',
          telefone: '5511987654321',
          hotmart_assinante_codigo: '',
          plano: 'Mensal',
          status: 'Ativo',
          data_vencimento: null,
        },
      ],
    )[0].json;
    assert.equal(semCodigo.acao, 'sem_codigo_hotmart');
    assert.equal(semCodigo.cancelado, false);

    const jaCancelada = executarAvaliarEtapa(jsCode, entradaBase, [
      {
        id: 'ass-3',
        telefone: '5511987654321',
        hotmart_assinante_codigo: 'SUB999',
        plano: 'Mensal',
        status: 'Cancelado',
        data_vencimento: '2026-12-24T12:00:00-03:00',
      },
    ])[0].json;
    assert.equal(jaCancelada.acao, 'ja_cancelada');
    assert.equal(jaCancelada.ja_cancelada, true);
    assert.equal(jaCancelada.cancelado, false);

    const naoEncontrada = executarAvaliarEtapa(jsCode, entradaBase, [{}])[0].json;
    assert.equal(naoEncontrada.acao, 'nao_encontrada');
    assert.equal(naoEncontrada.cancelado, false);
  });

  it('[R-008] validação de resposta Hotmart aceita apenas efetivação real e bloqueia falhas silenciosas', () => {
    const subWf = lerJson('n8n/finalzap-cancelar-assinatura-hotmart.json') as { nodes: No[] };
    const ifEfetivou = subWf.nodes.find((n) => n.name === 'Hotmart efetivou cancelamento?');
    assert.ok(ifEfetivou);
    const conds = (ifEfetivou.parameters.conditions as { conditions: Array<{ leftValue: string }> }).conditions;
    const expr = conds[0].leftValue;

    assert.equal(avaliarExpressaoEfetivou(expr, { statusCode: 200, body: { status: 'INACTIVE' } }), true);
    assert.equal(avaliarExpressaoEfetivou(expr, { statusCode: 200, body: { status: 'CANCELLED_BY_SELLER' } }), true);

    assert.equal(avaliarExpressaoEfetivou(expr, { statusCode: 200, body: { status: 'ACTIVE' } }), false);
    assert.equal(
      avaliarExpressaoEfetivou(expr, { statusCode: 200, body: { status: 'INACTIVE', error: 'SUBSCRIPTION_ERROR' } }),
      false,
    );
    assert.equal(
      avaliarExpressaoEfetivou(expr, {
        statusCode: 200,
        body: { status: 'INACTIVE', fail_subscriptions: [{ subscriber_code: 'SUB123' }] },
      }),
      false,
    );
    assert.equal(avaliarExpressaoEfetivou(expr, { statusCode: 500, body: { status: 'INACTIVE' } }), false);
    assert.equal(avaliarExpressaoEfetivou(expr, { statusCode: 200, body: {} }), false);
  });
});
