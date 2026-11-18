# Deploy do FINALZAP (Vercel + Supabase + Hotmart + n8n)

Arquitetura em produção:

| Peça | Onde roda | Papel |
|------|-----------|-------|
| Painel (React/Vite) | Vercel (estático, `frontend/`) | Login, lançamentos, orçamento, contas a pagar, admin |
| Funções `api/*` | Vercel (Node) | Webhook da Hotmart, convite, métricas da Meta, endpoints internos |
| Banco e Auth | Supabase | Tabelas em português, RLS, funções SQL |
| Conversas do WhatsApp | n8n (`n8n/finalzap-supabase.json`) | Agente de IA que registra gastos, orçamentos e contas |

## 1. Supabase

1. Crie o projeto e anote **Project URL**, **anon public key** e **service_role key** (Settings > API).
2. No **SQL Editor**, rode as migrações **nesta ordem** (todas são reexecutáveis):
   1. `supabase/migrations/20261116000001_tabelas_pt.sql`
   2. `supabase/migrations/20261116000002_funcoes_pt.sql`
   3. `supabase/migrations/20261116000003_hotmart.sql`
   4. `supabase/migrations/20261117000001_seguranca_rls.sql`
   5. `supabase/migrations/20261118000001_n8n_no_supabase.sql`
   6. `supabase/migrations/20261118000002_correcoes_qa.sql`
   7. `supabase/migrations/20261118000003_credenciais_servico.sql`
   8. `supabase/migrations/20261118000004_entradas_dashboard_admin.sql`
   9. `supabase/migrations/20261118000005_taxas_hotmart_custos_usd.sql`
   10. `supabase/migrations/20261118000006_resumo_admin_periodo.sql`

   As demais migrações em `supabase/migrations/` (2026-03) são do modelo antigo em inglês e **não** são necessárias.
3. **Authentication > URL Configuration**:
   - **Site URL:** `https://SEU-DOMINIO` (o mesmo valor de `APP_URL`).
   - **Redirect URLs:** `https://SEU-DOMINIO/definir-senha` e `https://SEU-DOMINIO/**`. Sem isso o link do convite não abre a tela de definir senha.
4. **E-mail do convite:** quem envia é o n8n, não o Supabase (o Supabase só gera o link). Importe `n8n/finalzap-email-convite.json`, conecte a credencial Gmail, defina `FINALZAP_EMAIL_SECRET` no n8n, ative o workflow e copie a URL de produção do webhook para `N8N_EMAIL_WEBHOOK_URL` (e o segredo para `N8N_EMAIL_WEBHOOK_SECRET`) na Vercel. O texto do e-mail fica no nó do Gmail.
5. **Login com Google** (botão "Continuar com Google" no painel):
   1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), em **APIs e serviços > Credenciais**, crie (ou reutilize) um **ID do cliente OAuth** do tipo **Aplicativo da Web**. Recomendado: um cliente **só para o painel**, separado do que o n8n usa.
   2. Em **URIs de redirecionamento autorizados**, adicione `https://SEU-PROJETO.supabase.co/auth/v1/callback` (o endereço de callback aparece em Supabase > Authentication > Providers > Google). Em **Origens JavaScript autorizadas**, adicione `https://SEU-DOMINIO`.
   3. Em **Tela de consentimento OAuth**, publique o app (**Em produção**). No modo "Teste" só entram os e-mails cadastrados como testadores, e os clientes ficariam de fora.
   4. No Supabase, em **Authentication > Providers > Google**, ative o provedor e cole o **Client ID** e o **Client Secret** do cliente OAuth. O secret fica **só no Supabase**: nunca no código, no `.env` do painel nem no Git (o arquivo `client_secret_….json` baixado do Google não deve ser versionado).
   5. Quem entra com o Google só vê dados se houver um perfil com o mesmo e-mail da compra na Hotmart. O sistema liga o perfil sozinho, apenas quando o e-mail do Google é verificado. Se o e-mail for outro, o painel avisa que a conta não está vinculada.
6. Crie o administrador: em **Authentication > Users > Add user**, crie o usuário com e-mail e senha forte e copie o **User UID**. Depois rode, trocando o UID e o e-mail:

   ```sql
   insert into public.perfis (auth_id, telefone, nome, email, role)
   values ('UID-DO-USUARIO', 'admin', 'Administrador', 'admin@seudominio.com', 'admin')
   on conflict (telefone) do update set auth_id = excluded.auth_id, role = 'admin';
   ```

## 2. Vercel

