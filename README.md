# FINALZAP

Assistente financeiro pelo WhatsApp com painel web. O cliente registra gastos, receitas, orçamentos e contas a pagar conversando com um agente de IA no WhatsApp, e acompanha tudo no painel. O acesso é vendido como assinatura mensal pela Hotmart.

## Como funciona

| Peça | Onde | O que faz |
|------|------|-----------|
| Painel | `frontend/` (React, TypeScript, Vite) | Login, visão geral, transações, contas a pagar, orçamento, dicas, configurações e área admin |
| Funções serverless | `api/` e `lib/` (Vercel, Node) | Webhook da Hotmart (assinaturas e convite), reenvio de convite, métricas de custo da Meta |
| Banco e Auth | `supabase/` | Tabelas em português, RLS e funções SQL (`telefone` identifica o cliente) |
| Conversas | `n8n/` | Fluxo do agente de IA no WhatsApp, com lembrete diário de contas a pagar |

Acesso (plano mensal): o cliente tem acesso até o fim do período pago. Sem renovação, o acesso fecha sozinho; reembolso e chargeback bloqueiam na hora.

## Comandos

```bash
npm run dev     # painel em desenvolvimento
npm run build   # build do painel
npm test        # testes (Node)
```

Dentro de `frontend/`: `npm run lint` e `npx tsc -b`.

## Configuração

- Copie `frontend/.env.example` para `frontend/.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
- As variáveis das funções (`api/`) estão em `.env.example`, com o que é obrigatório e o que é opcional. Configure-as no painel da Vercel, nunca em arquivo versionado.
- A chave `service_role` do Supabase nunca vai em variável `VITE_*`.

## Publicação

Veja **[DEPLOY.md](DEPLOY.md)**: migrações do Supabase, variáveis da Vercel, webhook da Hotmart, n8n e checagem pós-deploy. O fluxo do WhatsApp está em [n8n/README.md](n8n/README.md).

## Código legado

`bot-server/` (Baileys/QR code) pertence ao canal antigo. Não evoluir. Os endpoints `api/whatsapp/instances/*` foram removidos. O canal oficial é a API da Meta tratada pelo n8n.
