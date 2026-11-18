# Correção do Front FINALZAP — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** Fazer o frontend compilar, identificar o usuário pelo telefone e operar só sobre as tabelas por telefone (`movimentacoes`, `orcamentos`, `contas_a_pagar`...), de modo que atenda ao prompt do agente financeiro.

**Arquitetura:** `lib/financeService.ts` continua sendo a única camada que fala com o Supabase. `hooks/useFinance.ts` expõe dados às telas. O modelo antigo (`accounts`/`transactions` por `user_id` e `useSyncSupabase`) sai do caminho das telas financeiras. O vínculo login→telefone passa a ser gravado em `perfis`.

**Stack:** React 19, TypeScript 5.9, Vite 7, Zustand, Supabase JS, Vitest (novo, só devDependency do frontend).

**Spec:** não há spec formal. Os requisitos vêm do prompt do agente FINALZAP (funções 1–7, só BRL, confirmar só após sucesso) e da análise de 2026-11-16. Pasta do front: `WhatsApp-Fin/frontend/`.

## Restrições globais

- Só BRL. `moeda` sempre `'BRL'`; nunca registrar em dólar.
- Telefone sempre **só dígitos com DDI** (ex.: `5511999999999`). Uma única função normaliza (`normalizarTelefone`).
- Nenhuma chave, segredo ou senha no código do front.
- Valor: número > 0. Categoria e descrição obrigatórias ao registrar.
- O front **só confirma registro depois que o Supabase retorna sucesso**.
- `npm run build` e `npm run lint` (em `frontend/`) devem passar ao final de cada tarefa a partir da Tarefa 1.
- O SQL **não** é alterado neste plano (será um plano separado). Onde o front depende do SQL, isso é sinalizado.

## Foco de revisão

1. Dois gastos idênticos (mesmo valor, categoria e dia) devem ser salvos os dois; hoje o segundo colide na chave de idempotência.
2. Telefone digitado com máscara (`(11) 99999-9999`, `+55 11 99999-9999`) deve virar `5511999999999`; entrada inválida deve ser recusada.
3. Usuário logado sem linha em `perfis` deve ver a tela de completar perfil, não erros soltos nem telas vazias.
4. Usuário em modo demo não deve chamar o Supabase nem ver erro.
5. Valor zero, negativo ou `NaN` (vindo de campo vazio) não pode ser registrado.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/lib/telefone.ts` (novo) | `normalizarTelefone`, `telefoneValido` |
| `frontend/src/lib/financeService.ts` (mod.) | chave de idempotência, `garantirPerfil`, exports de tipos |
| `frontend/src/hooks/useFinance.ts` (mod.) | tipos e imports corrigidos, sem dependência de ids do store antigo |
| `frontend/src/components/PerfilGuard.tsx` (novo) | exige telefone em `perfis` antes de abrir as telas |
| `frontend/src/pages/CompletarPerfil.tsx` (novo) | formulário de telefone/nome |
| `frontend/src/pages/Login.tsx` (mod.) | pedir telefone no cadastro |
| `frontend/src/App.tsx` (mod.) | trocar `useSyncSupabase` por `PerfilGuard` |
| `frontend/src/pages/{Dashboard,Transactions,FixedTransactions,Budget,DicasEconomia,AssinaturasAdmin}.tsx` (mod.) | erros de tipo e migração |
| `frontend/src/**/*.test.ts` (novos) | testes Vitest |

---

### Tarefa 1: Build verde (erros de tipo e limpeza)

**Arquivos:**
- Modificar: `frontend/src/hooks/useFinance.ts`, `frontend/src/pages/DicasEconomia.tsx`, `frontend/src/pages/FixedTransactions.tsx`, `frontend/src/pages/AssinaturasAdmin.tsx`, `frontend/src/pages/Budget.tsx`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Transactions.tsx`, `frontend/src/lib/financeService.ts`

**Interfaces:**
- Produz: `export type { Orcamento, TipoAssinatura, TipoMovimentacao }` reexportados por `useFinance.ts` (as páginas já os importam de lá).

