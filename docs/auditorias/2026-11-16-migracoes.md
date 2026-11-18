# Auditoria de migrações e integridade de dados — FINALZAP

Data: 2026-11-16. Método: skill `database-migrations` (checklist: UP/DOWN, locks, NOT NULL sem default, índices concorrentes, DDL x DML separados, imutabilidade, rollback). Somente leitura; banco e rede não foram acessados (nada aqui foi comprovado contra o banco real; a classificação "quebra" vem da leitura do SQL, não de execução).

Pastas auditadas:
- NOVA (modelo por telefone): `finalzap/supabase/*.sql` + `finalzap/create_admin.sql`
- ANTIGA (modelo por user_id): `finalzap/WhatsApp-Fin/supabase/` (schema.sql, seed.sql, migrations/*.sql)

## Resumo de severidade

| Sev. | Qtde | Itens |
|---|---|---|
| Crítico | 6 | C1 `perfis` sem RLS e com `role`; C2 RLS das tabelas centrais não é aplicada na ordem natural; C3 credenciais reais no repositório; C4 arquivos engolidos/quebrados por `\n` literal; C5 cadeia de migrations antiga não roda (credit_cards e hotmart); C6 `idempotency_key` por hash descarta lançamentos legítimos |
| Alto | 7 | A1 `perfis.role` só em create_admin.sql; A2 `contas_a_pagar` e `logs_lembrete` definidas de 2 formas; A3 policies de mesmo nome em 3 arquivos; A4 RLS por `app.user_phone` não casa com o JWT do Supabase; A5 policies INSERT/UPDATE em assinaturas permitem autoativação; A6 funções que referenciam tabelas do outro modelo; A7 `definir_orcamento` não faz upsert (NULL em UNIQUE) |
| Médio | 6 | M1 `assinaturas.telefone NOT NULL` x placeholder `''`; M2 índices sem CONCURRENTLY / sem IF NOT EXISTS; M3 SECURITY DEFINER sem `search_path`; M4 saldo sem trigger de UPDATE; M5 seed duplica categorias; M6 `CURRENT_DATE` em UTC |
| Baixo | 5 | B1 hotmart com timestamp 000003 sem 01/02; B2 `whatsapp_financeiro_schema.sql` fora do padrão de nome; B3 `plano CHECK` divergente; B4 variável morta em `update_savings_goal_amount`; B5 nenhum arquivo tem DOWN |

---

## 1. Fonte da verdade hoje e divergência tabela a tabela

### Quem usa o quê (grep em `frontend/src`, `lib`, `api`)
O código usa AS DUAS famílias ao mesmo tempo:
- Modelo novo (telefone): `perfis`, `assinaturas`, `movimentacoes`, `orcamentos`, `contas_a_pagar`, `lancamentos_recorrentes`, `logs_lembrete`, `uso_servico`, `custos_fixos`, `hotmart_eventos` (lib/supabaseAdmin.ts, lib/hotmart, financeService.ts, AssinaturasAdmin).
- Modelo antigo (user_id): `profiles`, `categories`, `accounts`, `transactions`, `fixed_transactions`, `investments`, `budgets`, `savings_*`, `credit_cards`, `pluggy_*`, `whatsapp_instances`, `whatsapp_sessions`, `transacoes`.

Conclusão: a fonte da verdade para o produto FINALZAP (bot, Hotmart, admin, assinaturas) é o modelo novo; para os módulos legados do painel (contas, cartões, metas, investimentos) é o modelo antigo. Não existe script único e executável para o modelo novo: `supabase/schema.sql` é o mais completo, mas os demais arquivos o contradizem. Os nomes de tabela não colidem, então os dois modelos podem conviver no mesmo banco, mas há duplicação funcional (`transacoes` x `movimentacoes` x `transactions`; `budgets` x `orcamentos`; `fixed_transactions` x `lancamentos_recorrentes`; `profiles` x `perfis`).

### Comparação por tabela

| Conceito | Antigo (user_id) | Novo (telefone) | Divergência |
|---|---|---|---|
| Perfil | `profiles` (id = auth.users.id, first_name, phone, prefs de notificação), trigger cria perfil no signup | `perfis` (id próprio, auth_id nullable, telefone UNIQUE NOT NULL, nome, email; `role` só em create_admin.sql) | chaves e semântica diferentes; novo sem trigger de signup; `role` ausente em schema.sql |
| Categorias | `categories` (por usuário, seed por trigger) | não existe (categoria é TEXT livre) | sem integridade referencial no novo |
| Contas/saldo | `accounts` com `balance` mantido por trigger | não existe | `finalzap_functions.consultar_saldo_por_usuario` consulta `accounts.telefone` e `status`, que não existem |
| Lançamentos | `transactions` (FKs, trigger de saldo) e `transacoes` (WhatsApp/GPT, user_id) | `movimentacoes` (telefone, mes TEXT, idempotency_key UNIQUE) | 3 tabelas para o mesmo conceito |
| Recorrentes | `fixed_transactions` (day_of_month; Mensal/Anual/Semanal) | `lancamentos_recorrentes` (proxima_execucao; semanal/quinzenal/mensal/anual) | enums e idioma diferentes |
| Orçamento | `budgets` (PK user_id+category_id) | `orcamentos` (UNIQUE telefone+categoria+mes, mes NULL) | UNIQUE com NULL no novo não protege |
| Contas a pagar | sem equivalente | `contas_a_pagar` (2 definições conflitantes) | status 'pendente/paga/cancelada' x 'Pendente/Pago/Cancelada' |
| Assinaturas | só ALTER na migration hotmart | `assinaturas` (+ colunas Hotmart via ALTER) | a migration antiga altera tabela inexistente |
| Logs lembrete | sem equivalente | `logs_lembrete` (2 definições) | colunas diferentes (`enviado_em` x `tipo_lembrete/data_envio/status/erro/detalhes`) |
| Cartões | `credit_cards` (migration: FK auth.users; schema.sql: FK profiles) | não existe | FK, policies e função de trigger diferem entre migration e schema.sql |
| Pluggy | `pluggy_items/accounts` (migration: índices sem IF NOT EXISTS; schema.sql: com) | não existe | 4 policies separadas x 1 policy ALL |
| WhatsApp | `whatsapp_sessions`, `whatsapp_instances` (schema.sql: user_id NOT NULL -> profiles; whatsapp_financeiro_schema.sql: user_id nullable -> auth.users) | não existe | nulidade e FK divergentes |
| Uso/custos | sem equivalente | `uso_servico`, `custos_fixos` (só em arquivos soltos; fora do schema.sql) | não entram no "schema completo" |
| Hotmart | só a migration 20261116000003 | `finalzap_hotmart.sql` (idêntico: diff vazio) | mesmo conteúdo em duas pastas; só funciona no modelo novo |

Divergências internas da pasta antiga (migrations x schema.sql):
- `handle_new_profile` + trigger `on_profile_created` (seed de categorias) só existem em schema.sql; as migrations só criam a função `seed_default_categories`.
- O usuário `hermang@gmail.com` (seção 13) só existe em schema.sql.
- `whatsapp_*` e `transacoes` só existem em `whatsapp_financeiro_schema.sql` (nome fora do padrão) e em schema.sql, com tipos diferentes.
- `credit_cards`: a migration usa `update_updated_at_column()` (inexistente) e `auth.users`; schema.sql usa `set_updated_at()` e `profiles`.

## 2. Ordem de execução para banco do zero e onde quebra

### 2.1 Pasta ANTIGA (migrations em ordem lexicográfica, como o CLI faria)

| # | Arquivo | Resultado |
|---|---|---|
| 1 | 20260311000001_create_profiles.sql | OK (define `set_updated_at` e `handle_new_user`) |
| 2 | 20260311000002_create_categories.sql | OK (cria a função de seed, não o trigger) |
| 3 | 20260311000003_create_accounts.sql | OK |
| 4 | 20260311000004_create_transactions.sql | OK |
| 5 | 20260311000005_create_fixed_transactions.sql | OK |
| 6 | 20260311000006_create_investments.sql | OK |
| 7 | 20260311000007_create_budgets.sql | OK |
| 8 | 20260311000008_create_storage_avatars.sql | OK (precisa do schema storage) |
| 9 | 20260312000001_create_savings_goals.sql | OK |
| 10 | 20260312000002_create_pluggy_tables.sql | OK (depende de `set_updated_at` do passo 1) |
| 11 | 20260313000001_create_credit_cards.sql | QUEBRA: `EXECUTE FUNCTION update_updated_at_column()` não existe em lugar nenhum (42883). `CREATE OR REPLACE TRIGGER` exige PG14+ |
| 12 | 20261116000003_hotmart.sql | QUEBRA: `alter table public.assinaturas`, tabela inexistente nesta cadeia |
| - | whatsapp_financeiro_schema.sql | nome fora do padrão `<timestamp>_nome.sql`: o CLI ignora/avisa; rodado à mão depende de uuid-ossp e cria `transacoes`/`whatsapp_instances` com FK para auth.users |

Alternativa: rodar só `WhatsApp-Fin/supabase/schema.sql` num projeto vazio. Funciona uma vez, mas contém senha e e-mail reais (C3), escreve direto em `auth.users`/`auth.identities` (frágil entre versões do GoTrue) e não é reexecutável (seção 3).

### 2.2 Pasta NOVA (ordem natural: schema.sql, arquivos por tabela, functions, RLS, admin)

| # | Arquivo | O que acontece |
|---|---|---|
| 1 | supabase/schema.sql | Cria 7 tabelas, índices, `set_updated_at` (definida antes dos triggers, OK), triggers e `marcar_conta_paga_com_despesa`. NÃO habilita RLS em nenhuma tabela. `perfis` sem `role`. `CREATE INDEX`/`CREATE TRIGGER` sem IF NOT EXISTS |
| 2 | finalzap_assinaturas.sql | OK, mas `CREATE TABLE IF NOT EXISTS` é ignorado (tabela já existe, sem CHECK de plano); habilita RLS e cria 3 policies |
| 3 | finalzap_movimentacoes.sql | FALHA: a linha 5 é um comentário que engole (por `\n` literal) o cabeçalho e o início do `CREATE TABLE` até `valor ... CHECK (valor > 0),`; a próxima linha real `moeda TEXT NOT NULL ...` é sintaxe inválida. No SQL Editor o arquivo é revertido inteiro: sem RLS e sem a função `registrar_movimentacao` |
| 4 | finalzap_orcamentos.sql | FALHA: mesmo problema (começa em `updated_at ...`), mais `UNIQUE(...) WHERE mes IS NOT NULL`, sintaxe inválida em CREATE TABLE |
| 5 | finalzap_contas_a_pagar.sql | NO-OP SILENCIOSO: o arquivo inteiro vira uma única linha de comentário (termina em `"""`). Nada é criado: nem RLS nem as funções. O corpo, se rodasse, também tem erros (`v_exist` não declarada, `data: CURRENT_TIMESTAMP`, trecho "... [truncado]") |
| 6 | finalzap_lancamentos_recorrentes.sql | NO-OP SILENCIOSO (mesma causa) |
| 7 | finalzap_logs_lembrete.sql | NO-OP SILENCIOSO (mesma causa). A tabela existente vem do schema.sql, com colunas diferentes da pretendida |
| 8 | finalzap_uso_servico.sql | OK (precisa de uuid-ossp; sem `updated_at`) |
| 9 | finalzap_custos_fixos.sql | OK (tem `updated_at`, mas nenhum trigger o atualiza) |
| 10 | finalzap_functions.sql | Cria, mas `obter_dados_usuario` (usa `public.profiles`, `first_name`, `telefone`) e `consultar_saldo_por_usuario` (usa `accounts.telefone`, `status`) referenciam o OUTRO modelo: criam sem erro (ligação tardia do plpgsql) e falham em runtime. `marcar_conta_paga_com_despesa` sobrescreve a do schema.sql. `json_array_length(v_result, 0)` tem assinatura inválida |
| 11 | finalzap_rls_policies.sql | FALHA na 2ª instrução: `CREATE POLICY "Users can view own subscriptions"` já existe (passo 2). Arquivo revertido: sem RLS em movimentacoes, orcamentos, contas_a_pagar, lancamentos_recorrentes e logs_lembrete |
| 12 | rls_policies.sql | Policies de `perfis` (sem ENABLE RLS: inertes) e duplicatas de nome em assinaturas/movimentacoes/orcamentos/recorrentes/logs (erro); nomes ligeiramente diferentes em contas_a_pagar (coexistem) |
| 13 | finalzap_hotmart.sql | OK se `assinaturas` existir (reexecutável) |
| 14 | ../create_admin.sql | FALHA: (a) `CREATE TRIGGER tr_perfis_updated` já existe (schema.sql); (b) `perfis` já foi criada sem `role`, o `CREATE TABLE IF NOT EXISTS` é ignorado e o INSERT com `role` dá "column role does not exist"; (c) `'SEU_AUTH_ID_AQUI'` não é UUID (22P02) |

Dependências conferidas:
- `set_updated_at`: antiga, criada em 001 e usada a partir de 003 (ok); nova, criada no schema.sql antes dos triggers (ok) e redefinida em create_admin.sql. Os arquivos por tabela (assinaturas, uso_servico, custos_fixos) não criam trigger de updated_at.
- `uuid-ossp`/`gen_random_uuid`: arquivos por tabela usam `uuid_generate_v4()` sem criar a extensão (só funcionam depois do schema.sql); hotmart usa `gen_random_uuid()`.
- `contas_a_pagar.movimentacao_id -> movimentacoes`: ordem correta no schema.sql.
- `hotmart` depende de `assinaturas` sem declarar.
- Policies de mesmo nome em arquivos diferentes: `Users can view/insert/update own subscription(s)`, `Users can view own movements`, `Users can view own budgets`, `Users can view own recurrences`, `Users can view own logs`: repetidas entre os arquivos por tabela, `finalzap_rls_policies.sql` e `rls_policies.sql`.

Efeito prático da ordem natural: as tabelas centrais de dados financeiros ficam sem RLS (C2).

## 3. Reexecutabilidade (idempotência)

| Script | Reexecutável? | Motivo |
|---|---|---|
| migrations antigas 001-007, 009 | Não | `CREATE INDEX` sem IF NOT EXISTS; `CREATE POLICY`/`CREATE TRIGGER` sem DROP IF EXISTS |
| 008 storage | Parcial | bucket `on conflict do nothing`; policies não |
| 20260312000002 pluggy | Não | índices e policies |
| 20260313000001 credit_cards | Não (nem roda na 1ª vez) | ver 2.1 |
| 20261116000003 hotmart | Sim | `if not exists` em tudo (com `assinaturas` existente) |
| WhatsApp-Fin/supabase/schema.sql | Não | índices/policies/triggers sem guarda; a seção 13 reseta a senha do usuário e duplica categorias a cada execução |
| seed.sql | Não | contas duplicam |
| supabase/schema.sql (novo) | Não | 20+ `CREATE INDEX` e 6 `CREATE TRIGGER` sem guarda |
| finalzap_assinaturas / uso_servico / custos_fixos | Parcial | tabelas e índices sim; `CREATE POLICY` não |
| finalzap_movimentacoes / orcamentos | Não rodam | sintaxe |
| contas, recorrentes, logs | Rodam (no-op) | tudo comentado |
| finalzap_functions.sql | Sim | `create or replace` |
| finalzap_rls_policies / rls_policies | Não | CREATE POLICY repetido |
| finalzap_hotmart.sql | Sim | |
| create_admin.sql | Não | trigger; e o upsert sobrescreve o admin |

## 4. Segurança de reversão (o que não dá para desfazer)

- Nenhum arquivo tem DOWN (B5). A reversão precisa ser escrita à mão como nova migration forward.
- Irreversível ou destrutivo:
  - `WhatsApp-Fin/supabase/schema.sql` seção 13: sobrescreve `encrypted_password` do usuário existente (senha anterior se perde) e escreve direto em `auth.users`/`auth.identities`.
  - `create_admin.sql`: `ON CONFLICT (telefone) DO UPDATE` troca `auth_id`, `email` e `role` do perfil existente sem checar.
  - `ON DELETE CASCADE` de `profiles`/`auth.users` para accounts, transactions, savings, credit_cards, pluggy, whatsapp_instances, transacoes: excluir um usuário apaga todo o histórico financeiro sem volta.
  - `logs_lembrete.conta_id ON DELETE CASCADE`: apagar a conta apaga o log de auditoria. `contas_a_pagar.movimentacao_id` usa SET NULL (perde o vínculo). `perfis.auth_id ON DELETE SET NULL` desvincula o perfil em silêncio.
  - `hotmart_eventos.payload` guarda o corpo do webhook (dado pessoal) em jsonb sem política de retenção/expurgo.
  - `marcar_conta_paga_com_despesa` cria despesa e altera a conta; reverter exige apagar a movimentacao e voltar o status manualmente.
- `ADD COLUMN IF NOT EXISTS` do hotmart é reversível por DROP COLUMN, mas só antes de haver dados nas colunas.

## 5. Integridade dos dados e do seed.sql

`WhatsApp-Fin/supabase/seed.sql` (não existe seed.sql na pasta nova):
- UUID fixo `00000000-0000-0000-0000-000000000001`: aceitável em dev local, mas previsível; se rodado em produção, cria usuário conhecido com senha `dev123456`. O arquivo avisa "local only", mas nada impede tecnicamente.
- E-mail `dev@whatsappfin.local` e telefone `+55 11 99999-9999`: fictícios, sem dado real. O formato do telefone não é o normalizado (só dígitos) do modelo novo.
- INSERT em `auth.users` sem `instance_id`, `aud`, `role` e sem linha em `auth.identities`: o usuário provavelmente não consegue logar (schema.sql, ao contrário, preenche esses campos).
- O trigger `on_auth_user_created` já cria o `profiles` (first_name = 'dev'); o INSERT do seed usa `on conflict do nothing`, então `first_name='Dev'`, `last_name='User'` e `phone` nunca são gravados (seed ineficaz).
- `seed_default_categories` roda de novo (e, se `on_profile_created` existir via schema.sql, já rodou): categorias duplicadas, sem UNIQUE(user_id, name, type) para impedir.
- `accounts`: tipos 'Conta Corrente', 'Conta PJ', 'Dinheiro' respeitam o CHECK; saldos (2272.50 / 8320.00 / 120.00) inseridos direto, sem `transactions` que os sustentem (a coluna é derivada por trigger, logo não reconciliável). Reexecutar duplica as 3 contas.
- Dados reais no repositório: e-mail `hermang@gmail.com` e a senha em texto claro em schema.sql antigo; senha de admin em comentário de create_admin.sql. Tratar como vazadas: rotacionar e remover do histórico.

CHECKs e integridade estrutural:
- `movimentacoes.mes` (texto 'AAAA-MM') pode divergir de `data`: o schema.sql não tem CHECK nem trigger; a versão com `mes ~ '^\d{4}-\d{2}$'` nunca executa (M6 abaixo).
- `valor > 0` e `tipo` coerentes entre tabelas; `moeda` livre no schema.sql (o `CHECK (moeda='BRL')` do arquivo quebrado nunca executa).
- C6: `registrar_movimentacao` gera `idempotency_key = md5(telefone+tipo+valor+categoria)`. Duas despesas idênticas em dias diferentes (ex.: R$ 5,00 em Alimentação) colidem e a segunda é descartada em silêncio. A chave de `conta_paga` aí (`conta_`+md5) também difere da de `marcar_conta_paga_com_despesa` (`conta_`+uuid).
- `registrar_movimentacao` usa `RETURNING ... INTO STRICT v_result` (várias colunas para variável JSON) e `definir_orcamento` usa `RETURNING * INTO` JSON: falham em runtime.
- `transactions`/`fixed_transactions` aceitam `account_id`/`category_id` de OUTRO usuário (FKs simples, sem validação de dono).
- `accounts.balance` é editável pelo próprio usuário (policy FOR ALL), o que anula o trigger de saldo.
- M4: `transactions` tem trigger só de INSERT/DELETE; UPDATE de `amount`, `type` ou `account_id` deixa o saldo errado.
- `savings_goals.current_amount` com CHECK >= 0 pode estourar no DELETE de contribuição se houver dessincronização.

## 6. Riscos de migração com clientes reais

- M1 `assinaturas.telefone TEXT NOT NULL` sem UNIQUE: o código novo (`lib/hotmart/linhas.ts:23`, `frontend/src/hooks/useFinance.ts:321`) grava `''` quando o telefone não vem. O NOT NULL é satisfeito, mas a string vazia (a) é dado inválido que nenhum CHECK detecta, (b) faz `verificar_assinatura_ativa('')` e policies comparadas com GUC vazio casarem por engano, (c) não vincula a `perfis.telefone UNIQUE` (o convite só cria perfil se `telefone` for truthy, em `lib/supabaseAdmin.ts:102`). Recomendação: tornar `telefone` nullable + `CHECK (telefone <> '')`, UNIQUE parcial (`WHERE telefone IS NOT NULL`), e backfill em migration de dados separada (`''` -> NULL). Antes de aplicar, contar as linhas com `''`.
- Colunas NOT NULL novas: `perfis.role NOT NULL DEFAULT 'user'` é seguro no PG11+ (default constante, sem reescrita). Nunca adicionar NOT NULL sem DEFAULT em tabela populada (ex.: `contas_a_pagar.categoria NOT NULL` do arquivo morto; `whatsapp_instances.user_id NOT NULL` de schema.sql x nullable nas migrations: apertar exige backfill antes).
- `ADD COLUMN ... UNIQUE` em `assinaturas.hotmart_assinante_codigo` cria índice único com lock de escrita; em tabela grande usar `CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT ... USING INDEX`.
- M2 Índices: nenhum usa CONCURRENTLY (o que só é possível fora de transação, em arquivos próprios). Em `movimentacoes`, índices redundantes: `idx_movimentacoes_idempotency` duplica o UNIQUE implícito; `idx_movimentacoes_telefone` é coberto por `(telefone, mes)`; `idx_movimentacoes_tipo` tem baixa seletividade. Removê-los reduz custo de escrita.
- Alterar CHECK em tabela populada (ex.: `plano IN ('Mensal','Anual')`, status de contas): `ADD CONSTRAINT ... NOT VALID` e depois `VALIDATE CONSTRAINT`.
- Unificar `contas_a_pagar` ('Pendente/Pago' x 'pendente/paga'): migration de dados separada (UPDATE em lotes) depois da de esquema; conciliar código e funções antes.
- Migrar de telefone para `auth.uid()`: manter `perfis.auth_id`, popular por e-mail/telefone; não derrubar a RLS atual antes de a nova estar no ar (evitar janela de exposição).
- Nunca executar o schema.sql antigo em banco com clientes (reseta senha, seção 4).
- M6 `CURRENT_DATE`/`to_char(CURRENT_DATE,'YYYY-MM')` nas funções usam o fuso do banco (UTC): lançamentos feitos após 21h em Brasília caem no dia/mês seguinte; usar `now() AT TIME ZONE 'America/Sao_Paulo'`.

## 7. Achados detalhados (severidade, evidência, ação)

Críticos
- C1 `perfis` sem RLS e com `role` sob controle do cliente: nenhum arquivo executa `ENABLE ROW LEVEL SECURITY` em `perfis` (rls_policies.sql só cria policies, que ficam inertes). Com a anon key qualquer um poderia ler `perfis` (telefone, e-mail) e tentar alterar `role` para 'admin' (o painel confia em `perfil.role === 'admin'`, financeService.ts:145). Ação: ENABLE + FORCE RLS, policies explícitas e `role` alterável só por service_role.
- C2 A ordem natural deixa movimentacoes, orcamentos, contas_a_pagar, lancamentos_recorrentes sem RLS (2.2, passos 3-6 e 11). Ação: ENABLE RLS na mesma migration de criação de cada tabela.
- C3 Credenciais reais no repositório (schema.sql antigo e create_admin.sql). Ação: rotacionar, remover do histórico, nunca versionar senha/hash.
- C4 `\n` literal: movimentacoes e orcamentos (sintaxe inválida); contas_a_pagar, lancamentos_recorrentes, logs_lembrete (no-op total). Funções e RLS desses arquivos nunca foram criadas.
- C5 A cadeia antiga quebra em credit_cards e hotmart (2.1).
- C6 Idempotência por hash descarta lançamentos legítimos (seção 5).

Altos
- A1 `perfis.role` só em create_admin.sql; `lib/supabaseAdmin.ts:51` insere `role:'user'` e quebra em bancos criados só com schema.sql.
- A2 `contas_a_pagar` (schema.sql: status minúsculo, pago_em, movimentacao_id, lembrete_enviado_em) x arquivo (status capitalizado, sem esses campos); `logs_lembrete` idem. `marcar_conta_paga_com_despesa` só funciona com a versão do schema.sql.
- A3 Policies duplicadas por nome entre 3 arquivos.
- A4 Todas as policies dependem de `current_setting('app.user_phone', true)`, que o PostgREST/JWT do Supabase não define: para `anon`/`authenticated` o resultado é NULL (nega tudo; o frontend via supabase-js enxerga vazio), enquanto o bot com service_role contorna a RLS. Decidir: policy por `auth.uid()` via `perfis.auth_id`, ou só service_role.
- A5 `assinaturas` com INSERT/UPDATE pelo próprio telefone permite autoativação (status 'Ativo'); deveria ser só service_role.
- A6 Funções que cruzam modelos (obter_dados_usuario, consultar_saldo_por_usuario) e `json_array_length(x, 0)` inválida.
- A7 `UNIQUE(telefone, categoria, mes)` com `mes` NULL não impede duplicatas; o `ON CONFLICT` de `definir_orcamento` nunca dispara. Usar índice único com `COALESCE(mes,'*')` ou `NULLS NOT DISTINCT` (PG15+).

Médios e baixos: ver tabela de severidade. M3: `SECURITY DEFINER` sem `SET search_path` (update_account_balance, update_savings_goal_amount, seed_default_categories, handle_new_profile e todas as funções do modelo novo) permite sequestro por objetos em schema do usuário.

---

## 8. Proposta de sequência única de migrações (só nomes e conteúdo em uma linha)

Princípio: uma pasta só (`supabase/migrations`), padrão `<timestamp>_nome.sql`, cada arquivo idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS), RLS na própria criação da tabela, sem credenciais, DDL separado de DML, índices concorrentes em arquivo sem transação.

1. `20261117000001_extensoes_e_funcoes_base.sql` — extensions (pgcrypto, uuid-ossp) e `set_updated_at()` com `search_path` fixo.
2. `20261117000002_perfis.sql` — `perfis` (com `role` CHECK, auth_id, telefone UNIQUE), RLS habilitada + policies, trigger updated_at.
3. `20261117000003_assinaturas.sql` — `assinaturas` com telefone nullable + CHECK não vazio, status/plano, escrita só service_role, trigger, índices.
4. `20261117000004_hotmart.sql` — `hotmart_eventos` e colunas de convite/Hotmart em `assinaturas` (versão atual idempotente), RLS sem policies.
5. `20261117000005_movimentacoes.sql` — tabela com CHECKs (valor, tipo, mes AAAA-MM, moeda), idempotency_key vinda do cliente, RLS, trigger.
6. `20261117000006_orcamentos.sql` — tabela com índice único que trata `mes` NULL, RLS, trigger.
7. `20261117000007_contas_a_pagar.sql` — versão do schema.sql (status minúsculo, pago_em, movimentacao_id, lembrete), RLS, trigger.
8. `20261117000008_lancamentos_recorrentes.sql` — tabela, índices, RLS, trigger.
9. `20261117000009_logs_lembrete_uso_custos.sql` — `logs_lembrete` (formato único), `uso_servico`, `custos_fixos`, RLS e triggers.
10. `20261117000010_funcoes_negocio.sql` — `marcar_conta_paga_com_despesa`, `registrar_movimentacao` (corrigida), `definir_orcamento`, `verificar_assinatura_ativa`, com `search_path` e REVOKE de EXECUTE para anon.
11. `20261117000011_rls_policies_por_auth.sql` — policies finais por `auth.uid()`/`perfis.auth_id` no lugar de `app.user_phone`, com DROP POLICY IF EXISTS das antigas.
12. `20261117000012_legado_profiles_a_credit_cards.sql` — consolida as migrations antigas 001-009 e credit_cards (FK para profiles, `set_updated_at`) de forma idempotente.
13. `20261117000013_legado_pluggy_whatsapp.sql` — `pluggy_*`, `whatsapp_sessions`, `whatsapp_instances`, `transacoes` com FKs e nulidade unificadas.
14. `20261117000014_storage_avatars.sql` — bucket e policies do storage com DROP IF EXISTS.
15. `20261117000015_integridade_saldo.sql` — trigger de UPDATE em `transactions`, bloqueio de edição direta de `accounts.balance`, validação de dono nas FKs.
16. `20261117000016_indices_concorrentes.sql` — (sem transação) índices adicionais e remoção dos redundantes via CONCURRENTLY.
17. `20261117000017_backfill_telefone_vazio.sql` — (DML separado) `assinaturas.telefone = ''` para NULL e deduplicação de orçamentos.
18. `supabase/seed.sql` (só dev) — usuário de teste com instance_id/aud/role/identity completos, categorias sem duplicar, contas com transações que justifiquem o saldo; criação de admin fora do repositório (script com variável de ambiente, sem senha no arquivo).

Ordem de execução recomendada em uma linha: extensoes/set_updated_at -> perfis -> assinaturas -> hotmart -> movimentacoes -> orcamentos -> contas_a_pagar -> recorrentes -> logs/uso/custos -> funcoes -> policies por auth -> legado -> storage -> integridade -> indices concorrentes -> backfill -> seed (dev).