1. **Add New > Project** e importe o repositório. Deixe o **Root Directory** na raiz do repositório (não em `frontend/`). O `vercel.json` já define instalação, build (`cd frontend && npm install && npm run build`), saída (`frontend/dist`), reescrita de SPA e cabeçalhos de segurança.
2. Em **Settings > Environment Variables**, configure (ambiente **Production**; use também **Preview** se for testar):

   | Variável | Obrigatória | Para quê |
   |----------|:-----------:|----------|
   | `VITE_SUPABASE_URL` | sim | Painel. É lida **no build**: depois de alterar, faça redeploy |
   | `VITE_SUPABASE_ANON_KEY` | sim | Painel (chave anon pública) |
   | `SUPABASE_URL` | sim | Funções `api/*` |
   | `SUPABASE_ANON_KEY` | sim | Valida o login do usuário nas funções |
   | `SUPABASE_SERVICE_ROLE_KEY` | sim | **Segredo.** Funções do servidor. Nunca em variável `VITE_*` |
   | `APP_URL` | sim | URL pública do painel, usada no link do convite (`https://SEU-DOMINIO`) |
   | `N8N_EMAIL_WEBHOOK_URL` | sim | URL de produção do webhook do n8n que envia o e-mail do convite |
   | `N8N_EMAIL_WEBHOOK_SECRET` | sim | Segredo (header `x-webhook-secret`), igual a `FINALZAP_EMAIL_SECRET` no n8n |
   | `HOTMART_HOTTOK` | sim | Token do webhook (Hotmart > Webhook > Autenticação). Sem ele o webhook recusa tudo |
   | `META_ACCESS_TOKEN`, `META_WABA_ID` | para métricas | Aba "Tokens / Uso" do admin (consulta de custo na Graph API) |
   | `HOTMART_PRODUTO_ID` | não | Padrão `8889619`. Use `0` ou `788921` só para testar com o sandbox da Hotmart |
   | `USD_BRL`, `META_GRAPH_VERSION`, `META_TARIFAS_USD` | não | Ajustes de cotação e tarifa |
   | `META_VERIFY_TOKEN`, `META_APP_SECRET` | não | Só se o callback da Meta apontar para `api/whatsapp/meta` |
   | `BOT_SECRET_TOKEN`, `OPENAI_API_KEY` | não | Só para o endpoint interno `api/whatsapp/webhook` |
   | `ALLOWED_ORIGINS` | não | CORS dos endpoints legados (Baileys) |

   A lista completa, com comentários, está em `.env.example`. **Nunca** commite valores reais.
3. Faça o deploy e, em **Settings > Domains**, ligue o domínio.
4. **Node:** o projeto exige Node 20 ou superior (já declarado em `engines`).

## 3. Hotmart

1. **Ferramentas > Webhook (API e Notificações) > Cadastrar Webhook**, versão **2.0.0**.
2. **URL:** `https://SEU-DOMINIO/api/hotmart/webhook`. Produto: "FINALZAP by Sueli's" (ID `8889619`).
3. **Eventos:** compra aprovada, compra completa, compra atrasada, compra cancelada, reembolso, chargeback e **cancelamento de assinatura**.
4. **Autenticação:** copie o hottok para `HOTMART_HOTTOK` na Vercel.
5. Se já existir uma configuração apontando para o n8n, **desative-a** depois de validar a nova, para não duplicar convites.

Regras de acesso (plano mensal):
- Compra aprovada ou renovação: status "Ativo" até o novo vencimento.
- Cancelamento da assinatura: mantém o acesso até o fim do período já pago.
- Reembolso, chargeback ou compra cancelada: acesso bloqueado na hora.
- Sem renovação: o acesso fecha sozinho quando o vencimento passa.

## 4. n8n e WhatsApp

Siga `n8n/README.md`: importar `n8n/finalzap-supabase.json`, criar a credencial "Supabase FINALZAP" (service_role, só no n8n), preencher o `phone_number_id` e ter o template `lembrete_conta_a_pagar` aprovado (`docs/meta-template.md`).

O callback do WhatsApp na Meta é **um só por app**: hoje ele aponta para o n8n. O custo das mensagens aparece no admin pela consulta à Graph API (`META_ACCESS_TOKEN` e `META_WABA_ID`).

## 5. Checagem depois do deploy

1. `curl -i https://SEU-DOMINIO/api/hotmart/webhook` deve responder **405**. Um POST sem token deve responder **401**.
2. Abra o painel e entre com o administrador: `/admin` abre. Entre com um usuário comum: `/admin` volta para o painel.
3. Hotmart > "Enviar teste" (compra aprovada, com e-mail seu): o log da Hotmart mostra 200, nasce uma linha em `assinaturas` e `hotmart_eventos`, e o convite chega por e-mail.
4. Defina a senha pelo convite e confirme que o painel abre.
5. No WhatsApp, mande "gastei 45,90 no mercado" e confira em Transações.

## 6. Segurança

- Rotacione qualquer segredo que já tenha passado pelo Git (secret do Pluggy, senha do banco, secret do bot).
- A chave `service_role` fica só na Vercel e no n8n.
- Mantenha as variáveis fora do repositório: `.env`, `.env.local` e `*.env` estão no `.gitignore`.
- O modo de autenticação de teste (`ALLOW_DEV_MOCK_AUTH`) só vale com `NODE_ENV=development`: não defina em produção.

## 7. Legado (não evoluir)

`bot-server/` (Baileys/QR code) é do canal antigo e fica fora do deploy. Os endpoints `api/whatsapp/instances/*` já foram removidos.
