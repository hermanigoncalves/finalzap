# Fluxo n8n do FINALZAP (WAHA + Supabase)

O fluxo principal do FINALZAP utiliza **WAHA (WhatsApp HTTP API)** para a camada de mensageria WhatsApp e o **Supabase** nativo para persistência e regras de negócio.

- **Arquivo principal:** `finalzap-waha.json` (ou `finalzap-supabase.json`, que agora é espelho da versão WAHA).
- **Workflow no n8n Cloud:** `FINALZAP - Controle de Gastos e Agenda` (`Rwm2NFEP4TPyJUyb`).

---

## 1. Arquitetura das APIs no Fluxo

| Componente | API Utilizada | Como funciona |
| :--- | :--- | :--- |
| **WhatsApp (Gatilho)** | Webhook n8n (`finalzap-waha`) | Recebe eventos `message` disparados pelo WAHA, autenticado via Header Auth (`X-Api-Key`) |
| **WhatsApp (Envio)** | WAHA HTTP API | `POST https://meu-waha.xiekee.easypanel.host/api/sendText` |
| **WhatsApp (Áudio)** | WAHA Media Download | `GET` na URL do arquivo com header `X-Api-Key` |
| **Banco de Dados** | Supabase REST / Nós nativos | Tabelas `perfis`, `assinaturas`, `movimentacoes`, etc. |
| **IA / LLM & Transcrição** | OpenAI API | GPT-4o / GPT-4o-mini (LangChain) + Whisper (áudio) |
| **Sub-workflow Agenda** | `finalzap-agente-agenda.json` (`g6a84rRrWOoUuHfm`) | Supabase (`compromissos`) + OpenAI |
| **Sub-workflow Cancelamento** | `finalzap-cancelar-assinatura-hotmart.json` (`c3Pv5Uvyx0lA2v48`) | Hotmart Developers API + Supabase |

---

## 2. Configuração do Webhook no WAHA

1. No n8n, certifique-se de que a credencial de Header Auth **`Waha api`** (ID: `6zD5FMHPIMgyYzW4`, header **`X-Api-Key`**) está associada com a chave do seu WAHA. Ela protege tanto as chamadas de saída para o WAHA quanto a entrada no webhook `Mensagem no WhatsApp` (`authentication: "headerAuth"`).
2. A URL de produção do webhook no n8n é:
   ```
   https://meu-n8n.xiekee.easypanel.host/webhook/finalzap-waha
   ```
3. No painel do WAHA (ou via API do WAHA), configure o webhook na sessão desejada (`default`):
   - **URL:** `https://meu-n8n.xiekee.easypanel.host/webhook/finalzap-waha`
   - **Events:** `message`
   - **Custom Headers:** `X-Api-Key: <mesma chave configurada na credencial "Waha api" do n8n>`

---

## 3. Disparo Diário de Lembretes (8h)

No fluxo WAHA, o disparo de lembretes diários às 8h **não necessita de templates aprovados pela Meta**:
- O nó **`Montar lembretes`** formata a mensagem diretamente em texto.
- O nó **`Enviar lembrete no WhatsApp`** faz `POST /api/sendText` para `${telefone}@c.us`.
- Em seguida, atualiza `lembrete_enviado_em` no Supabase e grava o histórico em `logs_lembrete`.
