# Regras do produto

Cada regra tem um ID. **Toda regra precisa de pelo menos um teste ou lint que cite o ID**,
senão `npm run regras` falha. Regra sem checagem é só prosa, e o agente pode ignorar prosa.

Para criar uma regra: adicione aqui como `### R-001 Título`, escreva o teste com `[R-001]`
no nome e só então implemente.

## Negócio

### R-001 Agenda exige assinatura ativa do FINALZAP

O atendimento de compromissos usa a mesma trava de assinatura ativa do fluxo financeiro (`Ativo` com vencimento nulo ou futuro, ou `Cancelado` dentro do período pago). Número sem assinatura recebe apenas o convite da Hotmart e não alcança a ferramenta `gerenciar_agenda`.

### R-002 Telefone vem sempre do webhook e é isolado por dono

`gerenciar_agenda` e as ferramentas de compromissos recebem `telefone` e `telefone_alt` do fluxo do webhook (nunca do modelo). A tabela `public.compromissos` canoniza o telefone no banco (`tr_canoniza_telefone`) e restringe leitura/escrita pela RLS `telefone = (SELECT public.telefone_do_usuario())`.

### R-003 Pedidos mistos finanças e agenda funcionam na mesma mensagem sem cruzar tabelas

O `Assistente FINALZAP` mantém `registrar_movimentacao` e `gerenciar_agenda` no mesmo número para atender mensagens mistas; criar ou alterar compromissos nunca insere registros em `movimentacoes` nem em `contas_a_pagar`.

### R-004 Horários sempre em America/Sao_Paulo, fim maior que início e duração padrão de 60 minutos

Horários são tratados em `America/Sao_Paulo` (`-03:00`) sem virada de data por UTC após 21h. Sem horário de término informado, assume 60 minutos; data sem hora exige pergunta antes de gravar e o banco/código exigem `fim > inicio`.

### R-005 Conflito de horário bloqueia por padrão e exige confirmação explícita

Sobreposição (`inicio < outro.fim` e `fim > outro.inicio`) entre compromissos com `status = 'agendado'` do mesmo telefone é bloqueada por padrão (`CONFLITO_HORARIO`), ignorando cancelados, concluídos, o próprio `id` na remarcação e horários adjacentes. Só grava com `permitir_conflito = true` após confirmação explícita do usuário.

### R-006 Remarcar e cancelar exigem identificação segura do compromisso do próprio usuário

Remarcar ou cancelar exige consulta prévia, pergunta em caso de ambiguidade (2+ candidatos) e filtro com `id`, `telefone` do próprio usuário e `status = 'agendado'`.

### R-007 Agendamento via WhatsApp é idempotente e suporta texto e áudio

Mensagens de áudio transcritas seguem para o mesmo agente de agenda que mensagens de texto, e `agendar_compromisso` grava `idempotency_key` prefixada por `wa:<message_id>:` para impedir duplicação em reenvios da Meta sem restringir agendamentos feitos pelo painel (`NULL`).

### R-008 Cancelamento de assinatura pelo WhatsApp efetiva na Hotmart antes de confirmar

O cancelamento de assinatura pelo WhatsApp usa o sub-workflow dedicado (`cancelar_assinatura`) com `telefone` e `telefone_alt` vindos exclusivamente do webhook (`R-002`), exige confirmação explícita em 2 etapas (`confirmacao_explicita = true`), chama `POST /payments/api/v1/subscriptions/{subscriber_code}/cancel` na Hotmart (`send_mail: true`) com credencial dedicada (sem segredos no JSON) e só atualiza `assinaturas.status = 'Cancelado'` (preservando `data_vencimento` e `ultimo_evento_em`) e confirma sucesso ao cliente após a Hotmart confirmar efetivação.

## Arquitetura
