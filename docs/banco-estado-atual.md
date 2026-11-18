# Estado do banco Supabase (consultado em 2026-11-17, projeto xtpdfqvjffpukiwqciso)

Postgres 17.11. Extensões: pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault, plpgsql.
25 tabelas em `public`, todas com RLS ligada. Dados: só 1 linha em `perfis` (admin, ligado a auth.users); todas as demais tabelas do modelo em português estavam vazias.

## Antes das migrações
- Modelo PT existia (perfis, assinaturas, movimentacoes, orcamentos, contas_a_pagar, lancamentos_recorrentes, logs_lembrete, uso_servico, custos_fixos, hotmart_eventos) + legado inglês (profiles, accounts, transactions, categories, budgets, fixed_transactions, investments, savings_*, credit_cards, pluggy_*, transacoes, whatsapp_*).
- Diferenças em relação aos rascunhos: contas_a_pagar.status aceitava só Pendente/Pago/Cancelada/paga (default 'Pendente', código usa 'pendente'); logs_lembrete com colunas tipo_lembrete/status/data_envio (NOT NULL); orcamentos sem UNIQUE inline (2 índices parciais); uso_servico sem `referencia`; assinaturas.telefone NOT NULL; sem triggers em movimentacoes (mes) nem updated_at nas tabelas PT; mes CHECK frouxo (`\d{4}-\d{2}`); movimentacoes.data default CURRENT_DATE (UTC).
- Funções: 6 RPCs antigas retornando `json` (registrar_movimentacao 6 args, marcar_conta_paga_com_despesa sem lock/validação, verificar_assinatura_ativa por igualdade de telefone, etc.). Faltavam definir_orcamento, cadastrar_conta_a_pagar, resumo_mensal, saldo_total, contas_para_lembrar, normalizar_telefone_br.
- Policies PT já por auth.uid()->perfis (telefone_do_usuario/eh_admin SECURITY DEFINER). EXECUTE de funções aberto a anon/PUBLIC.

## Aplicado (nesta ordem; reaplicação testada, idempotente)
1. tabelas_pt, 2. funcoes_pt, 3. hotmart, 4. seguranca_rls: ver `supabase/README.md`.

## Pendências / não feito (destrutivo ou decisão)
- Índices antigos redundantes (idx_*_telefone, idx_orcamentos_unique_*, idx_movimentacoes_data/mes/tipo...) mantidos; remover depois (DROP INDEX).
- Constraint antiga movimentacoes_mes_check mantida (a nova estrita convive).
- Modelo inglês legado (profiles, transactions...) mantido; `transacoes` (Baileys) segue existindo.
- Senha que existia em schema.sql continua no histórico do git: rotacionar a senha e, se quiser, limpar o histórico.
- Unicidade de assinaturas por telefone não foi criada (renovações legítimas); só hotmart_assinante_codigo é UNIQUE.
