// Regressões dos erros achados no QA de 2026-11-18 (n8n, datas do painel e Hotmart).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { somarDias, somarMeses } from '../frontend/src/lib/datas.ts';
import { extrairValor } from '../lib/financeiro/valor.ts';
import { calcularVencimento, lerWebhook, mapearEvento } from '../lib/hotmart/eventos.ts';
import { normalizarPlano, linhaNovaAssinatura, atualizacaoAssinatura } from '../lib/hotmart/linhas.ts';

const fluxo = JSON.parse(fs.readFileSync(new URL('../n8n/finalzap-supabase.json', import.meta.url), 'utf8'));
const no = (nome: string) => fluxo.nodes.find((n: { name: string }) => n.name === nome);

test('n8n C1: o agente lê o texto do nó Normalizar mensagem, não do item {ativa}', () => {
  assert.match(no('Assistente FINALZAP').parameters.text, /Normalizar mensagem/);
});

test('n8n onboarding: checagem de primeiro acesso antes do agente e ferramentas de recorrentes ligadas', () => {
  const prox = (n: string) => fluxo.connections[n].main[0][0].node;
  assert.equal(prox('Assinatura ativa?'), 'Recorrentes existentes');
  assert.equal(prox('Recorrentes existentes'), 'Movimentações existentes');
  assert.equal(prox('Movimentações existentes'), 'Tipo da mensagem');
  for (const t of ['cadastrar_recorrente', 'consultar_recorrentes'])
    assert.equal(fluxo.connections[t].ai_tool[0][0].node, 'Assistente FINALZAP');
  const campos = no('cadastrar_recorrente').parameters.fieldsUi.fieldValues.map((f: { fieldId: string }) => f.fieldId);
  for (const c of ['telefone', 'tipo', 'valor', 'categoria', 'descricao', 'frequencia', 'proxima_execucao', 'idempotency_key'])
    assert.ok(campos.includes(c), c);
  assert.match(no('Assistente FINALZAP').parameters.options.systemMessage, /Primeiro acesso deste cliente/);
});

test('n8n A11: log do lembrete envia tipo_lembrete e status (colunas NOT NULL)', () => {
  const campos = no('Registrar log do lembrete').parameters.fieldsUi.fieldValues.map((f: { fieldId: string }) => f.fieldId);
  assert.ok(campos.includes('tipo_lembrete') && campos.includes('status'));
  assert.match(no('Montar lembretes').parameters.jsCode, /conta_vencida/);
});

test('datas: somarDias atravessa fim de mês e ano sem depender do fuso', () => {
  assert.equal(somarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(somarDias('2026-01-01', -1), '2025-12-31');
});

test('datas: somarMeses aceita negativo e vira o ano', () => {
  assert.equal(somarMeses('2026-11', -5), '2026-06');
  assert.equal(somarMeses('2026-02', -2), '2025-12');
  assert.equal(somarMeses('2026-11', 2), '2027-01');
});

test('Hotmart A7: nome livre do plano vira Mensal/Anual (CHECK do banco)', () => {
  assert.equal(normalizarPlano('Plano Mensal Finalzap'), 'Mensal');
  assert.equal(normalizarPlano('Finalzap Anual'), 'Anual');
  assert.equal(normalizarPlano('Annual'), 'Anual');
  assert.equal(normalizarPlano(null), null);
});

test('Hotmart A7: linhas gravadas usam o plano normalizado', () => {
  const d = { codigo: 'X', status: 'Ativo', vencimento: null, ultimoEventoEm: null, email: 'a@b.c', nome: 'N', telefone: null, plano: 'Plano Anual VIP' };
  assert.equal(linhaNovaAssinatura(d).plano, 'Anual');
  assert.equal(atualizacaoAssinatura(d).plano, 'Anual');
  assert.equal(linhaNovaAssinatura({ ...d, plano: null }).plano, 'Mensal');
});

test('A9: openai está nas dependências da raiz (analisador.ts importa o pacote)', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.dependencies.openai);
});

test('M1: parser offline entende milhar, vírgula e ignora datas', () => {
  assert.equal(extrairValor('gastei 1.500,00 no mercado'), 1500);
  assert.equal(extrairValor('pizza 12.345,67'), 12345.67);
  assert.equal(extrairValor('recebi salario 3.200'), 3200);
  assert.equal(extrairValor('uber 45,90'), 45.9);
  assert.equal(extrairValor('dia 5 paguei 30 reais de luz'), 30);
  assert.equal(extrairValor('paguei R$ 89,90 dia 10'), 89.9);
});

test('M1: sem valor, não inventa R$ 10 (devolve null)', () => {
  assert.equal(extrairValor('paguei o mercado'), null);
  assert.equal(extrairValor('uber 0'), null);
  assert.equal(extrairValor('dia 5'), null);
});