- [ ] **Passo 1: Medir a linha de base.** Em `frontend/`: `npx tsc -b 2>&1 | grep -c "error TS"`. Esperado: 48.
- [ ] **Passo 2: `useFinance.ts`.** Importar `resolverTelefoneUsuario` de `../lib/financeService` (linha 328). Reexportar `Orcamento`, `TipoAssinatura` e `TipoMovimentacao` com `export type { ... }`. Linha 120: remover o `as const` e tipar o valor com `TipoMovimentacao`. Linha 174: tipar `fonte` com o union `'whatsapp' | 'painel' | 'conta_paga' | 'recorrente'` (exportar o tipo `FonteMovimentacao` do service). Linha 242: remover `fonte` do objeto de `cadastrar_conta_a_pagar` (o tipo `CadastrarContaAPagarInput` não tem). Linha 246: passar `Omit<FixedTransaction,'id'>` sem `id`.
- [ ] **Passo 3: `DicasEconomia.tsx`.** Adicionar `import { useState } from 'react'`. Tipar o parâmetro do `map` (linha 82) com o tipo retornado por `gerar_dicas_economia` (exportar `DicaEconomia` do service). Linha 103: mapear a severidade para as variantes do `Badge` existentes (`destructive`→`danger`; `warning`→ a variante de aviso que o componente já tiver, ou `default`).
- [ ] **Passo 4: `FixedTransactions.tsx`.** Trocar `listaContasVencendo` por `lista_contas_vencendo` (linha 36) e importar `Check` de `lucide-react` (linha 314).
- [ ] **Passo 5: `Dashboard.tsx` e `Transactions.tsx` (linha 42 de cada).** Criar em `frontend/src/lib/tipos.ts` as funções `paraTipoMovimentacao(t: 'income'|'expense'): TipoMovimentacao` e `deTipoMovimentacao(t: TipoMovimentacao): 'income'|'expense'`; usar nos dois pontos. (Mapeamento transitório; a Tarefa 5 o elimina.)
- [ ] **Passo 6: Limpeza `TS6133`.** Remover imports e variáveis não usados nos arquivos apontados pelo `tsc` (`useFinance.ts`, `AssinaturasAdmin.tsx`, `Budget.tsx` e demais).
- [ ] **Passo 7: Verificar.** `npx tsc -b` sem saída e `npm run build` com sucesso. Esperado: 0 erros.
- [ ] **Passo 8: Commit.** `git add frontend/src && git commit -m "fix(front): corrige erros de tipo e compila o build"`

---

### Tarefa 2: Normalização de telefone e idempotência (com testes)

**Arquivos:**
- Criar: `frontend/src/lib/telefone.ts`, `frontend/src/lib/telefone.test.ts`, `frontend/src/lib/idempotencia.test.ts`
- Modificar: `frontend/package.json` (adicionar `vitest` em devDependencies e script `"test": "vitest run"`), `frontend/src/lib/financeService.ts`

**Interfaces:**
- Produz: `normalizarTelefone(entrada: string): string | null` (só dígitos com DDI 55; `null` se inválido) e `gerarChaveIdempotencia(p: { telefone: string; data: string; tipo: string; valor: number; categoria: string; descricao: string; origemId?: string }): string`.

- [ ] **Passo 1: Instalar Vitest.** `npm i -D vitest` em `frontend/`; script `test`.
- [ ] **Passo 2: Escrever os testes de telefone (falham).** Em `telefone.test.ts`:
  - `'(11) 99999-9999'` → `'5511999999999'`
  - `'+55 11 99999-9999'` → `'5511999999999'`
  - `'5511999999999'` → `'5511999999999'`
  - `'abc'`, `''`, `'123'` → `null`
- [ ] **Passo 3: Rodar e ver falhar.** `npx vitest run src/lib/telefone.test.ts` → FAIL (módulo inexistente).
- [ ] **Passo 4: Implementar `normalizarTelefone`** em `telefone.ts`: remove não dígitos; se tem 10–11 dígitos prefixa `55`; aceita 12–13 dígitos começando com `55`; senão `null`.
- [ ] **Passo 5: Rodar e ver passar.**
- [ ] **Passo 6: Testes de idempotência (falham).** Em `idempotencia.test.ts`:
  - duas chamadas com os mesmos campos **e `origemId` diferente** → chaves diferentes (dois cafés iguais no mesmo dia).
  - duas chamadas idênticas **com o mesmo `origemId`** → mesma chave (reenvio).
  - sem `origemId` → chave inclui um UUID (`crypto.randomUUID()`), ou seja, duas chamadas sem origem **nunca** colidem.
