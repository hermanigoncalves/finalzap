# Fluxo n8n do FINALZAP (Supabase, nós nativos)

Arquivo: `finalzap-supabase.json` (36 nós). Usa só o nó nativo **Supabase** (6 nós) e **Supabase Tool** (10 ferramentas do agente): nenhum Data Table e nenhum HTTP Request para o Supabase (o único HTTP Request baixa o áudio da Meta). Sem segredos no arquivo. O `finalzap-original.json` é só referência.

O nó Supabase só faz create/get/getAll/update/delete em tabelas e views (sem RPC, sem upsert). Por isso a regra de negócio fica no banco, na migração `supabase/migrations/20261118000001_n8n_no_supabase.sql`: trigger que canoniza o telefone no INSERT, trigger que lança a despesa quando a conta vira `paga`, e views `vw_saldo` e `vw_resumo_mensal`. **Aplique essa migração (e as anteriores) antes de testar.**

## Pré-requisitos
1. Migrações `20261116000001..03`, `20261117000001` e `20261118000001` aplicadas.
2. Template Meta `lembrete_conta_a_pagar` (pt_BR, Utilidade) aprovado: ver `docs/meta-template.md`.
3. Credenciais já existentes no n8n: `WhatsApp account`, `WhatsApp OAuth account`, OpenAI.

## Importação
1. n8n: Workflows > Import from File > `finalzap-supabase.json` (ou use a cópia inativa "FINALZAP - Supabase" já criada no n8n cloud).
2. Crie a credencial **"Supabase FINALZAP"** (tipo *Supabase API*): Host = `https://<ref>.supabase.co`, Service Role Secret = chave `service_role` (só no n8n, nunca no repositório).
3. Selecione "Supabase FINALZAP" em todos os 16 nós Supabase: `Buscar assinatura`, `Contas a lembrar`, `Assinaturas ativas`, `Perfis`, `Marcar lembrete enviado`, `Registrar log do lembrete` e as 10 ferramentas (`registrar_movimentacao`, `consultar_movimentacoes`, `saldo_total`, `resumo_mensal`, `consultar_orcamentos`, `salvar_orcamento`, `atualizar_orcamento`, `cadastrar_conta_a_pagar`, `consultar_contas_a_pagar`, `marcar_conta_como_paga`).
4. No nó **Config lembrete** preencha `phone_number_id` (ID do número no WhatsApp Manager). Nas conversas o `phone_number_id` vem do próprio webhook. A URL do Supabase vem da credencial.
5. Confira a credencial OpenAI e o fuso do workflow (`America/Sao_Paulo`, já definido). Teste e só então ative.

## O que o fluxo faz
- **Mensagem**: ignora eventos de status (exige `messages[0].id`) > nó Code normaliza o telefone (regra de `normalizar_telefone_br`) > `getAll assinaturas` (status Ativo ou Cancelado) > Code: ativa se Ativo com `data_vencimento` nula ou futura, ou Cancelado ainda dentro do período pago (vencimento futuro). Sem renovação, o acesso fecha sozinho no vencimento > texto, áudio (transcrição) ou aviso de tipo não suportado > agente > resposta. Sem assinatura: convite Hotmart. Erros (assinatura, áudio, agente) respondem mensagem de instabilidade.
- **Telefone** sempre do remetente do webhook, nunca do modelo. Leituras filtram por `telefone=in.(13 dígitos, 12 dígitos)` para cobrir cadastros antigos sem o 9; gravações usam o canônico e o trigger do banco reforça.
- **Ferramentas**: registrar (create em `movimentacoes`, `fonte=whatsapp`, `data` em America/Sao_Paulo, `idempotency_key = wa:<id da mensagem>:<hash>`; chave duplicada = já registrado, e o prompt instrui o agente); consultar movimentações (getAll, mês ou 30 mais recentes por data desc); saldo (`vw_saldo`); resumo (`vw_resumo_mensal` com `mes`); orçamentos (`consultar_orcamentos` + `salvar_orcamento` create / `atualizar_orcamento` update com `mes IS NULL`; o agente consulta antes e escolhe criar ou atualizar, e cruza com o gasto do resumo); contas (create `pendente`, getAll pendentes por vencimento, update `status=paga` por id + telefone, o banco cria a despesa).
- **8h** (America/Sao_Paulo): getAll de contas pendentes (vence de hoje a hoje+3 e não lembrada hoje, ou vencida e nunca lembrada) > getAll `assinaturas` Ativo > getAll `perfis` (nome) > Code agrupa e filtra por assinatura ativa > template Meta > update `lembrete_enviado_em` > create em `logs_lembrete`, só para envios com sucesso.

## Roteiro de testes manuais
1. Evento de status (entrega) da Meta: nada acontece.
2. Número sem assinatura: recebe o convite. Com assinatura `Ativo`: segue.
3. "gastei 45,90 no mercado": registra despesa Alimentação; reenviar o mesmo evento não duplica (erro de chave duplicada tratado como "já registrado").
4. "recebi 3000 de salário", "qual meu saldo?", "resumo do mês", "movimentações de novembro", "minhas últimas movimentações".
5. "orçamento de 800 para lazer" (cria), repetir com 900 (atualiza), "como estou nos orçamentos?".
6. "gastei 20 dólares": recusa sem perguntar a moeda.
7. "conta de luz 189,90 vence dia 20", "quais contas tenho?", "paguei a conta de luz": conta `paga` e uma despesa criada pelo banco (confira que não há duas).
8. Áudio com uma despesa; figurinha/imagem: resposta de tipo não suportado.
9. Lembrete: conta pendente vencendo hoje/amanhã no seu telefone; execute o ramo "Todo dia às 8h" (envia template real: só para o seu número) e confira `lembrete_enviado_em` e `logs_lembrete`.
10. Número com e sem o 9º dígito resolve o mesmo usuário.
11. Vínculo por código (compra sem telefone): entre no painel com um e-mail que tenha assinatura mas nenhum perfil, copie o código `FZ-XXXXXXXX` da tela e envie-o do seu WhatsApp; o bot responde "WhatsApp vinculado" e a tela do painel avança sozinha. No nó **Vincular WhatsApp (RPC)** troque `SEU-PROJETO` pela URL do seu projeto Supabase.

## Limitações conhecidas
- Os parâmetros dos nós Supabase (`filterType: string` com `filterString` PostgREST, `fieldsUi`) e `components` do envio de template devem ser validados na primeira execução; o n8n não os valida na importação.
- Orçamento por mês específico não é suportado pelas ferramentas (só orçamento para todos os meses).
- Reentrega do webhook da Meta com o mesmo id pode duplicar a resposta no WhatsApp (a gravação não duplica).
- `Perfis` e `Assinaturas ativas` são lidos inteiros no lembrete das 8h: ok para poucos milhares de usuários.
