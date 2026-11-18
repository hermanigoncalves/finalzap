# Plano Paperclip — o que falta para o FINALZAP funcionar

Escopo do assistente (n8n): registrar receita/despesa, consultar movimentações e saldo, resumo mensal, orçamento por categoria, contas a pagar e vencimentos, marcar conta paga (gera despesa), dicas de economia. Moeda única: BRL.

Fonte da verdade do banco: tabelas em português (`perfis`, `assinaturas`, `movimentacoes`, `orcamentos`, `contas_a_pagar`, `lancamentos_recorrentes`, `logs_lembrete`, `uso_servico`, `custos_fixos`, `hotmart_eventos`). Identificador do usuário: `telefone`.

| # | Tarefa | Agente | Depende de |
|---|--------|--------|-----------|
| 1 | Schema mestre completo e funções SQL corrigidas | Banco e Seguranca | — |
| 2 | Revisar RLS antes de aplicar (FIN-1) | Banco e Seguranca | 1 |
| 3 | Fluxo n8n usando Supabase (`n8n/finalzap-supabase.json`) | Backend | 1; credencial Supabase criada pelo dono no n8n |
| 4 | API e bot-server só com tabelas em português | Backend | 1 |
| 5 | Painel sem dependência das tabelas em inglês | Frontend | 1 |
| 6 | Testes do código real, tsc e build (FIN-2) | QA | 1, 4, 5 |
| 7 | Admin: validar guarda de rota e role | QA | 5 |
| 8 | Documentação de deploy, `.env` e commits organizados | Coordenador | todas |

Regras: não commitar segredos; não alterar o workflow original no n8n cloud (trabalhar em cópia inativa); não apagar páginas do painel sem aprovação do dono.