- [ ] **Passo 7: Implementar `gerarChaveIdempotencia`** em `financeService.ts` e usar em `registrar_movimentacao`, substituindo a chave atual (`financeService.ts:192`). `RegistrarMovimentacaoInput` ganha `origemId?: string`.
- [ ] **Passo 8: Validação de valor.** Teste em `idempotencia.test.ts` (ou arquivo próprio): `registrar_movimentacao` com valor `0`, `-5` e `NaN` lança erro antes de chamar o Supabase (mockar `supabase`). Ajustar `validarValor` para recusar `NaN`/`Infinity`.
- [ ] **Passo 9: Verificar.** `npx vitest run` e `npm run build`. Esperado: tudo verde.
- [ ] **Passo 10: Commit.** `git commit -m "feat(front): normaliza telefone e corrige chave de idempotência"`

> **Dependência do SQL:** a função SQL `registrar_movimentacao` (usada pelo agente) tem o mesmo problema de chave. Isso é corrigido no plano do banco, não aqui.

---

### Tarefa 3: Vínculo login → telefone (`perfis`)

**Arquivos:**
- Criar: `frontend/src/components/PerfilGuard.tsx`, `frontend/src/pages/CompletarPerfil.tsx`, `frontend/src/lib/perfil.test.ts`
- Modificar: `frontend/src/lib/financeService.ts`, `frontend/src/pages/Login.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/Settings.tsx`

**Interfaces:**
- Consome: `normalizarTelefone` (Tarefa 2).
- Produz:
  - `garantirPerfil(input: { telefone: string; nome?: string }): Promise<PerfilUsuario>`: normaliza, faz `upsert` em `perfis` por `auth_id`, lança erro se o telefone for inválido ou já pertencer a outro usuário (violação de `UNIQUE telefone`) com a mensagem "Este telefone já está vinculado a outra conta."
  - `resolverPerfilUsuario(): Promise<PerfilUsuario | null>` (já existe).
  - `<PerfilGuard>{children}</PerfilGuard>`: renderiza `children` se houver perfil com telefone; senão renderiza `<CompletarPerfil />`. No modo demo (`user.id === 'demo-test-user'`), renderiza `children` sem consultar o banco.

- [ ] **Passo 1: Teste de `garantirPerfil` (falha).** Com `supabase` mockado: (a) telefone `'(11) 99999-9999'` faz `upsert` com `telefone: '5511999999999'` e `auth_id` do usuário; (b) telefone `'abc'` lança erro sem chamar o banco; (c) erro de código `23505` vira a mensagem de telefone já vinculado.
- [ ] **Passo 2: Implementar `garantirPerfil`** em `financeService.ts`.
- [ ] **Passo 3: `CompletarPerfil.tsx`.** Formulário com nome e telefone (máscara visual, valor enviado cru), botão "Salvar", mostra o erro de `garantirPerfil`, chama um `onSalvo` ao concluir.
- [ ] **Passo 4: `PerfilGuard.tsx`** conforme a interface acima, com spinner enquanto carrega.
- [ ] **Passo 5: `Login.tsx`.** No modo `signup`, adicionar o campo telefone (obrigatório). Após `signUp` com sessão, chamar `garantirPerfil`. Se o Supabase exigir confirmação de e-mail (sem sessão), guardar o telefone em `localStorage` (`finalzap_telefone_pendente`) e deixar o `PerfilGuard` usá-lo no primeiro login.
- [ ] **Passo 6: `Settings.tsx`.** O campo telefone passa a ler e gravar `perfis` via `garantirPerfil` (e não só o estado local).
- [ ] **Passo 7: `App.tsx`.** Trocar `useSyncSupabase(user?.id ?? null)` e o spinner de sync por `<PerfilGuard>` envolvendo as rotas autenticadas. Manter a rota `/admin` dentro de `AdminGuard`.
- [ ] **Passo 8: Verificar.** `npx vitest run`, `npm run build`, `npm run lint`. Teste manual: cadastrar → cai em CompletarPerfil se faltar telefone → vê o Dashboard.
- [ ] **Passo 9: Commit.** `git commit -m "feat(front): vincula login ao telefone em perfis"`

