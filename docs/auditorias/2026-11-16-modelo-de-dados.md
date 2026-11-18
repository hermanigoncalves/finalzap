# Auditoria de modelagem de dados e performance (Postgres/Supabase) - FINALZAP

Data: 2026-11-16. Método: skill `supabase-postgres-best-practices` (query/índices, conexão, RLS, schema, locking, acesso a dados). Somente leitura; nenhum banco ou rede foi acessado; nenhum arquivo do projeto foi alterado.

Abreviações de caminho:
- `NOVO/` = `C:\Users\hermani\Desktop\Projetos\finalzap\supabase\`
- `ANTIGO/` = `C:\Users\hermani\Desktop\Projetos\finalzap\WhatsApp-Fin\supabase\`
- `FE/` = `C:\Users\hermani\Desktop\Projetos\finalzap\WhatsApp-Fin\frontend\src\lib\`

## 1. Resumo executivo

O projeto tem **três modelos de dados convivendo** e **nenhum conjunto de arquivos SQL que, executado do zero, produza o banco que o código espera**:

1. Modelo A (antigo, por usuário autenticado): `profiles`, `accounts`, `transactions`, `categories`, `budgets`... (`ANTIGO/schema.sql`, `ANTIGO/migrations/`), chave `user_id` (uuid).
2. Modelo B (intermediário): `transacoes` (`user_id` + `telefone_origem`), usado pelo bot Baileys (`ANTIGO/schema.sql:560-576`).
3. Modelo C (novo, por telefone): `perfis`, `assinaturas`, `movimentacoes`, `orcamentos`, `contas_a_pagar`, `lancamentos_recorrentes`, `logs_lembrete`, `uso_servico`, `custos_fixos` (`NOVO/schema.sql` + `NOVO/finalzap_*.sql`), chave `telefone` (texto) sem nenhuma FK.

O que mais pesa:

- **A RLS do modelo C depende de `current_setting('app.user_phone')`, que nenhum código do repositório define** (busca por `set_config`/`app.user_phone` em .ts/.tsx/.js: zero ocorrências). Com supabase-js no navegador isso nunca funciona: ou o app não lê nada, ou a RLS está desligada na prática. Além disso `perfis` nunca recebe `ENABLE ROW LEVEL SECURITY`.
- **Funções `SECURITY DEFINER` aceitam telefone livre**, sem `search_path`, com `EXECUTE` aberto por padrão no Supabase: qualquer anônimo/cliente lê ou grava dados de qualquer telefone via `/rpc/`.
- **Vários `finalzap_*.sql` estão quebrados**: a sequência literal `\n` dentro de comentário `--` engole o `CREATE TABLE` (erro de sintaxe em uns, no-op silencioso em outros). As funções com `INSERT ... RETURNING ... INTO <json>` falham em execução; `json_array_length(x, 0)` não existe.
- **Idempotência frágil**: chave de `registrar_movimentacao` sem data (bloqueia lançamentos legítimos iguais), upsert de orçamentos não deduplica com `mes` NULL, `marcar_conta_paga_com_despesa` sem lock.
- **Performance**: falta o índice composto `(telefone, data DESC)`; há 8 índices redundantes; saldo e resumos são somados no navegador baixando todas as linhas (e o PostgREST corta em 1000 por padrão: saldo errado sem erro).
- **Reexecução**: nenhum `CREATE POLICY`/`CREATE TRIGGER` é reexecutável; `schema.sql` tem 22 `CREATE INDEX` sem `IF NOT EXISTS`; a migration da Hotmart altera `assinaturas`, que nenhuma migration cria.

Contagem de achados: **Crítico 4 | Alto 14 | Médio 12 | Baixo 4** (34 no total).

## 2. Tabela de achados

Severidades: Crítico (dado exposto/segredo/app inoperante), Alto (bug funcional ou de integridade), Médio (performance/robustez), Baixo (higiene).

### 2.1 Críticos

| ID | Sev. | Arquivo:linha | Problema | Correção (SQL curto) |
|---|---|---|---|---|
| F-01 | Crítico | `NOVO/finalzap_rls_policies.sql:10-39`, `NOVO/rls_policies.sql:9-76`, todos `NOVO/finalzap_*.sql` | RLS compara `telefone = current_setting('app.user_phone', true)`. PostgREST/supabase-js não define essa variável (zero `set_config` no código): a comparação dá NULL, nada é visível ao usuário autenticado; ou a RLS foi desligada em produção para "funcionar". Também é avaliada por linha (sem `(select ...)`). | Ligar ao usuário por `auth.uid()`: `CREATE POLICY mov_sel ON movimentacoes FOR SELECT TO authenticated USING (perfil_id IN (SELECT id FROM perfis WHERE auth_id = (SELECT auth.uid())));`. Bot e webhooks usam `service_role`. |
| F-02 | Crítico | `NOVO/schema.sql:13-24`, `NOVO/rls_policies.sql:9-13` | `perfis` não tem `ENABLE ROW LEVEL SECURITY` em nenhum arquivo; as 2 policies existem mas ficam inertes. Telefone, e-mail e `role` ficam legíveis/gravaveis com a chave anon. | `ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY; REVOKE UPDATE (role, auth_id, telefone) ON public.perfis FROM authenticated;` |
| F-03 | Crítico | `NOVO/schema.sql:193-240`; `NOVO/finalzap_functions.sql:12-76, 95-174`; `NOVO/finalzap_movimentacoes.sql:41-109`; `NOVO/finalzap_orcamentos.sql:33-90` | `SECURITY DEFINER` com `p_telefone` livre, sem `SET search_path`, e `EXECUTE` concedido a `PUBLIC`/`anon`. `/rpc/filtrar_movimentacoes_periodo` devolve dados de qualquer telefone ignorando a RLS; `marcar_conta_paga_com_despesa` lança despesa em conta alheia. | Derivar o telefone de `auth.uid()` dentro da função; `... SECURITY DEFINER SET search_path = ''`; `REVOKE EXECUTE ON FUNCTION f(...) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION f(...) TO authenticated, service_role;`. As de leitura podem ser `SECURITY INVOKER` (a RLS filtra). |
| F-04 | Crítico | `ANTIGO/schema.sql:580-657`; `C:\Users\hermani\Desktop\Projetos\finalzap\create_admin.sql:43-48` | Segredos versionados: o schema antigo cria usuário em `auth.users` com e-mail pessoal e **senha fixa em texto** (linha 587); `create_admin.sql` traz uma senha de admin em comentário (linha 45). Quem tem o repositório tem a credencial. (Valores omitidos aqui de propósito.) | Rotacionar as duas senhas; remover o bloco do schema (usar `seed.sql` só local); em `create_admin.sql` criar o usuário no Dashboard sem registrar a senha; limpar histórico git se já publicado. |

### 2.2 Altos

| ID | Sev. | Arquivo:linha | Problema | Correção |
|---|---|---|---|---|
| F-05 | Alto | `NOVO/finalzap_movimentacoes.sql:5-6`; `NOVO/finalzap_orcamentos.sql:5-8`; `NOVO/finalzap_contas_a_pagar.sql:5`; `NOVO/finalzap_lancamentos_recorrentes.sql:5`; `NOVO/finalzap_logs_lembrete.sql:5` | Arquivos corrompidos: `\n` literais dentro de comentário `--` fazem tudo (inclusive `CREATE TABLE`) virar comentário. `movimentacoes` e `orcamentos` deixam colunas soltas na linha 6+ e dão **erro de sintaxe** (`orcamentos.sql:8` ainda tem `UNIQUE(...) WHERE`, inválido); `contas_a_pagar`, `recorrentes`, `logs_lembrete` viram **no-op silencioso** (parece que rodou). Funções/policies/índices desses arquivos nunca existem. `contas_a_pagar.sql` termina com `"""` e uma `marcar_conta_como_paga` que faria `UPDATE` em **todas** as contas pendentes do telefone se "consertarem" só os `\n`. Há `\n` inofensivos em `finalzap_functions.sql:177`, `finalzap_rls_policies.sql:44`, `create_admin.sql:43`. | Regerar os arquivos com quebras reais e revisar; ou consolidar em migrations (seção 6). Checagem: `grep -c '\\n' arquivo.sql` deve dar 0. |
| F-06 | Alto | `NOVO/finalzap_movimentacoes.sql:91-92`; `NOVO/finalzap_orcamentos.sql:83`; `NOVO/finalzap_lancamentos_recorrentes.sql` e `finalzap_logs_lembrete.sql` (inserts) | `INSERT ... RETURNING a,b,c... INTO v_result` com `v_result JSON`: o PL/pgSQL atribui só a 1ª coluna (uuid) a um json e falha (`invalid input syntax for type json`); `RETURNING * INTO json` idem. Depois faz `v_result->>'id'`. | `INSERT ... RETURNING to_jsonb(movimentacoes.*) INTO v_result;` |
| F-07 | Alto | `NOVO/finalzap_functions.sql:171`; `NOVO/finalzap_lancamentos_recorrentes.sql` (`listar_proximos_lancamentos`) | `json_array_length(v_result, 0)` não existe (1 argumento); `SELECT json_agg(...) ... ORDER BY l.proxima_execucao` é inválido (coluna fora de GROUP BY). | `COALESCE(json_array_length(v_result),0)` e `json_agg(row_to_json(l) ORDER BY l.proxima_execucao)`. |
| F-08 | Alto | `NOVO/finalzap_movimentacoes.sql:56-63` | Chave `md5(telefone\|tipo\|valor\|categoria)` **sem data/descrição**: o 2º "despesa Alimentação R$ 50" da vida do cliente é tratado como duplicado ("já existia") e some em silêncio. Verifica com `SELECT EXISTS` e depois insere (corrida: dois envios simultâneos geram `unique_violation`). O front (`FE/financeService.ts:189`) usa `tel\|data\|descricao\|tipo\|valor` e não trata 23505. | Receber a chave do chamador (id da mensagem do WhatsApp) e usar `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING ...`; no front tratar 23505 como sucesso idempotente. |
| F-09 | Alto | `NOVO/finalzap_functions.sql:84-114` (`obter_dados_usuario`), `:131-136` (`consultar_saldo_por_usuario`) | Funções do modelo C apontam para o modelo A e para **colunas inexistentes**: `profiles.telefone` (a tabela tem `phone`) e `accounts.telefone`/`accounts.status`. Compilam (ligação tardia) e falham ao executar. | Reescrever sobre `perfis`/`movimentacoes` (`SUM(CASE tipo WHEN 'receita' THEN valor ELSE -valor END)`), ou remover. |
| F-10 | Alto | `NOVO/schema.sql:98-117` x conteúdo embutido em `finalzap_contas_a_pagar.sql:5`; `NOVO/schema.sql:143-148` x `finalzap_logs_lembrete.sql:5`; `NOVO/schema.sql:36` x `finalzap_assinaturas.sql:16`; `FE/supabaseService.ts:778,792` | Duas definições divergentes da mesma tabela; com `CREATE TABLE IF NOT EXISTS`, vence a que rodar primeiro. `contas_a_pagar`: status `pendente/paga` (schema.sql, função, TS) x `Pendente/Pago` (arquivo; sem `pago_em`/`movimentacao_id`). `logs_lembrete`: o `schema.sql` tem `enviado_em` e nada de `tipo_lembrete/status/data_envio`, mas o front consulta/insere `data_envio`, `tipo_lembrete`, `status` (erro 400). `assinaturas.plano`: CHECK `Mensal/Anual` no arquivo x texto livre da Hotmart (`lib/hotmart/linhas.ts:29`). `custos_fixos` e `uso_servico` não estão no `schema.sql`. | Eleger **uma** definição por tabela (a que o front/funções usam). `logs_lembrete`: `tipo_lembrete, status, erro, detalhes jsonb, data_envio`. `plano`: sem CHECK (ou lista alinhada à Hotmart). |
| F-11 | Alto | `NOVO/schema.sql:88`; `NOVO/finalzap_orcamentos.sql:8,81`; `FE/financeService.ts:366`, `FE/supabaseService.ts:696` | `UNIQUE(telefone, categoria, mes)` não deduplica com `mes IS NULL` (NULL != NULL): o orçamento "global" duplica a cada upsert; o `ON CONFLICT` de `definir_orcamento` nunca dispara. A versão do arquivo (`UNIQUE ... WHERE`) é inválida; se virasse índice parcial, o `onConflict` do PostgREST (sem predicado) não o acharia. | PG15+: `ALTER TABLE orcamentos ADD CONSTRAINT orc_uk UNIQUE NULLS NOT DISTINCT (telefone, categoria, mes);` (funciona em `onConflict`). Limpar duplicatas antes. |
| F-12 | Alto | `NOVO/schema.sql:193-240`; `NOVO/finalzap_functions.sql:12-76`; `FE/financeService.ts:471-480` | `marcar_conta_paga_com_despesa`: (a) sem `SELECT ... FOR UPDATE`: chamadas simultâneas fazem a 2ª estourar `unique_violation` em vez de responder "já paga"; (b) paga conta `cancelada`; (c) existem 2 versões diferentes (a última executada vence); (d) retorna `success/message`, o front tipa `sucesso/mensagem` e lê `undefined`; (e) `IF v_conta IS NULL` em RECORD (usar `NOT FOUND`); (f) vide F-03. | `SELECT * INTO v_conta FROM contas_a_pagar WHERE id=p_conta_id AND <dono> FOR UPDATE; IF NOT FOUND THEN ...; IF v_conta.status='cancelada' THEN ...`; padronizar chaves do JSON; manter uma função só. |
| F-13 | Alto | todas as tabelas do modelo C (`telefone TEXT NOT NULL`); `lib/hotmart/linhas.ts:20-31` | Telefone é o identificador do cliente em 9 tabelas, sem FK para `perfis`, sem CHECK de formato, sem ON DELETE/UPDATE. Efeitos: órfãos ao excluir cliente (LGPD), troca de número quebra histórico, a Hotmart grava `''` quando falta telefone (colide entre clientes) e o front perde acesso (`resolverTelefoneUsuario` retorna null, `FE/financeService.ts:98-111`). O formato real é só dígitos com DDI 55 (`lib/hotmart/telefone.ts`), sem garantia no banco. | `perfil_id uuid NOT NULL REFERENCES perfis(id) ON DELETE CASCADE` nas tabelas de dados; `CHECK (telefone ~ '^55[0-9]{10,11}$')` em `perfis`; `assinaturas.telefone` NULL (não `''`) + `UNIQUE (telefone) WHERE telefone IS NOT NULL`. |
| F-14 | Alto | `ANTIGO/migrations/20261116000003_hotmart.sql:17-22`; `NOVO/finalzap_hotmart.sql:17-22` | A migration faz `ALTER TABLE public.assinaturas ADD COLUMN ...`, mas **nenhuma migration cria `assinaturas`** (só `NOVO/schema.sql`, fora de migrations). `supabase db reset/push` falha. Numeração `...000003` sem 1 e 2; `NOVO/` não tem `migrations/`; conteúdo da Hotmart duplicado em 2 lugares. | Criar `20261116000001_modelo_novo.sql` (perfis...custos_fixos) antes da Hotmart; manter um único local de migrations. |
| F-15 | Alto | `NOVO/finalzap_rls_policies.sql:11-12`, `NOVO/rls_policies.sql:21-22`, `NOVO/finalzap_assinaturas.sql:38-43`; `FE/financeService.ts:628-660` | O cliente pode `INSERT`/`UPDATE` na própria linha de `assinaturas`: basta gravar `status='Ativo'` e vencimento futuro para se autoliberar sem pagar. A Hotmart grava com `service_role`. | Remover INSERT/UPDATE de `authenticated` em `assinaturas` (só SELECT); escrita só por `service_role`. |
| F-16 | Alto | `FE/financeService.ts:249-320` (`consultar_saldo`, `consultar_resumo_mensal`, `consultar_resumo_varios_meses`) | Saldo e resumos são somados em JavaScript depois de baixar **todas** as linhas (o resumo de vários meses nem filtra por mês). O PostgREST aplica `max-rows` (padrão 1000): acima disso o saldo fica **errado sem erro**. Custo O(n) por tela. | RPC no banco: `SELECT mes, SUM(valor) FILTER (WHERE tipo='receita') AS receitas, SUM(valor) FILTER (WHERE tipo='despesa') AS despesas FROM movimentacoes WHERE perfil_id=$1 AND data >= $2 GROUP BY 1 ORDER BY 1 DESC LIMIT 6;` (`SECURITY INVOKER`). |
| F-17 | Alto | `NOVO/schema.sql:69-74` | Falta o índice da consulta real `WHERE telefone=? [AND mes=?] ORDER BY data DESC [LIMIT]` (`FE/financeService.ts:234-242`, `FE/supabaseService.ts:642-646`): sem `mes` ordena todo o histórico do cliente; com `mes` ordena em memória. Há 6 índices e nenhum é o certo. | `CREATE INDEX CONCURRENTLY idx_mov_tel_data ON movimentacoes (telefone, data DESC) INCLUDE (tipo, valor, categoria);` |
| F-18 | Alto | `C:\Users\hermani\Desktop\Projetos\finalzap\create_admin.sql:10-19,35,52,58` | Não executa depois do `schema.sql`: `perfis` já existe sem `role` (o `CREATE TABLE IF NOT EXISTS` ignora a definição) e o `INSERT ... role` falha; `CREATE TRIGGER tr_perfis_updated` repete o de `schema.sql:164` (erro "already exists", aborta antes do INSERT); `v_auth_id UUID := 'SEU_AUTH_ID_AQUI'` é uuid inválido. O front exige `role` (`FE/financeService.ts:113-137`) mas o `schema.sql` não o cria. | `ALTER TABLE perfis ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'));` no schema; `DROP TRIGGER IF EXISTS` antes de criar; admin vira `UPDATE perfis SET role='admin' WHERE auth_id = '<uuid>'`. |

### 2.3 Médios

| ID | Sev. | Arquivo:linha | Problema | Correção |
|---|---|---|---|---|
| F-19 | Médio | `NOVO/schema.sql:62,85` | `mes TEXT` redundante com `data DATE`, **sem CHECK** (aceita `'2026-13'` ou divergir de `data`); o front calcula `data.slice(0,7)` (`FE/financeService.ts:190`). Idem `orcamentos.mes`. | Coluna gerada: `mes text GENERATED ALWAYS AS (lpad(extract(year FROM data)::int::text,4,'0')\|\|'-'\|\|lpad(extract(month FROM data)::int::text,2,'0')) STORED`; ou remover `mes` e filtrar por intervalo (`data >= '2026-11-01' AND data < '2026-12-01'`, usa `idx_mov_tel_data`). Em `orcamentos`: `CHECK (mes ~ '^\d{4}-(0[1-9]\|1[0-2])$')`. |
| F-20 | Médio | `NOVO/schema.sql:61`; `NOVO/finalzap_functions.sql:56-57`; `NOVO/schema.sql:225-226` | `CURRENT_DATE`/`to_char(CURRENT_DATE, ...)` usam o fuso da sessão (UTC no Supabase): lançamento entre 21h e 24h (BRT) cai no dia seguinte; no fim do mês cai no mês errado. | `DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)` e o mesmo expression na função. |
| F-21 | Médio | `NOVO/schema.sql:38-39`; `FE/financeService.ts:628-660` | `data_inicio DATE` x `data_vencimento TIMESTAMPTZ` na mesma tabela; o front envia `YYYY-MM-DD` a uma coluna `timestamptz`, que vira 00:00 UTC (21h do dia anterior em BRT): assinatura "vence um dia antes". Sem `CHECK (data_vencimento >= data_inicio)`. | Padronizar `data_vencimento DATE` (regra por dia) ou gravar `timestamptz` com fuso explícito. |
| F-22 | Médio | `NOVO/schema.sql:156-186`; `NOVO/finalzap_custos_fixos.sql:20` | `custos_fixos.updated_at` sem trigger (nunca muda); `set_updated_at()` sem `SET search_path`. | `DROP TRIGGER IF EXISTS tr_custos_updated ON custos_fixos; CREATE TRIGGER tr_custos_updated BEFORE UPDATE ON custos_fixos FOR EACH ROW EXECUTE FUNCTION set_updated_at(); ALTER FUNCTION set_updated_at() SET search_path = '';` |
| F-23 | Médio | `NOVO/schema.sql:23-24,45-47,69-74,91-92,113-117,137-138,150-151` (22 `CREATE INDEX`) e `:164-186` (6 `CREATE TRIGGER`); `NOVO/rls_policies.sql`; `NOVO/finalzap_rls_policies.sql`; `ANTIGO/schema.sql:71,77,138,...` | Não reexecutável: `CREATE INDEX` sem `IF NOT EXISTS`, nenhum `CREATE POLICY`/`CREATE TRIGGER` com `DROP ... IF EXISTS` (a hotmart e `create_admin` usam `IF NOT EXISTS` só em parte). As mesmas policies são definidas em 3 lugares (arquivo da tabela, `rls_policies.sql`, `finalzap_rls_policies.sql`): nomes iguais dão "already exists"; nomes diferentes empilham (permissivas em `OR`), ex.: `Users can view own bills` x `own accounts` x `Users can manage their accounts` em `contas_a_pagar`. | Um único lugar para RLS; `DROP POLICY IF EXISTS "nome" ON t;` antes de cada `CREATE POLICY`; `CREATE INDEX IF NOT EXISTS`; ideal: migrations (cada uma roda uma vez). |
| F-24 | Médio | `NOVO/schema.sql:23,69-74,91,113,137,46,115` | Índices redundantes/inúteis (custo de escrita; 6 em `movimentacoes`): `idx_movimentacoes_idempotency` (:74) duplica o `UNIQUE`; `idx_perfis_telefone` (:23) duplica `UNIQUE(telefone)`; `idx_movimentacoes_telefone`, `idx_orcamentos_telefone`, `idx_contas_telefone` são prefixo de composto; `idx_movimentacoes_mes`, `_tipo`, `_data`, `idx_assinaturas_status`, `idx_contas_status` isolados têm baixa seletividade e não casam com consulta alguma (todas filtram por telefone). | `DROP INDEX CONCURRENTLY idx_movimentacoes_idempotency, idx_movimentacoes_telefone, idx_movimentacoes_mes, idx_movimentacoes_tipo, idx_movimentacoes_data, idx_perfis_telefone, idx_orcamentos_telefone, idx_contas_telefone;` (depois de criar F-17). |
| F-25 | Médio | `NOVO/schema.sql:45-47,107,113-117,137-138` | Faltam índices dos jobs e da FK: lembretes (`vencimento` das pendentes sem lembrete), recorrentes vencidas, expiração/`verificar_assinatura_ativa`; `contas_a_pagar.movimentacao_id` (FK) sem índice. | `CREATE INDEX ON contas_a_pagar (vencimento) WHERE status='pendente' AND lembrete_enviado_em IS NULL; CREATE INDEX ON lancamentos_recorrentes (proxima_execucao) WHERE ativo; CREATE INDEX ON assinaturas (telefone) WHERE status='Ativo'; CREATE INDEX ON contas_a_pagar (movimentacao_id);` |
| F-26 | Médio | `NOVO/schema.sql:107,108,146` | `logs_lembrete.conta_id ... ON DELETE CASCADE` apaga a auditoria quando a conta é removida; `movimentacao_id ... SET NULL` deixa conta `paga` sem despesa; nada impede lembrete duplicado (propósito declarado da tabela); `lembrete_enviado_em` duplica o log. | `conta_id ... ON DELETE SET NULL`; `CREATE UNIQUE INDEX ON logs_lembrete (conta_id, tipo_lembrete, (data_envio::date)) WHERE status='enviado';` `CHECK (status <> 'paga' OR (pago_em IS NOT NULL AND movimentacao_id IS NOT NULL))`. |
| F-27 | Médio | `NOVO/finalzap_rls_policies.sql:39`; `NOVO/finalzap_uso_servico.sql:37-39`; `NOVO/finalzap_custos_fixos.sql:33-42`; `FE/financeService.ts:675,876` | `logs_lembrete` com `INSERT WITH CHECK (TRUE)`: qualquer um grava log de qualquer telefone. `uso_servico` e `custos_fixos` (custos do negócio: servidor, marketing) ficam em tabelas por telefone de cliente com INSERT do cliente (forja de custo/uso). Sem policy de DELETE: o `delete` do front em `assinaturas`/`custos_fixos` retorna 0 linhas sem erro (falha silenciosa). | Logs/uso só por `service_role`; `custos_fixos` só admin (policy por `perfis.role='admin'`); criar DELETE onde o front precisa. |
| F-28 | Médio | `ANTIGO/schema.sql:202-228,413-440,109-113,127-131,126,656` | Saldo denormalizado por trigger só trata `INSERT`/`DELETE`: `UPDATE` de `amount/type/account_id` em `transactions` (e de `amount` em `savings_contributions`) desalinha `accounts.balance`/`current_amount`. Triggers `SECURITY DEFINER` sem `search_path`. `seed_default_categories` sem `UNIQUE(user_id,name)` duplica categorias a cada chamada (chamada de novo na linha 656). | `AFTER UPDATE` (ou calcular saldo por `SUM`); `SET search_path = ''`; `UNIQUE (user_id, name, type)` + `ON CONFLICT DO NOTHING`. |
| F-29 | Médio | `ANTIGO/schema.sql:475,488,494,451,312-319,77-79` | Inconsistências do modelo A: `pluggy_*` referenciam `auth.users` e o resto `profiles(id)`; `pluggy_accounts.pluggy_item_id` texto sem FK; `credit_cards.available_limit` sem CHECK; `budgets` sem mês (o modelo C tem orçamento por mês: regra divergente); policies `auth.uid() = user_id` sem `(SELECT auth.uid())`. | `USING ((SELECT auth.uid()) = user_id)`; `CHECK (available_limit BETWEEN 0 AND credit_limit)`; FK composta `pluggy_accounts(user_id, pluggy_item_id) -> pluggy_items(user_id, pluggy_item_id)`. |
| F-30 | Médio | `NOVO/finalzap_hotmart.sql:4-22`; `lib/hotmart/linhas.ts:55-69` | `hotmart_eventos.payload jsonb` guarda o corpo do webhook (e-mail, telefone, nome = dado pessoal) sem retenção nem índice em `recebido_em`/`assinante_codigo`; cresce sem teto. `convite_reenviado_por uuid` sem FK. Duas colunas para o mesmo conceito: `hotmart_id` (`schema.sql:35`) e `hotmart_assinante_codigo`. | `CREATE INDEX ON hotmart_eventos (recebido_em);` job pg_cron `DELETE ... WHERE recebido_em < now() - interval '90 days'` (ou remover PII do payload); `convite_reenviado_por uuid REFERENCES perfis(id) ON DELETE SET NULL`; consolidar `hotmart_id`. |

### 2.4 Baixos

| ID | Sev. | Arquivo:linha | Problema | Correção |
|---|---|---|---|---|
| F-31 | Baixo | `NOVO/rls_policies.sql:82-93` | `set_user_phone()` é função de trigger que só mexe em `NEW.nome`, não está ligada a nada e o comentário induz a erro. | Remover. |
| F-32 | Baixo | `NOVO/finalzap_orcamentos.sql:44-48` | `consultar_orcamento_mes`: `SELECT * INTO` sem `ORDER BY/LIMIT`; com `p_mes` NULL pega linha global ou mensal ao acaso; sem fallback do mês para o global. | `WHERE mes = p_mes OR mes IS NULL ORDER BY (mes IS NULL) LIMIT 1`. |
| F-33 | Baixo | `NOVO/finalzap_lancamentos_recorrentes.sql` (`inserir_lancamento_recorrente`) | `CASE` sem `ELSE` levanta `CASE_NOT_FOUND`; "mensal" calcula o **último dia do mês corrente** como próxima execução. | `ELSE RAISE EXCEPTION`; `v_proxima := CURRENT_DATE + INTERVAL '1 month'`. |
| F-34 | Baixo | `NOVO/schema.sql:8,14,...` (`uuid_generate_v4`); `ANTIGO/schema.sql:11-12` | `uuid-ossp` desnecessário (`gen_random_uuid()` é nativo; a Hotmart já usa); chaves JSON com acento (`'já_existia'`), capitalização de status inconsistente (`'Ativo'` x `'pendente'`). | `DEFAULT gen_random_uuid()`; padronizar minúsculas e chaves ASCII. |

## 3. Diagrama textual: como está

```
AUTH
  auth.users (id)
     ^
=== MODELO A (antigo, por user_id) ===========================================
  profiles (id = auth.users.id, phone) 1--N categories, accounts, transactions,
     fixed_transactions, investments, budgets (PK user_id+category_id),
     savings_goals 1--N savings_contributions, credit_cards, whatsapp_instances
  accounts 1--N transactions N--1 categories      [trigger de saldo: so INSERT/DELETE]
  auth.users 1--N pluggy_items / pluggy_accounts  (user_id -> auth.users, nao profiles)
  whatsapp_sessions (session_id,type,id)          [service_role]

=== MODELO B (intermediario) ==================================================
  transacoes (user_id -> profiles, telefone_origem texto)      <- bot Baileys

=== MODELO C (novo, por telefone texto) ======================================
  perfis (id, auth_id -> auth.users SET NULL, telefone UNIQUE)  [RLS nunca ligada;
                                                               role so no create_admin]
        . . . . (nenhuma FK; ligacao so por texto "telefone") . . . .
  assinaturas      (telefone, hotmart_id, hotmart_assinante_codigo UNIQUE, ...)
  movimentacoes    (telefone, data DATE, mes TEXT, idempotency_key UNIQUE)   <- cresce
  orcamentos       (telefone, categoria, mes NULL?)  UNIQUE(tel,cat,mes) [falha com NULL]
  contas_a_pagar   (telefone) --movimentacao_id--> movimentacoes (SET NULL)
  lancamentos_recorrentes (telefone)
  logs_lembrete    (telefone) --conta_id--> contas_a_pagar (CASCADE)       [2 definicoes]
  uso_servico, custos_fixos (telefone)                       [fora do schema.sql]
  hotmart_eventos  (chave UNIQUE, payload jsonb)             [service_role]

RLS (C):    telefone = current_setting('app.user_phone')  -> nunca definido
Funcoes (C): SECURITY DEFINER + telefone livre; algumas leem o modelo A
```

## 4. Diagrama textual: como deveria ficar

```
auth.users (id)
   ^ 1
   | 0..1  (auth_id, ON DELETE SET NULL; preenchido ao aceitar o convite)
perfis (id uuid PK, auth_id UNIQUE, telefone UNIQUE CHECK ^55\d{10,11}$,
        role CHECK user|admin, nome, email)     [RLS ligada; role/telefone nao editaveis]
   | 1
   +--N-- movimentacoes (perfil_id FK CASCADE, data DATE, tipo, valor numeric(12,2),
   |         categoria, descricao, fonte, idempotency_key UNIQUE, mes GERADO ou removido)
   |         IDX (perfil_id|telefone, data DESC) INCLUDE (tipo,valor,categoria)
   +--N-- orcamentos (perfil_id, categoria, mes NULL) UNIQUE NULLS NOT DISTINCT
   +--N-- contas_a_pagar (perfil_id, status CHECK, pago_em, movimentacao_id FK SET NULL)
   |          \--N-- logs_lembrete (conta_id FK SET NULL, UNIQUE anti-duplicidade)
   +--N-- lancamentos_recorrentes (perfil_id)  IDX parcial (proxima_execucao) WHERE ativo
   +--N-- assinaturas (perfil_id NULL ate o convite; telefone NULL se ausente;
   |         hotmart_assinante_codigo UNIQUE)   [cliente: so SELECT; escrita service_role]
   \--N-- uso_servico (perfil_id)               [escrita service_role]
custos_fixos (sem telefone de cliente; so admin)
hotmart_eventos (chave UNIQUE; sem PII no payload ou retencao de 90 dias)

Modelos A e B: congelar. Decidir (a) migrar o painel web para perfis/movimentacoes e
descartar accounts/transactions/transacoes, ou (b) manter A so para o painel. Enquanto
nao houver decisao, funcoes de C nao podem apontar para A (F-09).
RLS:     perfil_id IN (SELECT id FROM perfis WHERE auth_id = (SELECT auth.uid()))
Funcoes: telefone derivado de auth.uid(), SET search_path = '', REVOKE de anon/PUBLIC.
```

## 5. O que acontece com muitos clientes

Estimativa para `movimentacoes` (linha ~150 bytes, 3 lançamentos/cliente/dia; valores aproximados):

| Clientes | Linhas/ano | Tabela + 6 índices atuais | Com os índices úteis (2) |
|---|---|---|---|
| 1 mil | ~1,1 mi | ~0,5 GB | ~0,25 GB |
| 10 mil | ~11 mi | ~5 GB | ~2,5 GB |
| 100 mil | ~110 mi | ~50 GB | ~25 GB |

- Com o índice composto certo (F-17), a consulta de um mês de um cliente é pequena e não piora com o número de clientes. O gargalo não é o volume total e sim: (1) consultas por cliente sem limite de mês/linhas (F-16), (2) custo de escrita dos 6 índices a cada lançamento (F-24), (3) RLS avaliada por linha sem `(SELECT ...)` (F-01).
- **Particionamento: não agora.** Só vale acima de ~50-100 mi de linhas ou para expurgo por período. Se vier: `PARTITION BY RANGE (data)` exige `data` na PK e em todo `UNIQUE`, então `idempotency_key UNIQUE` global deixa de existir; a idempotência iria para tabela própria `idempotencia(chave PK, criada_em)` com expurgo de 30 dias. Particionar por hash de `telefone` não ajuda consultas por mês.
- `uso_servico` e `hotmart_eventos` crescem sem teto: definir retenção. `autovacuum` padrão basta; `UPDATE` frequente em `contas_a_pagar`/`assinaturas` gera bloat leve (`fillfactor` 90 se necessário).
- Consultas por mês: filtro por intervalo de `data` ou `mes` gerado; para painéis de 6-12 meses, agregação no banco (F-16); se pesar, tabela `resumo_mensal(perfil_id, mes, receitas, despesas)` mantida por trigger/job.
- Conexões: webhook Hotmart e bot (service_role, serverless) devem usar o pooler transacional (porta 6543) para não esgotar conexões; funções não podem depender de `SET` de sessão (mais um motivo para F-01/F-03 derivarem o dono de `auth.uid()`).

SQL consolidado de performance (rodar fora de transação):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mov_tel_data ON public.movimentacoes (telefone, data DESC) INCLUDE (tipo, valor, categoria);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contas_pend ON public.contas_a_pagar (vencimento) WHERE status = 'pendente';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rec_prox ON public.lancamentos_recorrentes (proxima_execucao) WHERE ativo;
DROP INDEX CONCURRENTLY IF EXISTS idx_movimentacoes_idempotency;
DROP INDEX CONCURRENTLY IF EXISTS idx_movimentacoes_telefone;
DROP INDEX CONCURRENTLY IF EXISTS idx_movimentacoes_mes;
DROP INDEX CONCURRENTLY IF EXISTS idx_movimentacoes_tipo;
DROP INDEX CONCURRENTLY IF EXISTS idx_movimentacoes_data;
DROP INDEX CONCURRENTLY IF EXISTS idx_perfis_telefone;
```

## 6. Ordem de correção recomendada

1. **Hoje (segurança, sem mudar o modelo):** F-04 (rotacionar senhas e limpar), F-02 (`ENABLE RLS` em `perfis`), F-03 (`REVOKE EXECUTE ... FROM PUBLIC, anon` + `SET search_path = ''`), F-15 (retirar INSERT/UPDATE de `assinaturas` do cliente), F-27 (policy `WITH CHECK (TRUE)`).
2. **Decidir o modelo oficial** (C por `perfil_id`; A e B congelados ou migrados) e escrever **uma** migration limpa do modelo C: F-05, F-10, F-13, F-14, F-18, F-34. Eliminar os `finalzap_*.sql` soltos e as policies duplicadas (F-23).
3. **RLS correta por `auth.uid()`** em todas as tabelas (F-01) com `(SELECT auth.uid())` e `DROP POLICY IF EXISTS` + `CREATE`; testar com dois usuários (skill `supabase-audit-rls`).
4. **Funções corrigidas:** F-06, F-07, F-08, F-09, F-12, F-32, F-33 (dono derivado de `auth.uid()`, `INSERT ... ON CONFLICT`, `FOR UPDATE`, `to_jsonb`).
5. **Constraints e tipos:** F-11 (`NULLS NOT DISTINCT`), F-19, F-20, F-21, F-26 e CHECKs de formato.
6. **Índices e agregações:** F-17, F-24, F-25 (`CONCURRENTLY`) e F-16 (RPC de resumo; ajustar `FE/financeService.ts`).
7. **Manutenção:** F-22, F-28/F-29 (se o modelo A for mantido), F-30 (retenção Hotmart), F-31 a F-34.

Observação de escopo: `lib/hotmart/` e `lib/supabaseAdmin.ts` foram apenas lidos (outro agente os edita). Pontos que dependem deles: telefone `''` quando ausente (F-13); `onConflict: 'hotmart_assinante_codigo'` funciona porque a coluna tem UNIQUE simples (F-14); `perfis` só é criado no convite, então cliente com conta existente fica sem perfil e o front não resolve o telefone.
