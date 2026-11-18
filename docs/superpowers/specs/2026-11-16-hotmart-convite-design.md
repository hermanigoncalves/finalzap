# Hotmart → assinatura → convite por e-mail (FINALZAP): desenho

Data: 2026-11-16. Status: **aguardando aprovação**.

## Intenção e porquê

O FINALZAP é um SaaS por assinatura, multi-cliente. Hoje não existe ligação entre quem **paga** (Hotmart) e quem **entra** (app). A dona quer que: (1) ao pagar, o cliente receba **sozinho** um e-mail com o link para criar usuário e senha; (2) o admin possa **reenviar** esse convite, mas só se a assinatura estiver válida; (3) o banco reflita a situação da assinatura na Hotmart (ativa, atrasada, cancelada).

Fatos levantados (não suposições):
- Produto Hotmart: **FINALZAP by Sueli's**, ID `8889619`, **R$ 19,90/mês, recorrente** (confirmado pela dona e pelo checkout).
- O checkout pede: e-mail (com confirmação), nome completo, CPF/CNPJ e **celular (+55)**. O telefone vem junto com a compra.
- Ainda não há vendas, então tudo pode ser testado com o modo de teste do webhook da Hotmart, sem cobrança.
- A conta Hotmart aberta é de colaborador, com poucas permissões; a permissão **"Webhook (API e Notificações)"** precisa existir para quem configurar.
- A tabela `assinaturas` já tem `hotmart_id`, `status` (Ativo, Inativo, Cancelado, Inadimplente), `data_vencimento`, `telefone`. `perfis` tem `auth_id`, `telefone` (único), `role`.

## Objetivos

1. Compra aprovada → assinatura **Ativa** + convite por e-mail + perfil criado, sem ação humana.
2. Renovação → vencimento avança. Atraso → **Inadimplente**. Cancelamento, reembolso, chargeback → **Cancelado**.
3. Admin reenvia o convite pelo painel; o sistema só envia se a assinatura estiver Ativa e dentro do vencimento, e diz o motivo se recusar.
4. O mesmo evento da Hotmart chegando duas vezes **não** duplica cliente, assinatura nem e-mail.

## Não objetivos

- Vários produtos ou planos (só o `8889619` por enquanto).
- Emissão de nota fiscal, cobrança própria, reembolso feito pelo painel.
- Telas de indicadores do admin e lista de clientes (outro plano).
- Recuperação de senha em geral (fora o caso do item de reenvio abaixo).

## Anti-objetivos (seria falha mesmo que "funcionasse")

- Qualquer pessoa conseguir chamar o webhook e liberar acesso sem pagar.
- A chave de serviço do Supabase aparecer no navegador.
- O cliente pagar e não receber nada, sem que ninguém perceba.
- Um cliente cancelado continuar com acesso, ou um cliente em dia ficar bloqueado.

## Abordagens consideradas

- **A. Funções da Vercel (`api/`)**: escolhida (decisão de projeto: dona não escolheu; foi a recomendação). Mesmo deploy, mesmo TypeScript, testável com os testes que já existem.
- **B. Supabase Edge Functions**: chave de serviço mais perto do banco, mas outro ambiente (Deno) e outro deploy.
- **C. n8n**: rápido, mas difícil de versionar e testar; a regra de "assinatura válida" ficaria espalhada.

## Desenho (abordagem A)

**Fluxo da compra**
1. Hotmart chama `POST /api/hotmart/webhook` com o cabeçalho `X-HOTMART-HOTTOK`.
2. O servidor compara o token com `HOTMART_HOTTOK` (comparação de tempo constante). Diferente → 401, nada é gravado.
3. Confere que o produto é o `8889619`; outro produto → 200 e ignora.
4. Registra o evento em `hotmart_eventos` (chave única: transação + tipo de evento). Se já existe → 200 sem refazer (idempotência).
5. Atualiza `assinaturas` (upsert pelo código do assinante/transação da Hotmart) com o status e o vencimento do evento.
6. Se o evento é de **compra aprovada** e ainda não houve convite: cria o usuário e envia o e-mail com `inviteUserByEmail`, e grava o perfil (`role = 'user'`, telefone normalizado em dígitos com DDI, ex.: `5511999999999`).
7. Resposta 200. Se o envio do e-mail falhar, registra o erro em `assinaturas.convite_erro` e responde 500, para a Hotmart tentar de novo.

