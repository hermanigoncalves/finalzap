# Agente de Compromissos no Mesmo Número do WhatsApp

**Status:** entregue

## Problema

Hoje o número oficial do FINALZAP no WhatsApp atende apenas finanças (12 ferramentas). O usuário precisa agendar, consultar, remarcar e cancelar compromissos pessoais usando o mesmo número (texto e áudio) e visualizar/gerenciar sua agenda no painel web, sem inflar o prompt financeiro nem quebrar pedidos mistos na mesma mensagem.

## Comportamento esperado

- [ ] CA1: Dado um usuário com assinatura ativa, quando envia texto ou áudio pedindo agendamento, consulta, remarcação ou cancelamento, então o `Assistente FINALZAP` delega via `gerenciar_agenda` ao sub-workflow dedicado (`Agente de Agenda`). Número sem assinatura recebe apenas o convite Hotmart.
- [ ] CA2: Dado um pedido misto (finanças + compromisso na mesma mensagem), quando processado pelo número oficial, então ambos os fluxos executam sem gravar compromissos em `movimentacoes`/`contas_a_pagar` nem alterar a tabela errada.
- [ ] CA3: Dado um agendamento sem horário de término informado, quando validado em `America/Sao_Paulo`, então aplica duração padrão de 60 minutos (`fim > inicio`) sem virar o dia por UTC após as 21h. Data sem hora faz o agente perguntar antes de gravar.
- [ ] CA4: Dado um horário que sobrepõe outro compromisso `agendado` do mesmo telefone, quando tentar agendar ou remarcar, então o banco e o painel bloqueiam por padrão (`CONFLITO_HORARIO`) e só gravam após confirmação explícita (`permitir_conflito = true`). Horários adjacentes (ex.: 14h–15h e 15h–16h), cancelados/concluídos e o próprio compromisso ao remarcar não geram conflito.
- [ ] CA5: Dado pedido de remarcar ou cancelar, quando houver ambiguidade (2+ candidatos), então o agente consulta primeiro e pergunta qual compromisso alterar; na gravação usa `id` + filtro do próprio telefone + `status = agendado`.
- [ ] CA6: Dado reentrega de webhook da Meta com mesmo `message_id`, quando `agendar_compromisso` rodar novamente, então `idempotency_key` (`wa:<message_id>:<hash>`) impede duplicação sem bloquear múltiplos agendamentos criados pelo painel (`NULL`).
- [ ] CA7: Dado usuário autenticado no painel web em `/agenda`, quando cria, filtra, remarca, conclui ou cancela compromissos, então a RLS garante isolamento por telefone e exibe alerta explícito em caso de conflito.

## Regras

Novas em `docs/regras.md`: `R-001`, `R-002`, `R-003`, `R-004`, `R-005`, `R-006`, `R-007`.

**Interações com regras existentes**:
- **Assinatura ativa (`R-001`)**: mesma regra do fluxo financeiro (`Ativo` com vencimento nulo/futuro ou `Cancelado` dentro do período pago).
- **Telefone 12 vs 13 dígitos (`R-002`)**: triggers canonizam para 13 dígitos na gravação; leituras/filtros no n8n usam `telefone=in.(13 dígitos, 12 dígitos)`.
- **Finanças + Agenda juntos (`R-003`)**: compromisso nunca gera lançamento financeiro nem conta a pagar; áudios seguem pelo mesmo pipeline após transcrição (`R-007`).
- **Remarcar sem autoconflito (`R-005` + `R-006`)**: `tr_compromissos_conflito` usa `id IS DISTINCT FROM NEW.id` e `status = 'agendado'`.

## Fora do escopo

- Lembretes proativos de compromissos via template Meta + cron por horário (fase 2 sobre `public.compromissos`).
- Compromissos recorrentes e sincronização bidirecional com Google Calendar.

## Evidência esperada

- Testes `[R-001]` a `[R-007]` em `tests/agenda.test.ts` (regras puras + Postgres/RLS real em PGlite + estrutura n8n) verdes em `npm run verificar`.
- Nova página `/agenda` listando, filtrando, criando/remarcando (com alerta de conflito e confirmação explícita), concluindo e cancelando compromissos no painel web.
