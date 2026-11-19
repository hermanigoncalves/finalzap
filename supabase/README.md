# Supabase FINALZAP

Modelo atual (por telefone, em português) = migrações `2026111*`. `schema.sql` e as migrações `202603*` são o modelo legado em inglês (não apagar).

## Ordem (todas reexecutáveis e aditivas; nada é apagado)
1. `20261116000001_tabelas_pt.sql`: normalizar_telefone_br, tabelas, índices, triggers (updated_at, mes, status), RLS ligada.
2. `20261116000002_funcoes_pt.sql`: RPCs (SECURITY INVOKER, search_path fixo, EXECUTE só service_role; `authenticated` só em marcar_conta_paga_com_despesa).
3. `20261116000003_hotmart.sql`: hotmart_eventos, colunas de convite, assinaturas.telefone anulável.
4. `20261117000001_seguranca_rls.sql`: policies por auth.uid() -> perfis, grants de perfis, realtime.
5. `20261118000001_n8n_no_supabase.sql`: suporte ao nó nativo do Supabase no n8n (tabelas/views, sem RPC): telefone canônico em INSERT direto, trigger que lança a despesa ao `UPDATE contas_a_pagar SET status='paga'` (mesma `idempotency_key` `conta_<id>` da RPC), views `vw_resumo_mensal` e `vw_saldo` (security_invoker, só service_role), grants (anon sem acesso às tabelas).
6. `20261118000002_correcoes_qa.sql`: correções da revisão de QA (inclui `vincular_perfil_por_email`).
7. `20261118000003_credenciais_servico.sql`: tabela `credenciais_servico` (só service_role).
8. `20261118000004_entradas_dashboard_admin.sql`: tabela `entradas` e `resumo_admin_mensal`.
9. `20261118000005_taxas_hotmart_custos_usd.sql`: taxas da Hotmart e custos em USD.
10. `20261118000006_resumo_admin_periodo.sql`: `resumo_admin_periodo`.
11. `20261118000007_handle_new_user_definer.sql`: restaura `SECURITY DEFINER` em `handle_new_user` (cadastro novo falhava com "Database error saving new user").
12. `20261119000001_endurece_funcoes_indices.sql`: `search_path` e REVOKE nas funções DEFINER legadas (`seed_default_categories` etc., só se existirem), gatilho de reabrir conta filtra pelo dono, índices `uso_servico(data)` e `assinaturas(telefone)`.
13. `20261119000002_chave_conta_do_dono.sql`: a chave `conta_<id>` em `movimentacoes` só pode ser usada pelo dono da conta (impede outro usuário de "sequestrar" a despesa de uma conta paga).

Aplicação: SQL Editor, ou `supabase db push`. Teste num Postgres limpo: `npm i --no-save @electric-sql/pglite && node --test tests/sql_banco_limpo.test.mjs`.
`seed.sql` não cria usuário/senha (use o Supabase Auth). Estado do banco real: `docs/banco-estado-atual.md`.
