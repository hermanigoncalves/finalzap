# Auditoria de Segurança de Dados e Privacidade (LGPD) — FINALZAP (`WhatsApp-Fin`) — 2026-11-24

**Veredito:** `NO-GO`  
**Escopo auditado:** `WhatsApp-Fin/` (`api/`, `lib/`, `bot-server/`, `frontend/`, `n8n/`, `supabase/`, `scripts/`, `tests/`, `vercel.json`, `.github/`, `.env*`), raiz do workspace (`create_admin.sql`, `vincular_admin.sql`, `finalzap-supabase.backup-20261119.json`, `.mcp.json`, `testsprite_tests/`) e checagem de segredos em `_arquivo_legado/`.  
**Método:** Auditoria independente somente leitura (8 frentes), varredura estática com saída redigida, `npm audit --omit=dev` e verificação direta linha a linha. Nenhum segredo completo ou PII completa é exposto neste relatório.

**Resumo Executivo:**  
Desde a auditoria de [2026-11-16](./2026-11-16-seguranca.md), o projeto avançou de forma sólida na remoção de chaves `service_role`/Pluggy/bot do código, exclusão de `demo-token`, criação de endpoints server-side admin com `timingSafeEqual`, vínculo do WhatsApp por código único (`vinculos_whatsapp`) e RLS baseada em `auth.uid()`. Contudo, o veredito segue **NO-GO** devido a **2 achados Críticos** e **8 Altos**: (1) PII real de cliente e do proprietário exposta em arquivos versionados/locais do repositório; (2) workflows n8n legados sem autenticação e com injeção PostgREST permanecendo em `n8n/`; (3) falha de normalização de DDI (`length 10|11 -> +55`) que permite colisão cross-tenant via número estrangeiro no WhatsApp; (4) acesso web e RLS sem trava de assinatura ativa após reembolso/chargeback; (5) tomada de senha em `/definir-senha` ou perfil `admin` órfão; (6) segredos externos em texto claro em `credenciais_servico` e conformidade LGPD incompleta.

---

## 1. Inventário de Dados Sensíveis & Superfície LGPD