test('M6: vencimento de aprovação em 31/01 não transborda para março', () => {
  const ev = (iso: string) => ({ proximaCobranca: null, aprovadoEm: new Date(iso) }) as Parameters<typeof calcularVencimento>[0];
  assert.equal(calcularVencimento(ev('2027-01-31T12:00:00Z'))!.toISOString().slice(0, 10), '2027-02-28');
  assert.equal(calcularVencimento(ev('2026-08-31T12:00:00Z'))!.toISOString().slice(0, 10), '2026-09-30');
  assert.equal(calcularVencimento(ev('2026-11-18T12:00:00Z'))!.toISOString().slice(0, 10), '2026-12-18');
});

test('n8n M11: valores do modelo entram codificados nos filtros PostgREST', () => {
  const txt = JSON.stringify(fluxo.nodes);
  assert.equal(txt.split("'&mes=eq.' + encodeURIComponent(").length - 1, 2); // consultar_movimentacoes e resumo_mensal
  assert.ok(txt.includes("'id=eq.' + encodeURIComponent("));
});

// Formatos copiados do histórico de webhooks da Hotmart (v2.0.0), com dados pessoais trocados.
const APROVADA = {
  id: '89e96388-0a94-4775-adf5-285fb77a8904',
  creation_date: 1794488243728,
  event: 'PURCHASE_APPROVED',
  version: '2.0.0',
  data: {
    product: { id: 0, name: 'Produto test postback2' },
    buyer: { email: 'comprador@example.com', name: 'Teste Comprador', checkout_phone: '11999990000' },
    purchase: { approved_date: 1511783346000, status: 'APPROVED', transaction: 'HP16015479281022' },
    subscription: { status: 'ACTIVE', plan: { id: 123, name: 'plano de teste' }, subscriber: { code: 'I9OT62C3' } },
  },
};
const CANCELAMENTO = {
  id: '0a55aa49-0700-43b8-9566-a88375c0f2bb',
  creation_date: 1794488243433,
  event: 'SUBSCRIPTION_CANCELLATION',
  version: '2.0.0',
  data: {
    actual_recurrence_value: 64.9,
    cancellation_date: 1609181285500,
    date_next_charge: 1617105600000,
    product: { id: 788921, name: 'Product name' },
    subscriber: { code: '0000aaaa', name: 'User name', email: 'test@hotmart.com', phone: { dddPhone: '', phone: '' } },
    subscription: { id: 4148584, plan: { id: 114680, name: 'Subscription Plan Name' } },
  },
};

test('Hotmart real: compra aprovada é lida (e-mail, transação, assinante, plano)', () => {
  const e = lerWebhook(APROVADA)!;
  assert.equal(e.email, 'comprador@example.com');
  assert.equal(e.transacao, 'HP16015479281022');
  assert.equal(e.assinanteCodigo, 'I9OT62C3');
  assert.equal(e.plano, 'plano de teste');
  assert.equal(calcularVencimento(e)!.toISOString().slice(0, 10), '2017-12-27');
  assert.deepEqual(mapearEvento('PURCHASE_APPROVED'), { status: 'Ativo', enviarConvite: true });
});

test('Hotmart real M5: cancelamento de assinatura (sem buyer/purchase) é lido e revoga o acesso', () => {
  const e = lerWebhook(CANCELAMENTO);
  assert.ok(e, 'não pode ser ignorado');
  assert.equal(e.email, 'test@hotmart.com');
  assert.equal(e.assinanteCodigo, '0000aaaa'); // mesmo código da compra: atualiza a mesma assinatura
  assert.equal(e.transacao, 'evt-0a55aa49-0700-43b8-9566-a88375c0f2bb');
  assert.equal(e.proximaCobranca!.getTime(), 1617105600000);
  assert.deepEqual(mapearEvento('SUBSCRIPTION_CANCELLATION'), { status: 'Cancelado', enviarConvite: false });
});

test('Hotmart real: payload sem e-mail nem id de evento continua sendo ignorado', () => {
  assert.equal(lerWebhook({ event: 'SUBSCRIPTION_CANCELLATION', data: { product: { id: 1 }, subscriber: {} } }), null);
});

test('Acesso mensal (n8n): Cancelado só vale dentro do período pago e a busca inclui Ativo e Cancelado', () => {
  assert.match(no('Buscar assinatura').parameters.filterString, /status=in\.\(Ativo,Cancelado\)/);
  assert.equal(no('Assinaturas ativas').parameters.filterString, 'status=in.(Ativo,Cancelado)');
  const codigo = no('Avaliar assinatura').parameters.jsCode;
  const avaliar = new Function('$input', codigo);
  const ev = (status: string, dias: number | null) => ({
    json: { telefone: '5511999990000', status, data_vencimento: dias === null ? null : new Date(Date.now() + dias * 864e5).toISOString() },
  });
  const ativa = (...linhas: ReturnType<typeof ev>[]) => avaliar({ all: () => linhas })[0].json.ativa;
  assert.equal(ativa(ev('Ativo', 5)), true);
  assert.equal(ativa(ev('Ativo', -1)), false); // sem renovação
  assert.equal(ativa(ev('Cancelado', 5)), true); // cancelou, mas o mês pago continua
  assert.equal(ativa(ev('Cancelado', -1)), false);
  assert.equal(ativa(ev('Cancelado', null)), false);
});