> **Dependência do SQL:** o front precisa que `perfis` tenha RLS com `auth.uid() = auth_id` para SELECT/INSERT/UPDATE do próprio perfil, e **sem** permitir que o usuário altere `role`. Se não existir, o `upsert` falha.

---

### Tarefa 4: Telas financeiras só no modelo por telefone

**Arquivos:**
- Modificar: `frontend/src/hooks/useFinance.ts`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Transactions.tsx`, `frontend/src/pages/Budget.tsx`, `frontend/src/pages/FixedTransactions.tsx`
- Remover o uso de: `useStore` para transações, orçamentos e fixas nessas telas (`accounts`, `categories`, `budgets`, `fixedTransactions`).

**Interfaces:**
- Produz: `useFinance()` retorna `{ loading, error, movimentacoes, saldo, resumoMensal, orcamentos, contas, vencendo, dicas, registrar(input), definirOrcamento(input), cadastrarConta(input), marcarPaga(id), recarregar() }`. Todas as listas vêm do Supabase por telefone, nunca do store.

- [ ] **Passo 1: Teste do hook (falha).** Com `financeService` mockado, `useFinance` chamado para um telefone carrega `movimentacoes` e calcula `saldo = receitas - despesas`; se `registrar` rejeitar, `error` é preenchido e a lista **não** ganha o item (confirmar só após sucesso).
- [ ] **Passo 2: Reescrever `useFinance`** removendo a dependência do `useStore` para dados financeiros (sem chaves de `accounts`/`categories`) e expondo a interface acima.
- [ ] **Passo 3: `Transactions.tsx`.** Listar `movimentacoes`; formulário com tipo `receita`/`despesa`, valor, categoria (lista fixa, ver Tarefa 5), descrição, data. Remover `paraTipoMovimentacao`/`deTipoMovimentacao`.
- [ ] **Passo 4: `Dashboard.tsx`.** Cartões de saldo, receitas e despesas do mês via `resumoMensal`; gráfico por categoria; últimas movimentações; contas vencendo.
- [ ] **Passo 5: `Budget.tsx`.** Orçamentos por categoria com barra de consumo (`orcamentos` + gasto do mês por categoria).
- [ ] **Passo 6: `FixedTransactions.tsx`.** Tela de contas a pagar (`contas`, `vencendo`, `marcarPaga`). Ao marcar paga, chama `marcar_conta_paga` e recarrega.
- [ ] **Passo 7: Estados vazios e erro.** Cada tela mostra mensagem clara para "sem dados" e para erro de carregamento (nada de tela em branco).
- [ ] **Passo 8: Verificar.** `npx vitest run`, `npm run build`, `npm run lint`.
- [ ] **Passo 9: Commit.** `git commit -m "feat(front): telas financeiras usam o modelo por telefone"`

> **Dependência do SQL:** com as policies atuais (`app.user_phone`), estas telas ficam vazias com dados reais. Só valide contra o Supabase depois do plano do banco.

---

### Tarefa 5: Categorias fixas e regras do prompt

**Arquivos:**
- Criar: `frontend/src/lib/categorias.ts`, `frontend/src/lib/categorias.test.ts`
- Modificar: `frontend/src/lib/financeService.ts`, telas que oferecem categoria

**Interfaces:**
- Produz: `CATEGORIAS: readonly string[]` e `normalizarCategoria(entrada: string): string` (retorna a categoria canônica; desconhecida → `'Outros'`).

- [ ] **Passo 1: Testes (falham).** `normalizarCategoria('alimentacao')`, `'  ALIMENTAÇÃO '`, `'café'`, `'padaria'`, `'refeição'` → `'Alimentação'`; `'xyz'` → `'Outros'`.
- [ ] **Passo 2: Implementar** com mapa de sinônimos (sem acento, minúsculo). A lista: Alimentação, Transporte, Moradia, Lazer, Saúde, Educação, Contas, Renda, Outros.
- [ ] **Passo 3: Usar em `registrar_movimentacao`, `definir_orcamento` e `cadastrar_conta_a_pagar`** (normalizar antes de gravar) e nos selects das telas.
- [ ] **Passo 4: Verificar e commitar.** `npx vitest run`, `npm run build`. `git commit -m "feat(front): categorias canônicas conforme o prompt"`

---

### Tarefa 6: Modo demo coerente e rotas

**Arquivos:**
- Modificar: `frontend/src/lib/financeService.ts` (ou `useFinance.ts`), `frontend/src/hooks/useAuth.ts`, `frontend/src/layouts/Sidebar.tsx`, `frontend/src/App.tsx`

- [ ] **Passo 1: Teste.** Com usuário `demo-test-user`, `useFinance` devolve dados de exemplo em memória e **não** chama `supabase.from(...)`.
- [ ] **Passo 2: Implementar** a fonte demo dentro de `useFinance` (movimentações, orçamentos e contas fictícios) quando o usuário for demo.
- [ ] **Passo 3: Sidebar.** Incluir links para `/orcamentos-finalzap`, `/dicas-economia`, `/assinaturas` e, só para admin, `/admin`. Conferir que nenhuma rota fica órfã.
- [ ] **Passo 4: Remover código morto** (`useSyncSupabase` e os mocks que alimentam o store antigo) **somente** se nenhuma tela remanescente o usar (`grep` para confirmar). Páginas antigas (Cartões, Metas, Investimentos) que ainda dependem dele ficam como estão, fora do escopo.
- [ ] **Passo 5: Verificar e commitar.** `npx vitest run`, `npm run build`, `npm run lint`. `git commit -m "feat(front): modo demo sobre useFinance e rotas na sidebar"`

---

### Tarefa 7: Verificação final contra o prompt

- [ ] **Passo 1:** `npm run build`, `npm run lint`, `npx vitest run` em `frontend/`, tudo verde.
- [ ] **Passo 2: Tabela de aceitação manual** (com Supabase criado e o plano do banco aplicado): para cada função do prompt, registrar o resultado.

| Função | Ação na tela | Esperado |
|---|---|---|
| Registrar despesa | R$ 12 Alimentação "café", duas vezes | duas linhas salvas |
| Telefone | cadastrar com `(11) 99999-9999` | `perfis.telefone = 5511999999999` |
| Saldo e resumo | Dashboard | receitas − despesas do mês |
| Orçamento | definir R$ 300 Alimentação | barra de consumo atualiza |
| Conta a pagar | cadastrar e marcar paga | despesa criada e conta `paga` |
| Dicas | tela de Dicas | exibe dicas |
| Moeda | tentar registrar em dólar | recusado |

- [ ] **Passo 3: Commit final** e atualizar o `README.md` com os comandos (`npm test` do frontend).

---

## Auto-revisão

- **Cobertura:** os 15 erros de compilação (Tarefa 1), mistura de modelos e `income/expense` (Tarefas 1 e 4), vínculo telefone/login (Tarefa 3), idempotência (Tarefa 2), categorias do prompt (Tarefa 5), modo demo (Tarefa 6) e RLS/SQL (dependências sinalizadas, plano separado).
- **Fora do escopo:** reescrita do SQL, policies, funções `SECURITY DEFINER`, backend e bot-server, páginas antigas (Cartões, Metas, Investimentos, Open Finance).
- **Consistência:** `normalizarTelefone` (T2) é usado em `garantirPerfil` (T3); `normalizarCategoria` (T5) é usado em `financeService` (T2/T4); a interface de `useFinance` (T4) é usada pelas telas e por T6.
- **Risco principal:** a Tarefa 4 muda a base de várias telas. Executar depois que a Tarefa 3 estiver estável e fazer commit por tela.