| Tipo de Dado / Credencial | Onde Fica Armazenado / Processado | Proteção Atual Observada | Risco Principal |
|---|---|---|---|
| **Segredos externos da operação** (`OPENAI_ADMIN_KEY`, `META_ACCESS_TOKEN`, `META_WABA_ID`) | `public.credenciais_servico.valor` (`TEXT`), lido/gravado via `api/admin/credenciais.ts` | RLS ativa sem policy + `REVOKE ALL` de `anon`/`authenticated`; UI recebe só sufixo de 4 chars | **Texto claro no banco** (não usa `supabase_vault` ou envelope encryption) — `[DSEC-05]` |
| **Chaves de infraestrutura** (`SUPABASE_SERVICE_ROLE_KEY`, `HOTMART_HOTTOK`, `BOT_SECRET_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `OPENAI_API_KEY`, `N8N_EMAIL_WEBHOOK_SECRET`) | Variáveis de ambiente servidor; `frontend/.env.local` contém apenas URL e `anon` JWT | Ausentes do código ativo; checagens server-side fail-closed com `timingSafeEqual` | Histórico Git ainda guarda commits antigos pré-16/11 (necessita confirmação de rotação); fallback `ALLOW_DEV_MOCK_AUTH` em `jwtAuth.ts` |
| **Chaves Baileys / QR Code (legado)** | `public.whatsapp_sessions.data` e `whatsapp_instances` | `whatsapp_sessions` com RLS sem policy + `REVOKE ALL` | Texto claro no banco; policies antigas em `whatsapp_instances` e `DELETE /instance/:id` no `bot-server` sem checar dono (`[DSEC-09]`, `[DSEC-19]`) |
| **PII real exposta em repositório** (nome completo, e-mail pessoal, telefone celular real, `wa_id`) | `supabase/conferir_simone.sql`, `supabase/criar_assinatura_simone.sql`, `n8n/finalzap-original.json` | Nenhuma (texto claro; `finalzap-original.json` rastreado no Git) | Exposição direta de PII e violação LGPD (Art. 46) — `[DSEC-01]` |
| **PII cadastral & Hotmart** (`nome`, `email`, `telefone`, `auth_id`, `role`, `hotmart_eventos.payload` com objeto `buyer`/documento) | `perfis`, `assinaturas`, `hotmart_eventos`, `vinculos_whatsapp`, `uso_servico`, `logs_lembrete` | RLS ativa em todas; `perfis` restringe `UPDATE (nome, email)`; `hotmart_eventos` só `service_role` | Sem retenção/TTL nem mascaramento em `hotmart_eventos.payload`; sem mecanismo de exclusão LGPD; `ON DELETE SET NULL` deixa `perfis` órfãos (`[DSEC-06]`, `[DSEC-07]`) |
| **Dados financeiros e agenda pessoal** (`movimentacoes`, `contas_a_pagar`, `orcamentos`, `lancamentos_recorrentes`, `compromissos`, `entradas`, `custos_fixos`) | Supabase Postgres, tráfego para OpenAI (texto/áudio/descrições) e `localStorage['finance-store']` | RLS `telefone = telefone_do_usuario()`; `transactions`/`fixedTransactions` removidos do `localStorage` | Acesso permanece liberado no painel após reembolso/cancelamento (`[DSEC-04]`); colisão DDI (`[DSEC-03]`); `localStorage` residual ao expirar sessão (`[DSEC-12]`) |
| **Tokens de sessão no cliente e avatars** | `localStorage` (Supabase Auth `persistSession: true`); bucket Storage `avatars` | Ausência de XSS/Open Redirect no React | Falta CSP/HSTS em `vercel.json` (`[DSEC-11]`); listagem anônima e upload irrestrito em `avatars` (`[DSEC-10]`) |

---

## 2. Achados Consolidados

### 🔴 Críticas

#### [DSEC-01] Exposição de PII real de cliente e do proprietário em texto claro no repositório
- **Localização:** `WhatsApp-Fin/supabase/conferir_simone.sql:6-8,17-20`, `WhatsApp-Fin/supabase/criar_assinatura_simone.sql:1,7-9,33`, `WhatsApp-Fin/n8n/finalzap-original.json:1`
- **Evidência redigida:**
  - `conferir_simone.sql` e `criar_assinatura_simone.sql` (não rastreados no Git, mas presentes no workspace) trazem nome completo real (`Simo***`), e-mail pessoal (`marq***`) e celular (`5533***`) de cliente.
  - `n8n/finalzap-original.json:1` (rastreado pelo Git) contém `pinData` de execução real da Meta Cloud API (`wa_id`/`recipient_id` `5533***`, `user_id` `BR.19***`, `wamid` `wami***`, `phone_number_id` `1426***`) e `shared` com nome completo e e-mail pessoal do proprietário (`Herm*** <herm***@***>`).
- **Impacto / Exploração:** Violação direta de confidencialidade e minimização LGPD (Arts. 6º e 46), além de facilitar engenharia social e phishing direcionado contra cliente e administrador caso o repositório seja acessado ou clonado.
- **Correção recomendada:** Excluir `conferir_simone.sql` e `criar_assinatura_simone.sql` (substituindo por rotina administrativa sem dados fixos); limpar `pinData`, `shared` e IDs internos de `n8n/finalzap-original.json` (ou removê-lo) e avaliar limpeza do histórico Git (`git filter-repo`).

#### [DSEC-02] Workflows n8n legados sem autenticação, correspondência parcial (`like.%...%`), injeção PostgREST e SSRF/Path Traversal permanecem no repositório
- **Localização:** `WhatsApp-Fin/n8n/whatsapp-fin-ai-agent.json:15-22,32-42,57,122,180,222`, `WhatsApp-Fin/n8n/whatsapp-fin-alertas.json:23-35,48-63,78`
- **Evidência redigida:** Ambos os JSONs rastreados mantêm webhooks `whatsapp-fin` e `whatsapp-incoming` sem `headerAuth` nem validação de assinatura, `responseMode: "lastNode"`, filtro `=phone=like.%{{ $json.phone }}%` sobre `profiles` via `service_role` sem checar `phone` vazio ou normalizar dígitos, ausência de trava de assinatura (`R-001`), interpolação direta de `body.instance` em URL autenticada à Evolution API (`:122,180`) e interpolação JSON sem `JSON.stringify` (`:222`). *(Nota: `finalzap-supabase.json` é o fluxo oficial atual, mas estes dois arquivos seguem versionados.)*
- **Impacto / Exploração:** Se qualquer um dos dois fluxos permanecer ativo/publicado na instância n8n, um `POST /webhook/whatsapp-incoming` com `key.remoteJid: ""` gera `phone=like.%%` e casa o **1º perfil do banco**, permitindo leitura de saldo, criação de lançamentos em nome de terceiros, injeção de filtro PostgREST e abuso de `OPENAI_API_KEY`/`EVOLUTION_API_KEY`.
- **Correção recomendada:** Confirmar que ambos estão despublicados/removidos no n8n Cloud e excluí-los do repositório (ou aplicar `headerAuth`, `eq.` com dígitos estritos e checagem de `assinaturas`).

---

### 🟡 Altas

#### [DSEC-03] Colisão cross-tenant por normalização de números internacionais de 10–11 dígitos como DDI `55`
- **Localização:** `WhatsApp-Fin/n8n/finalzap-supabase.json:65` (e `finalzap-supabase-PRONTO.json:65`), `WhatsApp-Fin/supabase/migrations/20261116000001_tabelas_pt.sql:41-50`, `WhatsApp-Fin/lib/hotmart/telefone.ts:8-14`
- **Evidência redigida:** Em `Normalizar mensagem` (`finalzap-supabase.json:65`), o campo `messages[0].from` da Meta (que já chega em E.164 com DDI) passa por `if (d.length === 10 || d.length === 11) d = '55' + d;`, regra espelhada em `normalizar_telefone_br()`.
- **Impacto / Exploração:** Um número estrangeiro cujo E.164 tenha 11 dígitos — como EUA/Canadá (`+1...` → `551...`, colidindo com DDDs 11–19/SP) ou Rússia (`+7 9...` → `5579...`, colidindo com DDD 79/SE) — é convertido em número brasileiro `55...`. Se coincidir com um assinante brasileiro, o remetente estrangeiro passa no gate `Buscar assinatura` e lê/modifica as finanças e a agenda da vítima via WhatsApp.
- **Correção recomendada:** Na entrada E.164 do webhook Meta (`Normalizar mensagem`), **nunca** antepor `55`: aceitar somente números que já comecem com `55` (`12` ou `13` dígitos) e rejeitar DDIs estrangeiros antes de consultar `assinaturas`.

#### [DSEC-04] Painel Web e RLS não verificam assinatura ativa, mantendo acesso após reembolso, chargeback ou vencimento
- **Localização:** `WhatsApp-Fin/frontend/src/App.tsx:61-94,106-121`, `WhatsApp-Fin/supabase/migrations/20261117000001_seguranca_rls.sql:102-108`, `WhatsApp-Fin/supabase/migrations/20261123000001_compromissos.sql:83-86`, `WhatsApp-Fin/lib/hotmart/processar.ts:111-133`
- **Evidência redigida:** `AuthGate` libera todo o painel apenas com sessão autenticada + existência de linha em `perfis`. As policies RLS de `movimentacoes`, `orcamentos`, `contas_a_pagar`, `lancamentos_recorrentes` e `compromissos` conferem apenas `telefone = telefone_do_usuario()`, sem validar `verificar_assinatura_ativa(...)`. Em `PURCHASE_REFUNDED`/`CHARGEBACK`, a Hotmart muda `assinaturas.status` para `'Inativo'` mas não remove `perfis`.
- **Impacto / Exploração:** Um cliente que recebe reembolso/chargeback ou deixa o plano vencer é bloqueado no WhatsApp (`R-001`), mas continua lendo, criando e editando dados no painel web e na API REST do Supabase indefinidamente.
- **Correção recomendada:** Bloquear acesso no `AuthGate` quando `assinaturas` estiver `Inativo`/`Inadimplente`/vencida e refletir a regra de assinatura ativa na RLS (ou policy de escrita/leitura conforme política comercial).

#### [DSEC-05] Segredos administrativos armazenados em texto claro em `credenciais_servico` (e chaves Baileys em `whatsapp_sessions`)
- **Localização:** `WhatsApp-Fin/supabase/migrations/20261118000003_credenciais_servico.sql:3-10`, `WhatsApp-Fin/api/admin/credenciais.ts:23-35`, `WhatsApp-Fin/lib/admin/credenciais.ts:9-12`, `WhatsApp-Fin/bot-server/supabaseAuth.ts:35-44`
- **Evidência redigida:** `OPENAI_ADMIN_KEY`, `META_ACCESS_TOKEN` e `META_WABA_ID` são gravados em `public.credenciais_servico.valor` (`TEXT`) em texto claro, sem criptografia na aplicação nem uso do `supabase_vault` (embora `docs/banco-estado-atual.md:3` registre `pgcrypto` e `supabase_vault` ativos no projeto). O mesmo ocorre com `whatsapp_sessions.data` (credenciais Baileys). Ambas possuem RLS sem policy e `REVOKE ALL` de `anon`/`authenticated`.
- **Impacto / Exploração:** Acesso a backups SQL, vazamento de `service_role` (inclusive a credencial usada no n8n) ou leitura privilegiada no Studio expõe diretamente a chave admin da OpenAI e o token permanente do WhatsApp Business.
- **Correção recomendada:** Migrar `credenciais_servico` para `supabase_vault` (`vault.secrets`) acessado por RPC restrita a `service_role`, ou aplicar envelope encryption AES-256-GCM com chave mestra exclusiva em variável de ambiente da Vercel; limpar `whatsapp_sessions` se o canal Baileys estiver desativado.

#### [DSEC-06] Sequestro de conta e escalada de privilégio: `/definir-senha` sem validação de recovery, `vincular_perfil_por_email()` em perfil `admin` e compra Hotmart com telefone de terceiro
- **Localização:** `WhatsApp-Fin/frontend/src/App.tsx:125-131`, `WhatsApp-Fin/frontend/src/pages/DefinirSenha.tsx:26-45,72`, `WhatsApp-Fin/supabase/migrations/20261118000002_correcoes_qa.sql:125-155`, `vincular_admin.sql:9-12`, `WhatsApp-Fin/lib/supabaseAdmin.ts:69-95,146-168`
- **Evidência redigida:**
  1. `DefinirSenha` aceita qualquer sessão existente de `getSession()` (não verifica evento `PASSWORD_RECOVERY`/token de convite nem senha atual) e chama `supabase.auth.updateUser({ password })`.
  2. `vincular_perfil_por_email()` vincula `auth_id = auth.uid()` a qualquer linha de `perfis` com `auth_id IS NULL` e `lower(p.email) = v_email` **sem filtrar `role <> 'admin'`** — agravado por `vincular_admin.sql:9-12` (que seta `auth_id = NULL, role = 'admin'`) e `ON DELETE SET NULL`.
  3. Compras Hotmart que informam `phone` criam `perfis` direto (`garantirPerfil`) sem verificar posse no WhatsApp nem checar se o telefone já pertence a outra `assinatura` sem perfil (achado #10 de 16/11 parcialmente aberto).
- **Impacto / Exploração:** (a) Em navegador compartilhado/desbloqueado com sessão ativa (ou OAuth Google), acessar `/definir-senha` troca a senha sem a senha atual; (b) conta admin órfã com e-mail recriável/não confirmado pode ser tomada via RPC; (c) comprador malicioso informa o celular de um usuário que só usa o bot e assume seu histórico via painel.
- **Correção recomendada:** Exigir token de convite/recovery (ou reautenticação) em `/definir-senha`; filtrar `AND p.role <> 'admin'` em `vincular_perfil_por_email()` e remover Opção 1 de `vincular_admin.sql`; exigir confirmação via código no WhatsApp também para compras com telefone preenchido (ou bloquear se o telefone pertencer a assinatura de outro e-mail).

#### [DSEC-07] Lacunas graves de LGPD: `hotmart_eventos.payload` sem minimização/TTL e ausência de exclusão/anonimização de dados do titular
- **Localização:** `WhatsApp-Fin/supabase/migrations/20261116000003_hotmart.sql:4-12`, `WhatsApp-Fin/supabase/migrations/20261116000001_tabelas_pt.sql:58`, `WhatsApp-Fin/lib/hotmart/linhas.ts:58-70`, `WhatsApp-Fin/frontend/src/pages/Settings.tsx:233-260`
- **Evidência redigida:** `hotmart_eventos.payload` persiste o JSON bruto completo da Hotmart (incluindo `buyer` com nome, e-mail, telefone e documento/CPF quando enviado) sem retenção máxima nem índice de expurgo. Além disso, as 8 tabelas do usuário (`movimentacoes`, `compromissos`, `contas_a_pagar`, `orcamentos`, `lancamentos_recorrentes`, `logs_lembrete`, `uso_servico`, `assinaturas`) relacionam-se por `telefone TEXT` sem cascata, `perfis.auth_id` usa `ON DELETE SET NULL` e não existe endpoint/RPC para eliminação ou anonimização de conta (LGPD Art. 18, VI).
- **Impacto / Exploração:** Impossibilidade técnica de atender pedidos de exclusão de titular (deixando dados financeiros e agenda médica/pessoal órfãos reassociáveis por e-mail/telefone) e acúmulo indefinido de PII de terceiros em `hotmart_eventos`.
- **Correção recomendada:** Minimizar ou mascarar `buyer` em `hotmart_eventos.payload` + agendar expurgo (>90 dias); implementar endpoint/RPC `excluir_minha_conta()` que apague/anonimize registros financeiros, agenda, vínculo e Auth do usuário.

#### [DSEC-08] Injeção de HTML no e-mail transacional de convite (`finalzap-email-convite.json`)
- **Localização:** `WhatsApp-Fin/n8n/finalzap-email-convite.json:50`, `WhatsApp-Fin/lib/supabaseAdmin.ts:53-59`
- **Evidência redigida:** O nó `Enviar e-mail (Gmail)` interpola `body.nome`, `body.email` e `body.link` em HTML bruto sem escapar caracteres `<`, `>`, `"`, `'` e `&`, recebendo `nome` originado do comprador no payload Hotmart (`lib/supabaseAdmin.ts:59`).
- **Impacto / Exploração:** Payload com tags HTML no nome do comprador injeta links/imagens maliciosas no e-mail oficial enviado pelo Gmail do FinalZap (phishing confiável).
- **Correção recomendada:** Escapar entidades HTML em `nome` e validar origem HTTPS de `link` antes da montagem do e-mail (no n8n e em `enviarLinkPeloN8n`); migrar segredo do webhook para `headerAuth` nativo e adicionar tratamento de erro no nó Gmail.

#### [DSEC-09] Remoção incompleta de policies RLS legadas (`logs_lembrete` e `whatsapp_instances`)
- **Localização:** `WhatsApp-Fin/supabase/migrations/20261117000001_seguranca_rls.sql:64-67,110-114,138-144`
- **Evidência redigida:** O loop de limpeza das linhas `64-67` remove apenas policies com expressão `app.user_phone`. Policies legadas sem essa expressão — como `"System can insert logs" ON public.logs_lembrete FOR INSERT WITH CHECK (TRUE)` (presente em `_arquivo_legado/supabase_raiz/finalzap_rls_policies.sql:39`) e policies antigas de escrita em `whatsapp_instances` — não são removidas, e `logs_lembrete` não recebeu `REVOKE INSERT, UPDATE, DELETE FROM authenticated`.
- **Impacto / Exploração:** Caso o ambiente de produção tenha rodado os scripts legados antes de 17/11, qualquer usuário `authenticated` (incluindo conta criada via cadastro aberto) consegue inserir logs falsos para o telefone de outros usuários.
- **Correção recomendada:** Executar `DROP POLICY IF EXISTS "System can insert logs" ON public.logs_lembrete;`, `REVOKE INSERT, UPDATE, DELETE ON public.logs_lembrete FROM PUBLIC, anon, authenticated;` e dropar todas as policies antigas de `whatsapp_instances` e `whatsapp_sessions`.

#### [DSEC-10] Bucket público `avatars` expõe listagem anônima de `auth.uid()` e aceita uploads sem limite de tamanho ou MIME
- **Localização:** `WhatsApp-Fin/supabase/migrations/20260311000008_create_storage_avatars.sql:6-30`, `WhatsApp-Fin/supabase/schema.sql:337-358`
- **Evidência redigida:** O bucket `avatars` foi criado com `public = true`, sem `file_size_limit` nem `allowed_mime_types`, mantendo a policy `Public avatar read` (`FOR SELECT USING (bucket_id = 'avatars')` sem restrição de papel).
- **Impacto / Exploração:** Usuários anônimos listam a raiz do bucket enumerando UIDs cadastrados; contas autenticadas podem subir arquivos gigantes ou `.svg`/`.html` no domínio Supabase.
- **Correção recomendada:** Dropar `Public avatar read`, configurar `file_size_limit` (ex.: 2 MB) e `allowed_mime_types` (`image/jpeg`, `image/png`, `image/webp`), ou remover o bucket se descontinuado.

---

### 🟢 Médias

#### [DSEC-11] Ausência de `Content-Security-Policy` (CSP) e `Strict-Transport-Security` (HSTS) em `vercel.json`
- **Localização:** `WhatsApp-Fin/vercel.json:29-50`, `WhatsApp-Fin/frontend/index.html:1-17`
- **Evidência redigida:** `vercel.json` configura `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy`, mas omite `CSP` e `HSTS`.
- **Impacto:** Reduz defesa em profundidade para tokens do Supabase Auth mantidos em `localStorage`.
- **Correção:** Configurar `Content-Security-Policy` restritiva (`frame-ancestors 'none'`, `object-src 'none'`, `connect-src` limitado ao projeto Supabase e `awesomeapi`) e `Strict-Transport-Security`.

#### [DSEC-12] `localStorage` residual após expiração/revogação de sessão (`useAuth.ts` / `useStore.ts` / `Settings.tsx`)
- **Localização:** `WhatsApp-Fin/frontend/src/hooks/useAuth.ts:20-41,110-124`, `WhatsApp-Fin/frontend/src/store/useStore.ts:363-372`, `WhatsApp-Fin/frontend/src/pages/Settings.tsx:53-61,250`
- **Evidência redigida:** `garantirDonoDoCache(null)` retorna `false` sem chamar `limparCache()` quando a sessão expira ou encerra remotamente via `onAuthStateChange`; `useStore` ainda persiste `accounts`, `investments`, `savingsGoals`, `creditCards` e `userSettings` em `localStorage['finance-store']`, e `Settings.tsx:250` esquece `finance-store-owner`.
- **Impacto:** Em dispositivos compartilhados, dados residuais de UI/configurações permanecem após expiração passiva da sessão.
- **Correção:** Chamar `limparCache()` no `aplicar(null)` quando `!session?.user` e remover campos legados de `partialize` em `useStore.ts`.

#### [DSEC-13] Ausência de `UNIQUE(auth_id)` em `perfis` e inconsistência de trigger `tr_conta_despagar_remove_despesa` (`SECURITY DEFINER`)
- **Localização:** `WhatsApp-Fin/supabase/migrations/20261116000001_tabelas_pt.sql:66`, `WhatsApp-Fin/supabase/migrations/20261117000001_seguranca_rls.sql:33,41`, `WhatsApp-Fin/supabase/migrations/20261118000002_correcoes_qa.sql:61-74`
- **Evidência redigida:** `idx_perfis_auth_id` não é único (`telefone_do_usuario()` e `eh_admin()` usam `LIMIT 1` sem `ORDER BY`). Além disso, `tr_conta_despagar_remove_despesa()` (`SECURITY DEFINER`) executa `DELETE FROM public.movimentacoes WHERE idempotency_key = 'conta_' || OLD.id::text AND fonte = 'conta_paga'` sem filtrar `AND telefone = OLD.telefone` (ao contrário de `tr_despesa_apagada_reabre_conta` corrigida em `20261119000001:38`).
- **Correção:** Criar índice único `WHERE auth_id IS NOT NULL` em `perfis` e adicionar `AND telefone = OLD.telefone` em `tr_conta_despagar_remove_despesa()`.

#### [DSEC-14] `vinculo_whatsapp`: falta checagem de vencimento da assinatura, lock concorrente, revalidação de e-mail e throttling
- **Localização:** `WhatsApp-Fin/supabase/migrations/20261119000003_vinculo_whatsapp.sql:48-63,87-115`
- **Evidência redigida:** `gerar_codigo_vinculo()` e `vincular_whatsapp()` verificam `status IN ('Ativo', 'Cancelado')` sem validar `data_vencimento > now()`; `gerar_codigo_vinculo()` não usa advisory lock por `v_uid`; `vincular_whatsapp()` não revalida `u.email_confirmed_at IS NOT NULL` e não limita tentativas inválidas de código nem limpa registros expirados.
- **Correção:** Aplicar a mesma lógica de vencimento de `verificar_assinatura_ativa`, usar `pg_advisory_xact_lock`, revalidar `email_confirmed_at` e limitar tentativas/expurgar códigos vencidos.

#### [DSEC-15] Falta de rate limiting / teto de custos OpenAI e `message_id` opcional em `api/whatsapp/webhook.ts`
- **Localização:** `WhatsApp-Fin/api/whatsapp/webhook.ts:20-64`, `WhatsApp-Fin/n8n/finalzap-supabase.json:346-360,995-1015`, `WhatsApp-Fin/api/admin/openai-custos.ts`, `WhatsApp-Fin/api/whatsapp/metricas.ts`
- **Evidência redigida:** Sem throttling por IP/telefone nas APIs nem teto diário de uso OpenAI/Whisper no fluxo `finalzap-supabase.json` (que tampouco registra tokens em `uso_servico`). Em `api/whatsapp/webhook.ts:62`, `message_id` ausente resulta em `p_idempotency_key = null`.
- **Correção:** Aplicar rate limit na borda (Vercel WAF/Upstash) e cota diária por assinante no n8n; exigir `message_id` no webhook interno.

#### [DSEC-16] Divergência de telefone 12 vs 13 dígitos em `compromissos`/financeiro e `idempotency_key` `UNIQUE` global
- **Localização:** `WhatsApp-Fin/supabase/migrations/20261123000001_compromissos.sql:30-32,66-68,83-86`, `WhatsApp-Fin/supabase/migrations/20261116000001_tabelas_pt.sql:114`, `WhatsApp-Fin/supabase/migrations/20261119000004_contas_idempotency.sql:5-6`, `WhatsApp-Fin/supabase/migrations/20261119000005_recorrentes_idempotency.sql:5-6`
- **Evidência redigida:** Perfis legados com 12 dígitos em `perfis.telefone` falham no `WITH CHECK` de `compromissos` após `tr_compromissos_a_telefone` canonizar para 13 dígitos; `idempotency_key` possui índice `UNIQUE` global em 4 tabelas (permitindo sondagem via erro `23505` e exigindo `AND telefone = v_tel` no fallback de `registrar_movimentacao`).
- **Correção:** Normalizar `perfis.telefone` legados via migração segura (ou comparar normalizado/por `perfil_id`) e escopar índices únicos de idempotência por `(telefone, idempotency_key)`.

#### [DSEC-17] Cadastro aberto com enumeração de contas (`Login.tsx`) e política de senha fraca (`senha.ts`)
- **Localização:** `WhatsApp-Fin/frontend/src/pages/Login.tsx:16-30,54-60,127`, `WhatsApp-Fin/frontend/src/lib/senha.ts:1-5`
- **Evidência redigida:** `translateError` distingue `"User already registered"` e `"Email not confirmed"`, expondo contas existentes; formulário `signUp` é público sem proteção anti-bot; `validarSenha` exige apenas 8 caracteres sem complexidade.
- **Correção:** Uniformizar mensagens de erro de autenticação, proteger/restringir `signUp` e elevar requisito mínimo de senha + checagem contra senhas vazadas no Supabase Auth.

#### [DSEC-18] Funções `SECURITY DEFINER` com `SET search_path = public` (sem `''`/`pg_temp`), RPCs admin sem guarda interna e inconsistência de scripts SQL (`schema.sql`, `20261118000007`, `create_admin.sql`)
- **Localização:** `WhatsApp-Fin/supabase/migrations/20261118000002_correcoes_qa.sql:65,80,129`, `20261118000005:11,33`, `20261118000006:7,23`, `20261118000007:1-19`, `20261119000001:20,31`, `WhatsApp-Fin/supabase/schema.sql:1-589`, `create_admin.sql:10-75`
- **Evidência redigida:** `vincular_perfil_por_email`, `handle_new_user`, triggers `DEFINER` e funções legadas usam `SET search_path = public` em vez de `''`; `resumo_admin_mensal` e `resumo_admin_periodo` têm `GRANT EXECUTE TO authenticated` e retornam zeros a usuários comuns em vez de recusar (`42501`); `20261118000007` referencia `public.profiles` (inexistente em banco limpo PT) e `create_admin.sql` recria `perfis` sem RLS e redefine `set_updated_at()` sem `search_path`.
- **Correção:** Padronizar `SET search_path = ''` nas funções, adicionar guarda `eh_admin()` nas RPCs admin e arquivar/corrigir `schema.sql`, `20261118000007` e `create_admin.sql`.

#### [DSEC-19] `DELETE /instance/:id` no `bot-server` sem validação de dono, `ALLOW_DEV_MOCK_AUTH` em `jwtAuth.ts` e erros internos na UI/APIs
- **Localização:** `WhatsApp-Fin/bot-server/server.ts:197-216`, `WhatsApp-Fin/lib/auth/jwtAuth.ts:17-24,43-44,62,76`, `WhatsApp-Fin/api/admin/openai-custos.ts:29-30`, `WhatsApp-Fin/api/whatsapp/metricas.ts:34`, `WhatsApp-Fin/frontend/src/hooks/useFinance.ts:39,106...`, `WhatsApp-Fin/frontend/src/pages/AssinaturasAdmin.tsx:91,105...`, `WhatsApp-Fin/frontend/src/features/agenda/components/PaginaAgenda.tsx:48,74`
- **Evidência redigida:** `DELETE /instance/:id` desconecta qualquer UUID apenas com `x-bot-secret` (sem validar `user_id`, mitigado pela remoção de `api/whatsapp/instances/*`); `jwtAuth.ts` libera `x-mock-user-id` se `NODE_ENV=development` + `ALLOW_DEV_MOCK_AUTH=true`; erros brutos de Supabase/OpenAI/Meta são retornados em `openai-custos.ts`, `metricas.ts` e exibidos em alertas na UI.
- **Correção:** Remover código Baileys/mock se obsoleto (ou exigir dono em `DELETE` e `localhost` no mock) e substituir mensagens de erro brutas por tradutor genérico.

#### [DSEC-20] Lacunas na suíte de testes e CI de segurança (`analisador.test.mjs`, `testsprite_tests`, `verificacao.yml`)
- **Localização:** `WhatsApp-Fin/tests/analisador.test.mjs:5-44`, `WhatsApp-Fin/tests/sql_banco_limpo.test.mjs:31-38`, `WhatsApp-Fin/.github/workflows/verificacao.yml:17-27`, `testsprite_tests/tests/e2e_and_api_suite.mjs`
- **Evidência redigida:** `analisador.test.mjs` testa função local duplicada que já divergiu de `lib/financeiro/analisador.ts:42`; `sql_banco_limpo.test.mjs` depende de `@electric-sql/pglite` (ausente em `package.json`, causando *skip* no CI limpo apesar de existir como pacote *extraneous* local); `.github/workflows/verificacao.yml` não audita `bot-server/` nem roda `npm audit` ou scan de PII/segredos; `e2e_and_api_suite.mjs` não testa `403` em `api/admin/*` nem `500` fail-closed.
- **Correção:** Declarar `@electric-sql/pglite` em `devDependencies`, importar `lib/financeiro/analisador.ts` no teste real, incluir `bot-server/` e `npm audit` no CI.

---

### 🔵 Baixas

- **[DSEC-21] Divergência de reserva atômica no cron das 8h e metadados reais em `finalzap-supabase.json`** — `n8n/finalzap-supabase.json:113,862,1074-1252` (e `PRONTO.json`, idêntico) envia lembrete antes de atualizar `lembrete_enviado_em`, puxa `perfis` e `assinaturas` inteiros, não conecta a saída de erro de `Vincular WhatsApp (RPC)` (`:121,1306`) e `Buscar assinatura` (`:165`), usa `phone_number_id` do payload nos replies sem validação e expõe URL `xtpd***.supabase.co` e IDs de credencial. `finalzap-agente-agenda.json:347-350` também não define `callerPolicy` restrito nem trunca `titulo`/`local`/`descricao` antes do insert.
- **[DSEC-22] `perfis.email` dessincronizado e colisão de `telefone = 'admin'`** — `20261117000001_seguranca_rls.sql:85` e `financeService.ts:151-169` gravam `perfis.email` antes de o usuário confirmar a troca no Auth; `create_admin.sql:54-71` usa `telefone = 'admin'` com `ON CONFLICT (telefone) DO UPDATE`, podendo sobrescrever um admin anterior.
- **[DSEC-23] Exposição visual e ausência de filtro `status = 'agendado'` no painel Agenda / Dashboard** — `frontend/src/features/agenda/servico.ts:53-80` não filtra `.eq('status', 'agendado')` nas queries de remarcação/cancelamento (só oculto na UI); `Dashboard.tsx:216` exibe `tx.telefone` completo na tela; código/páginas legadas (`supabaseService.ts`, `Accounts.tsx`, `CreditCards.tsx`, etc.) seguem no frontend.
- **[DSEC-24] Endurecimentos pontuais de banco, backend e documentação** — `hotmart_eventos` sem `REVOKE ALL FROM PUBLIC, authenticated` (`20261116000003:15`); `lib/whatsapp/meta.ts:37-39` sem regex estrita de 64 hexadecimais antes de `Buffer.from(..., 'hex')`; `lib/financeiro/analisador.ts:31,77` permite bypass de regex XML com espaço/atributo (`</user_message >`) e retorna `Error` comum em mensagem vazia; `lib/supabaseAdmin.ts:57` envia `x-webhook-secret` vazio se faltar env antes do `fetch`; `lib/pluggy.ts` e `lib/whatsapp/supabaseAuth.ts` órfãos em `lib/`; `DEPLOY.md`/`README.md` desatualizados sobre rotas removidas e últimas 3 migrações; `_arquivo_legado/supabase_raiz/*.sql` sem aviso de obsoleto; `finalzap-supabase.backup-20261119.json` na raiz é na verdade um export n8n antigo (sem segredos/PII reais), com nome enganoso.

---

## 3. Cadeia de Suprimentos (`npm audit --omit=dev`)

Executado localmente em `2026-11-24`:

| Pacote | Resumo (`critical` / `high` / `moderate` / `low`) | Principais Pacotes Afetados (`high` / `critical`) | Observação de Risco |
|---|---|---|---|
| `WhatsApp-Fin/` (raiz) | **0** vulnerabilidades (`0` total) | — | Limpo |
| `WhatsApp-Fin/frontend/` | `0` critical, **8 high**, 1 moderate, 1 low | `react-router` / `react-router-dom` (XSS/open redirect/DoS SSR-RSC), `vite` (dev server path traversal/arb read), `postcss`, `nanoid`, `picomatch`, `source-map-js`, `ws` | Risco em produção **mitigado** porque o app usa SPA client-side sem SSR/RSC e `vite`/`postcss`/`ws` são de dev/build, mas todas têm `fixAvailable: true` |
| `WhatsApp-Fin/bot-server/` | **1 critical**, **3 high**, 2 moderate | **CRITICAL:** `proxy-addr` (IP spoofing via IPv4-mapped IPv6); **HIGH:** `body-parser` (DoS), `follow-redirects` (vazamento de header `Authorization`/credenciais em redirect cross-origin), `sharp` (librsvg) | `bot-server` é canal legado (`server.ts:1`); se ativo no Render, atualizar dependências (`npm audit fix`) ou desativar o serviço |

---

## 4. Comparativo com Auditoria Anterior ([2026-11-16](./2026-11-16-seguranca.md))

| Categoria | Itens |
|---|---|
| **Resolvidos no código** | **#1** `service_role` literal removido; **#2** `verifyBotSecret` fail-closed + CORS + dono em `/connect` (resta só `DELETE`); **#3** `demo-token`/`signInAsTestUser` removidos; **#4** segredos Pluggy removidos de `vite.config.ts`; **#5** `BOT_SECRET_TOKEN` removido do bundle; **#6** `api/whatsapp/webhook.ts` fail-closed sem `user_id` do corpo; **#8** `api/financas/*` removidas; **#9** RLS versionada + `perfis` bloqueia alteração de `role`/`telefone` pelo usuário + admin server-side; **#12** CORS por `ALLOWED_ORIGINS`; **#13** rewrites mortos removidos de `vercel.json`. |
| **Persistem (total ou parcial)** | **#7** `whatsapp-fin-ai-agent.json` e `whatsapp-fin-alertas.json` permanecem em `n8n/`; **#10** compra Hotmart *com* telefone ainda cria `perfis` sem confirmar no WhatsApp (compra *sem* telefone agora usa código único); **#11** erros brutos seguem no frontend e em 2 rotas `api/`; **#14** fallbacks `VITE_*` em `jwtAuth.ts` e `lib/whatsapp/supabaseAuth.ts`; **#16** `hotmart_eventos.payload` sem minimização/TTL; **#17** Baileys ausente na raiz e `npm audit` fora do CI. *(E o histórico Git ainda guarda 6 commits com `service_role`, 2 com `b24a`, 3 com `bot_` e 3 com `sk-` — sem confirmação de rotação nos painéis.)* |
| **Novos (17–24/11/2026)** | PII real exposta em `conferir_simone.sql`, `criar_assinatura_simone.sql` e `finalzap-original.json` (`[DSEC-01]`); bug de DDI `55` em números E.164 internacionais no `finalzap-supabase.json` (`[DSEC-03]`); ausência de check de assinatura no Painel Web/RLS após reembolso (`[DSEC-04]`); `credenciais_servico` em texto claro (`[DSEC-05]`); `/definir-senha` sem checar token de recovery e `vincular_perfil_por_email` em `admin` (`[DSEC-06]`); HTML injection em `finalzap-email-convite.json` (`[DSEC-08]`); lacunas em `vinculo_whatsapp` e `compromissos` (`[DSEC-14]`, `[DSEC-16]`). |

---

## 5. Pontos Positivos Comprovados

- **APIs Serverless bem protegidas:** `api/admin/*` e `api/whatsapp/metricas.ts` validam JWT remoto e `perfis.role === 'admin'` via `service_role` no servidor (`reenviar-convite.ts` só lê `req.body` após auth); webhooks `hotmart/webhook.ts`, `whatsapp/meta.ts` e `whatsapp/webhook.ts` são **fail-closed** com `timingSafeEqual` / HMAC-SHA256 sobre corpo cru.
- **Anti-Prompt Injection cross-tenant em `R-002` nos fluxos novos:** `finalzap-supabase.json` e `finalzap-agente-agenda.json` obtêm `telefone` exclusivamente do webhook (nunca de `$fromAI`), codificam parâmetros `$fromAI` com `encodeURIComponent`, geram `idempotency_key` determinística (`R-007`) e verificam assinatura antes da IA (`R-001`).
- **Higiene contra XSS e Open Redirect no Frontend:** Nenhuma ocorrência de `dangerouslySetInnerHTML`, `innerHTML` ou `eval`; redirecionamentos limitados a rotas internas e origem própria.
- **Proteções avançadas no Postgres (`20261119`):** `tr_valida_chave_conta` impede sequestro de `idempotency_key` `conta_<id>`, `tr_despesa_apagada_reabre_conta` filtra por dono e `vinculos_whatsapp` bloqueia leitura/escrita direta pelo cliente.
- **Suíte local passando:** `npm test` em `WhatsApp-Fin/` executou **211/211 testes com 0 falhas** (incluindo os testes em Postgres real via PGlite local).

---

## 6. Ordem Priorizada de Remediação

1. **Imediato (bloqueadores de Go-Live):**
   - Remover `conferir_simone.sql`, `criar_assinatura_simone.sql` e limpar `pinData`/`shared` de `n8n/finalzap-original.json` (`[DSEC-01]`); confirmar rotação de todas as chaves vazadas no histórico Git pré-16/11 (especialmente `service_role`, Pluggy, `BOT_SECRET_TOKEN` e `OPENAI_API_KEY`).
   - Despublicar/remover `whatsapp-fin-ai-agent.json` e `whatsapp-fin-alertas.json` (`[DSEC-02]`).
   - Corrigir a normalização de telefone em `n8n/finalzap-supabase.json:65` para aceitar apenas DDI `55` explícito em mensagens da Meta (`[DSEC-03]`).
   - Escapar HTML em `finalzap-email-convite.json` (`[DSEC-08]`) e validar token/reautenticação em `/definir-senha` + filtrar `role <> 'admin'` em `vincular_perfil_por_email()` (`[DSEC-06]`).
2. **Curto prazo (antes de escalar base de clientes):**
   - Bloquear acesso web/RLS quando assinatura for `Inativo`/`Inadimplente`/vencida (`[DSEC-04]`).
   - Cifrar `credenciais_servico` (via `supabase_vault` ou AES-256-GCM) (`[DSEC-05]`).
   - Exigir verificação pelo WhatsApp também em compras Hotmart com telefone preenchido (`[DSEC-06]`).
   - Corrigir policies residuais (`logs_lembrete`, `whatsapp_instances`, bucket `avatars`), `tr_conta_despagar_remove_despesa` e `UNIQUE(auth_id)` em `perfis` (`[DSEC-09]`, `[DSEC-10]`, `[DSEC-13]`).
   - Implementar minimização/expurgo de `hotmart_eventos.payload` e fluxo LGPD de exclusão/anonimização de titular (`[DSEC-07]`).
3. **Médio prazo (hardening e governança):**
   - Adicionar `CSP` e `HSTS` no `vercel.json` (`[DSEC-11]`), limpar `localStorage` ao expirar sessão (`[DSEC-12]`), adicionar rate limiting/teto OpenAI (`[DSEC-15]`), rodar `npm audit fix` em `frontend/` e `bot-server/`, fixar `@electric-sql/pglite` em `devDependencies` e integrar `npm audit` no CI (`[DSEC-20]`).

---

## 7. Fora do Escopo / Não Verificado

- **Ambientes em produção ao vivo:** Não foram consultados o projeto Supabase (`xtpd***`), Vercel, Render ou n8n Cloud em tempo de execução — portanto não foi verificado se as migrações de `18–23/11` já foram aplicadas em produção, se `Confirm email` está ativo no Supabase Auth, quais workflows estão publicados no n8n Cloud, se o `WhatsApp OAuth account` valida `X-Hub-Signature-256` ou se as chaves antigas do histórico Git já foram rotacionadas.
- **Pastas fora de código ativo:** `WhatsApp-Fin/n8n-mcp` (inexistente dentro de `WhatsApp-Fin`, presente na raiz como `n8n-mcp/`) e `WhatsApp-Fin/docs/legado/` foram excluídos de auditoria de código. Em `_arquivo_legado/` não foram detectados segredos literais reais nas varreduras.
