# Hotmart → assinatura → convite por e-mail: Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** Quando um cliente paga o FINALZAP na Hotmart, o sistema registra a assinatura, cria o perfil e envia o convite por e-mail; o admin pode reenviar o convite se a assinatura estiver válida; clientes sem assinatura válida não acessam o app.

**Arquitetura:** Funções da Vercel (`api/`) recebem o webhook da Hotmart e o pedido de reenvio do admin. A regra de negócio fica em módulos TypeScript **puros** em `lib/hotmart/` e `lib/admin/` (testáveis sem rede). O acesso ao Supabase com chave de serviço acontece só no servidor.

**Stack:** TypeScript, Vercel Functions, Supabase (Auth admin API + Postgres), React 19 (front), testes com `node --test` (Node 24 executa `.ts` direto).

**Spec:** `docs/superpowers/specs/2026-11-16-hotmart-convite-design.md`

## Restrições globais

- Produto Hotmart aceito: **`8889619`**. Outro produto é ignorado com 200.
- Valores de `assinaturas.status` **exatamente**: `'Ativo'`, `'Inativo'`, `'Cancelado'`, `'Inadimplente'`. Valores de `perfis.role`: `'user'`, `'admin'`.
- Telefone: **só dígitos, com DDI 55** (ex.: `5511999999999`).
- E-mail: sempre minúsculo e sem espaços antes de gravar ou comparar.
- Variáveis de ambiente (sem valor padrão no código; ausentes → erro 500 claro): `HOTMART_HOTTOK`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`.
- **Nenhum token de demonstração** nos endpoints novos (não usar `lib/auth/jwtAuth.ts`).
- Módulos puros (`lib/hotmart/*.ts`, `lib/admin/*.ts`) **não importam outros arquivos relativos**, para rodarem em `node --test`. Quem precisa de dois módulos os recebe por parâmetro ou o handler os junta.
- Os handlers em `api/` importam com caminho sem extensão, como o resto do projeto.
- Tolerância após vencimento: `TOLERANCIA_DIAS = 3` (decisão provisória, ajustável em um único lugar).
- Nomes de evento da Hotmart são **a confirmar** com o payload do botão de teste (Tarefa 8); a lista de nomes fica numa constante única.

## Foco de revisão

1. O **mesmo evento duas vezes** não cria duas assinaturas nem envia dois e-mails.
2. Chamada com **`hottok` errado ou ausente** não grava nada (401).
3. **Renovação** não reenvia convite; **cancelamento antes da aprovação** (evento fora de ordem) não derruba uma assinatura mais nova.
4. **Cliente que já existe** no Supabase Auth (mesmo e-mail) não quebra o webhook nem recebe convite duplicado.
5. **Telefone vazio ou inválido** na compra: assinatura criada, convite enviado, erro registrado no log, nada de 500 por isso.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `finalzap/supabase/finalzap_hotmart.sql` (novo; pasta do schema novo, fora do repositório git) | tabela `hotmart_eventos` e colunas novas em `assinaturas` |
| `lib/hotmart/hottok.ts` (novo) | validar o token do webhook |
| `lib/hotmart/telefone.ts` (novo) | extrair e normalizar o telefone do comprador |
| `lib/hotmart/eventos.ts` (novo) | ler o corpo do webhook, mapear evento → status, calcular vencimento |
| `lib/hotmart/processar.ts` (novo) | orquestra o processamento com dependências injetadas |
| `lib/supabaseAdmin.ts` (novo) | cliente Supabase com chave de serviço, sem padrões |
| `lib/admin/reenvio.ts` (novo) | decidir se o reenvio é permitido |
| `api/hotmart/webhook.ts` (novo) | endpoint do webhook |
| `api/admin/reenviar-convite.ts` (novo) | endpoint de reenvio |
| `frontend/src/pages/DefinirSenha.tsx`, `frontend/src/lib/senha.ts` (novos) | tela de definir senha pelo link |
| `frontend/src/components/AssinaturaGuard.tsx` (novo) | bloqueio sem assinatura válida |
| `frontend/src/pages/AssinaturasAdmin.tsx`, `frontend/src/lib/financeService.ts`, `frontend/src/App.tsx` (mod.) | botão de reenvio, chamadas, rotas |
| `tests/*.test.ts` (novos), `package.json` (mod.) | testes |

---

### Task 1: Banco (migração)

**Arquivos:**
- Criar: `finalzap/supabase/finalzap_hotmart.sql`
- Testar: `tests/sql_hotmart.test.ts`

**Interfaces:**
- Produz: tabela `public.hotmart_eventos(id uuid pk, chave text unique, tipo text, transacao text, assinante_codigo text, recebido_em timestamptz default now(), payload jsonb)`; colunas em `assinaturas`: `hotmart_assinante_codigo text unique`, `ultimo_evento_em timestamptz`, `convite_enviado_em timestamptz`, `convite_erro text`, `convite_reenviado_por uuid`, `convite_reenviado_em timestamptz`.

- [ ] **Passo 1: Teste (falha).** `sql_hotmart.test.ts` lê o arquivo e confirma: `create table if not exists public.hotmart_eventos`, `unique` em `chave`, `alter table public.hotmart_eventos enable row level security` (sem policy: só a chave de serviço acessa), e `add column if not exists` para as 6 colunas acima.
- [ ] **Passo 2: Rodar.** `node --test tests/sql_hotmart.test.ts` → FAIL (arquivo inexistente).
- [ ] **Passo 3: Escrever o SQL** usando `if not exists` em tudo, para poder rodar duas vezes.
- [ ] **Passo 4: Rodar.** → PASS.
- [ ] **Passo 5: Aplicar no Supabase** (SQL Editor) e conferir: `select column_name from information_schema.columns where table_name='assinaturas'` lista as colunas novas.
- [ ] **Passo 6: Commit.** `git add tests/sql_hotmart.test.ts && git commit -m "feat(db): tabela de eventos Hotmart e colunas de convite"` (o `.sql` fica fora do repositório; copiar também para `WhatsApp-Fin/supabase/migrations/` se a dona quiser versionar).

---

### Task 2: Validar o token do webhook

**Arquivos:** Criar `lib/hotmart/hottok.ts`, `tests/hotmart_hottok.test.ts`.

**Interfaces:** Produz `tokenValido(recebido: string | string[] | undefined, esperado: string | undefined): boolean`.

- [ ] **Passo 1: Testes (falham).** `tokenValido('abc','abc')` → true; `'abc'` vs `'abd'` → false; `undefined` recebido → false; `esperado` vazio ou `undefined` → **false** (nunca aceita quando o segredo não está configurado); tamanhos diferentes → false sem lançar erro; array de cabeçalhos → false.
- [ ] **Passo 2: Rodar → FAIL.** `node --test tests/hotmart_hottok.test.ts`
- [ ] **Passo 3: Implementar** com `crypto.timingSafeEqual` (comparar os buffers só quando têm o mesmo tamanho).
- [ ] **Passo 4: Rodar → PASS. Passo 5: Commit.** `feat(hotmart): valida hottok em tempo constante`

---

### Task 3: Telefone do comprador

**Arquivos:** Criar `lib/hotmart/telefone.ts`, `tests/hotmart_telefone.test.ts`.

**Interfaces:** Produz `normalizarTelefone(entrada: unknown): string | null` e `telefoneDoComprador(buyer: Record<string, unknown> | undefined): string | null`.

- [ ] **Passo 1: Testes (falham).** `'(11) 99999-9999'` → `'5511999999999'`; `'+55 11 99999-9999'` → igual; `'5511999999999'` → igual; `'11999999999'` → `'5511999999999'`; `''`, `'abc'`, `'123'`, `null` → `null`. `telefoneDoComprador` lê, nesta ordem, `checkout_phone` e `phone` (a confirmar no payload de teste, Tarefa 8) e junta o DDI quando vier separado em `checkout_phone_code`.
- [ ] **Passo 2–4: rodar (FAIL), implementar (aceitar 10 ou 11 dígitos sem DDI, e 12 ou 13 começando por 55), rodar (PASS).**
- [ ] **Passo 5: Commit.** `feat(hotmart): normaliza telefone do comprador`

---

### Task 3b: Eventos, status e vencimento

**Arquivos:** Criar `lib/hotmart/eventos.ts`, `tests/hotmart_eventos.test.ts`.

**Interfaces:**
- Produz:
  - `type StatusAssinatura = 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente'`
  - `type EventoHotmart = { tipo: string; produtoId: string; transacao: string; assinanteCodigo: string | null; email: string; nome: string; buyer: Record<string, unknown>; criadoEm: Date; proximaCobranca: Date | null; aprovadoEm: Date | null; plano: string | null }`
  - `lerWebhook(corpo: unknown): EventoHotmart | null` (retorna `null` se faltar produto, transação ou e-mail)
  - `const PRODUTO_ID = '8889619'`
  - `type Efeito = { status: StatusAssinatura; enviarConvite: boolean } | null`
  - `mapearEvento(tipo: string): Efeito` (`null` = ignorar)
  - `calcularVencimento(e: EventoHotmart): Date | null`
  - `const TOLERANCIA_DIAS = 3`

- [ ] **Passo 1: Testes (falham).**
  - `mapearEvento('PURCHASE_APPROVED')` → `{status:'Ativo', enviarConvite:true}`; `'PURCHASE_COMPLETE'` → `{status:'Ativo', enviarConvite:false}`; `'PURCHASE_DELAYED'` → `Inadimplente`; `'PURCHASE_CANCELED'`, `'PURCHASE_REFUNDED'`, `'PURCHASE_CHARGEBACK'`, `'SUBSCRIPTION_CANCELLATION'` → `Cancelado`; `'ALGUM_EVENTO_NOVO'` → `null`.
  - `lerWebhook` com um corpo de exemplo completo devolve os campos; sem `buyer.email` → `null`; e-mail `' Ana@Email.COM '` vira `'ana@email.com'`.
  - `calcularVencimento`: usa `proximaCobranca` quando existe; senão `aprovadoEm` + 1 mês; sem nenhum dos dois → `null`.
- [ ] **Passo 2–4: FAIL, implementar (mapa dos nomes de evento numa constante única), PASS.**
- [ ] **Passo 5: Commit.** `feat(hotmart): leitura de eventos, mapeamento de status e vencimento`

---

### Task 4: Processar o evento (regras de negócio)

**Arquivos:** Criar `lib/hotmart/processar.ts`, `tests/hotmart_processar.test.ts`.

**Interfaces:**
- Consome: tipos `EventoHotmart`, `Efeito` (Tarefa 3b), declarados de novo neste arquivo como tipos estruturais (módulo puro, sem importar outro arquivo).
- Produz:
  - `type Deps = { registrarEvento(chave: string, e: EventoHotmart): Promise<boolean>` (true = novo, false = já visto); `buscarAssinatura(codigo: string): Promise<{ id: string; ultimoEventoEm: Date | null; conviteEnviadoEm: Date | null } | null>`; `gravarAssinatura(dados: { codigo: string; status: string; vencimento: Date | null; ultimoEventoEm: Date; email: string; nome: string; telefone: string | null; plano: string | null }): Promise<void>`; `convidar(dados: { email: string; nome: string; telefone: string | null }): Promise<void>`; `marcarConvite(codigo: string, erro: string | null): Promise<void>` }`
  - `processarEvento(deps: Deps, e: EventoHotmart, efeito: NonNullable<Efeito>): Promise<{ resultado: 'duplicado' | 'antigo' | 'processado'; convidou: boolean }>`
  - `chaveEvento(e: EventoHotmart): string` (transação + tipo)

- [ ] **Passo 1: Testes com dependências falsas (falham).**
  - mesmo evento duas vezes → 2ª devolve `'duplicado'`, `gravarAssinatura` e `convidar` chamados **uma** vez no total.
  - evento com `criadoEm` anterior ao `ultimoEventoEm` da assinatura → `'antigo'`, nada gravado.
  - `enviarConvite: true` e `conviteEnviadoEm` nulo → `convidar` chamado e `marcarConvite(codigo, null)`.
  - `enviarConvite: true` mas `conviteEnviadoEm` já preenchido (renovação reprocessada) → **não** convida.
  - `enviarConvite: false` → nunca convida.
  - `convidar` lança erro → `marcarConvite(codigo, mensagem)` é chamado e o erro é **relançado** (o handler responde 500 para a Hotmart tentar de novo).
  - telefone `null` → assinatura gravada, convite enviado, sem lançar erro.
- [ ] **Passo 2–4: FAIL, implementar, PASS.**
- [ ] **Passo 5: Commit.** `feat(hotmart): regras de processamento com idempotência e ordem de eventos`

---

### Task 5: Cliente Supabase de serviço e adaptadores reais

**Arquivos:** Criar `lib/supabaseAdmin.ts`.

**Interfaces:**
- Produz: `criarClienteAdmin(): SupabaseClient` (lança `Error('Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.')` se faltar alguma; sem valores padrão; `auth: { persistSession: false }`); `criarDepsHotmart(db: SupabaseClient, appUrl: string): Deps`.
- `convidar` usa `db.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo: \`${appUrl}/definir-senha\` })`. Se o erro indicar usuário já cadastrado, **não lança** (o cliente já tem conta); só registra e segue. Depois grava/atualiza `perfis` (`auth_id`, `telefone`, `nome`, `email`, `role: 'user'`) por upsert em `auth_id`; telefone `null` → não cria o perfil.
- `registrarEvento` faz `insert` em `hotmart_eventos` e trata violação de chave única como "já visto".

- [ ] **Passo 1: Escrever os adaptadores** seguindo as assinaturas de `Deps` da Tarefa 4.
- [ ] **Passo 2: Verificar tipos.** `npx tsc --noEmit --skipLibCheck --module nodenext --target es2022 lib/supabaseAdmin.ts` sem erros.
- [ ] **Passo 3: Commit.** `feat(api): cliente Supabase de serviço e adaptadores Hotmart`

---

### Task 6: Endpoint do webhook

**Arquivos:** Criar `api/hotmart/webhook.ts`.

**Interfaces:** Produz `export default async function handler(req, res)`.
- Consome: `tokenValido`, `lerWebhook`, `mapearEvento`, `PRODUTO_ID`, `processarEvento`, `criarClienteAdmin`, `criarDepsHotmart`.

- [ ] **Passo 1: Implementar** com esta ordem fixa: método ≠ POST → 405; `tokenValido(req.headers['x-hotmart-hottok'], process.env.HOTMART_HOTTOK)` falso → **401 sem ler o corpo**; `lerWebhook` nulo → 200 `{ ignorado: 'corpo' }`; produto ≠ `PRODUTO_ID` → 200 `{ ignorado: 'produto' }`; `mapearEvento` nulo → 200 `{ ignorado: 'evento' }`; processar; sucesso → 200 `{ resultado }`; erro → 500 `{ erro: 'falha ao processar' }` (sem vazar detalhes). **Sem CORS aberto** (não definir `Access-Control-Allow-Origin`).
- [ ] **Passo 2: Teste manual local** com um servidor de teste: `node --env-file=.env.local -e "..."` não é necessário; use `npx vercel dev` e envie com `curl -X POST localhost:3000/api/hotmart/webhook -H 'x-hotmart-hottok: errado'` → esperado **401**; com o token certo e corpo de exemplo → 200.
- [ ] **Passo 3: Commit.** `feat(api): endpoint do webhook Hotmart`

---

### Task 7: Reenvio do convite pelo admin (backend)

**Arquivos:** Criar `lib/admin/reenvio.ts`, `tests/admin_reenvio.test.ts`, `api/admin/reenviar-convite.ts`.

**Interfaces:**
- Produz: `decidirReenvio(a: { status: string; dataVencimento: Date | null }, agora: Date, toleranciaDias: number): { ok: true } | { ok: false; motivo: string }`; handler `POST /api/admin/reenviar-convite` com corpo `{ assinaturaId: string }`.

- [ ] **Passo 1: Testes de `decidirReenvio` (falham).** `Ativo` e vencimento futuro → ok; `Ativo` e vencido há 2 dias com tolerância 3 → ok; vencido há 5 dias → `{ok:false, motivo:'Assinatura vencida'}`; `Cancelado` → `'Assinatura cancelada'`; `Inadimplente` → `'Assinatura inadimplente'`; `Inativo` → `'Assinatura inativa'`; `Ativo` sem `dataVencimento` → ok.
- [ ] **Passo 2–4: FAIL, implementar, PASS.**
- [ ] **Passo 5: Implementar o handler.** Ordem: POST; ler `Authorization: Bearer`; `db.auth.getUser(token)` inválido → 401; buscar `perfis.role` do usuário **com a chave de serviço** (não confiar no corpo nem em dados do navegador); ≠ `'admin'` → 403; buscar a assinatura por `assinaturaId`; inexistente → 404; `decidirReenvio` recusado → 409 com o motivo; senão, se o usuário de Auth já tem `email_confirmed_at`/senha definida → `db.auth.resetPasswordForEmail(email, { redirectTo: \`${APP_URL}/definir-senha\` })`, caso contrário `inviteUserByEmail`; gravar `convite_reenviado_por`/`convite_reenviado_em`; 200.
- [ ] **Passo 6: Teste manual:** sem token → 401; token de usuário comum → 403; admin com assinatura cancelada → 409 e motivo.
- [ ] **Passo 7: Commit.** `feat(api): reenvio de convite pelo admin com regra de assinatura válida`

---

### Task 8: Configuração e teste de ponta a ponta (manual, feito pela dona)

**Sem arquivos.** Checklist com resultado esperado em cada item.

- [ ] **Passo 1: Variáveis na Vercel** (Settings → Environment Variables): `HOTMART_HOTTOK` (copiado da Hotmart), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`. Redeploy. Esperado: `curl` do passo 6 da Tarefa 6 responde 401 com token errado, não 500.
- [ ] **Passo 2: Supabase → Authentication → URL Configuration:** *Site URL* = `APP_URL`; adicionar `APP_URL/definir-senha` em *Redirect URLs*.
- [ ] **Passo 3: SMTP próprio** (Resend) em *Authentication → SMTP Settings*, com remetente verificado; ajustar o modelo "Invite user" em português.
- [ ] **Passo 4: Hotmart → Ferramentas → Webhook:** criar a configuração com a URL `APP_URL/api/hotmart/webhook`, versão 2.0.0, eventos de compra aprovada, concluída, atrasada, cancelada, reembolsada, chargeback e cancelamento de assinatura.
- [ ] **Passo 5: Enviar o evento de teste da Hotmart.** Esperado: linha nova em `hotmart_eventos`, assinatura `Ativo`, e-mail recebido. **Conferir** os nomes reais dos campos do telefone e dos eventos no payload; se diferirem, ajustar as constantes das Tarefas 3 e 3b e repetir os testes.
- [ ] **Passo 6: Enviar o mesmo teste de novo.** Esperado: nenhum e-mail novo e nenhuma linha duplicada.

---

### Task 9: Tela de definir senha (front)

**Arquivos:** Criar `frontend/src/lib/senha.ts`, `tests/senha.test.ts`, `frontend/src/pages/DefinirSenha.tsx`; modificar `frontend/src/App.tsx`.

**Interfaces:** Produz `validarSenha(senha: string, confirmacao: string): string | null` (mensagem de erro, ou `null` se válida); página `DefinirSenha` em `/definir-senha`.

- [ ] **Passo 1: Testes (falham).** senha de 7 caracteres → `'A senha deve ter pelo menos 8 caracteres.'`; senhas diferentes → `'As senhas não conferem.'`; 8+ iguais → `null`.
- [ ] **Passo 2–4: FAIL, implementar `validarSenha` (arquivo sem imports), PASS.**
- [ ] **Passo 5: `DefinirSenha.tsx`.** Aguarda a sessão criada pelo link (evento `SIGNED_IN` ou `PASSWORD_RECOVERY`); sem sessão após alguns segundos → mensagem "Link inválido ou expirado. Peça um novo convite ao suporte."; formulário com senha e confirmação usando `validarSenha`; envia com `supabase.auth.updateUser({ password })`; sucesso → vai para `/`.
- [ ] **Passo 6: `App.tsx`.** A rota `/definir-senha` é renderizada **antes** do `AuthGate` (ou seja, acessível mesmo sem login e sem perfil completo).
- [ ] **Passo 7: Verificar.** `npm run build` e `npm run lint` em `frontend/`; abrir `/definir-senha` sem link → vê a mensagem de link inválido; abrir com o link real do convite de teste → define a senha e entra.
- [ ] **Passo 8: Commit.** `feat(front): tela de definir senha pelo link do convite`

---

### Task 10: Botão de reenvio no painel do admin (front)

**Arquivos:** Modificar `frontend/src/lib/financeService.ts`, `frontend/src/pages/AssinaturasAdmin.tsx`.

**Interfaces:**
- Consome: `POST /api/admin/reenviar-convite` (Tarefa 7).
- Produz: `reenviarConvite(assinaturaId: string): Promise<{ ok: true } | { ok: false; motivo: string }>` (envia o token da sessão em `Authorization`).

- [ ] **Passo 1: Implementar `reenviarConvite`:** 200 → `{ok:true}`; 409/403/401/404 → `{ok:false, motivo}` com o texto devolvido pela API; falha de rede → `{ok:false, motivo:'Não foi possível contatar o servidor.'}`.
- [ ] **Passo 2: Botão "Reenviar convite" em cada linha** de `AssinaturasAdmin.tsx`, desabilitado enquanto envia; mostra "Convite enviado" ou o motivo da recusa; mostra também `convite_enviado_em` e o erro `convite_erro` quando houver.
- [ ] **Passo 3: Verificar.** `npm run build`, `npm run lint`; com um admin real: assinatura Ativa → "Convite enviado"; assinatura Cancelada → mensagem "Assinatura cancelada".
- [ ] **Passo 4: Commit.** `feat(front): reenvio de convite no painel do admin`

---

### Task 11: Bloqueio de acesso sem assinatura válida (front)

**Arquivos:** Criar `frontend/src/components/AssinaturaGuard.tsx`; modificar `frontend/src/lib/financeService.ts`, `frontend/src/App.tsx`.

**Interfaces:** Produz `assinaturaVigente(telefone: string): Promise<boolean>` (usa a função SQL `verificar_assinatura_ativa`) e `<AssinaturaGuard>{children}</AssinaturaGuard>`.

- [ ] **Passo 1: Implementar o guard.** Admin (`role = 'admin'`) passa direto; modo demo passa; usuário comum sem assinatura vigente vê a tela "Sua assinatura não está ativa" com um link para a página de pagamento da Hotmart e o botão Sair; erro de consulta → mensagem de erro com "Tentar de novo" (não libera nem bloqueia em silêncio).
- [ ] **Passo 2: Aplicar o guard** em volta das rotas do cliente em `App.tsx` (não nas do admin).
- [ ] **Passo 3: Verificar.** Build e lint; com um usuário de teste: assinatura `Ativo` → entra; mudar para `Cancelado` no banco → bloqueado; admin → entra sempre.
- [ ] **Passo 4: Commit.** `feat(front): bloqueia acesso sem assinatura válida`

> **Dependência do banco:** o cliente precisa conseguir ler a própria assinatura. As policies atuais (`app.user_phone`) impedem isso; sem o plano do banco este passo bloqueia todo mundo. Executar esta tarefa **depois** do plano do banco.

---

### Task 12: Scripts de teste e verificação final

**Arquivos:** Modificar `package.json` (raiz).

- [ ] **Passo 1: Script `test`** passa a incluir `tests/*.test.ts` além dos `.mjs` existentes: `node --test tests/*.test.mjs tests/*.test.ts`.
- [ ] **Passo 2: Rodar tudo.** `npm test` → todos passam; `npm run build` e `npm run lint` em `frontend/` → verdes.
- [ ] **Passo 3: Percorrer o foco de revisão** manualmente com o botão de teste da Hotmart (itens 1, 2 e 3) e com o reenvio (item 4).
- [ ] **Passo 4: Commit.** `chore: inclui testes TypeScript no npm test`

---

## Auto-revisão

- **Cobertura do desenho:** webhook com token (T2, T6), idempotência e ordem (T4), eventos e status (T3b), telefone (T3), vencimento e tolerância (T3b, T7), convite (T5), reenvio com regra e redefinição de senha (T7, T10), tela de senha (T9), bloqueio de cancelados (T11), banco (T1), configuração externa (T8).
- **Fora deste plano (dependências):** policies de admin e do cliente no banco; tela de completar perfil (Tarefa 3 do plano do front); lista de clientes e indicadores.
- **Consistência de nomes:** `EventoHotmart`, `Efeito`, `Deps`, `processarEvento`, `decidirReenvio`, `reenviarConvite`, `TOLERANCIA_DIAS` e os status usam a mesma grafia em todas as tarefas.
- **Risco principal:** nomes de evento e de campo do telefone da Hotmart não foram verificados contra um payload real; a Tarefa 8 (passo 5) é o ponto de confirmação, e a correção fica em duas constantes.