**Eventos e efeito** (nomes a conferir na documentação da Hotmart na hora de construir)

| Evento | Efeito |
|---|---|
| compra aprovada / concluída | Ativo; vencimento = próxima cobrança; envia convite (só na primeira vez) |
| renovação (nova cobrança aprovada) | Ativo; avança o vencimento; **não** reenvia convite |
| compra atrasada | Inadimplente |
| cancelamento da assinatura, reembolso, chargeback | Cancelado |

**Vencimento:** usar a data da próxima cobrança que a Hotmart envia; se não vier, aprovação + 1 mês (decisão minha, ajustável). Tolerância de alguns dias antes de bloquear, valor a definir pela dona.

**Reenvio pelo admin:** `POST /api/admin/reenviar-convite` com o login do admin.
- Valida o token do usuário e confere no banco (com chave de serviço) que `perfis.role = 'admin'`. Não existe "token demo" neste caminho.
- Recusa (409, com motivo) se a assinatura não estiver Ativa ou estiver vencida.
- Se o cliente **ainda não** criou a senha: reenvia o convite. Se **já** criou (decisão minha): envia o e-mail de **redefinição de senha**, porque convite repetido não funciona para quem já tem conta.
- Registra quem reenviou e quando.

**Front (parte do cliente):** página `/definir-senha`, que recebe o link do e-mail, deixa o cliente definir a senha e o leva ao app. Se o telefone da compra estiver inválido ou vazio, a tela de completar perfil (Tarefa 3 do plano do front) pede o número no primeiro acesso.

**Front (parte do admin):** botão "Reenviar convite" na linha de cada assinatura, com mensagem do motivo quando for recusado.

**Banco (migração):** tabela `hotmart_eventos` (idempotência e auditoria); colunas em `assinaturas`: código do assinante Hotmart (único), `convite_enviado_em`, `convite_erro`; e-mail/nome do comprador já existem.

**Segredos (nunca no código):** `HOTMART_HOTTOK`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, URL pública do app. Ficam nas variáveis de ambiente da Vercel.

## Restrições

- E-mail em volume exige **SMTP próprio** (ex.: Resend) configurado no painel do Supabase; o envio padrão tem limite baixo por hora.
- Configurar no Supabase a **URL do site** e as URLs de retorno permitidas, para o link do convite abrir o app.
- O telefone é normalizado em um único lugar (só dígitos, com DDI 55).
- As policies do banco hoje isolam cliente por telefone e **não** dão ao admin leitura de todos; isso é tratado no plano do banco, que este desenho depende.
- Mantém o que o projeto já usa: TypeScript, testes `node --test`.

## Fica para o construtor (decisões dele, sem mudar o que é entregue)

- Estrutura exata dos arquivos (sugestão: `api/hotmart/webhook.ts`, `api/admin/reenviar-convite.ts`, `lib/hotmart/` para ler o corpo e mapear evento→status, `lib/admin/` para checar admin).
- Formato exato do corpo do webhook da Hotmart (confirmar com o botão de teste).
- Texto do e-mail em português (modelo do Supabase).
- Como organizar os testes (ler o corpo, mapear evento, idempotência, recusa de reenvio).

## O que a dona precisa fazer fora do código

1. Ter a permissão de **Webhook** na Hotmart (ou a Sueli configurar).
2. Criar o webhook na Hotmart apontando para `https://<app>/api/hotmart/webhook` e copiar o **hottok** direto para a Vercel (não colar no chat).
3. Configurar o SMTP (Resend) e as URLs de retorno no Supabase.
4. Testar com o botão de teste do webhook antes da primeira venda real.

## Riscos conhecidos

- Se o checkout deixar o celular em branco, o cliente entra, mas o agente do WhatsApp não o reconhece até ele informar o número.
- Eventos fora de ordem (cancelamento chegando antes da aprovação): o servidor ignora um evento mais antigo que o último registrado para aquela assinatura.
