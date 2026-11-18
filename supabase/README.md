# Supabase FINALZAP

Modelo atual (por telefone, em português) = migrações `2026111*`. `schema.sql` e as migrações `202603*` são o modelo legado em inglês (não apagar).

## Ordem (todas reexecutáveis e aditivas; nada é apagado)
1. `20261116000001_tabelas_pt.sql`: normalizar_telefone_br, tabelas, índices, triggers (updated_at, mes, status), RLS ligada.
2. `20261116000002_funcoes_pt.sql`: RPCs (SECURITY INVOKER, search_path fixo, EXECUTE só service_role; `authenticated` só em marcar_conta_paga_com_despesa).
3. `20261116000003_hotmart.sql`: hotmart_eventos, colunas de convite, assinaturas.telefone anulável.
4. `20261117000001_seguranca_rls.sql`: policies por auth.uid() -> perfis, grants de perfis, realtime.
5. `20261118000001_n8n_no_supabase.sql`: suporte ao nó nativo do Supabase no n8n (tabelas/views, sem RPC): telefone canônico em INSERT direto, trigger que lança a despesa ao `UPDATE contas_a_pagar SET status='paga'` (mesma `idempotency_key` `conta_<id>` da RPC), views `vw_resumo_mensal` e `vw_saldo` (security_invoker, só service_role), grants (anon sem acesso às tabelas).

Aplicação: SQL Editor, ou `supabase db push`. Teste num Postgres limpo: `npm i --no-save @electric-sql/pglite && node --test tests/sql_banco_limpo.test.mjs`.
`seed.sql` não cria usuário/senha (use o Supabase Auth). Estado do banco real: `docs/banco-estado-atual.md`.
