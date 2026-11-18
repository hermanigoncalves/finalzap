# Template de utilidade: lembrete de conta a pagar

Texto livre fora da janela de 24h é recusado pela Meta (erro 131047). O lembrete das 8h do n8n deve usar este template, aprovado no WhatsApp Manager (aprovação é do dono).

| Item | Valor |
|------|-------|
| Nome | `lembrete_conta_a_pagar` |
| Categoria | **Utilidade** (utility) |
| Idioma | Português (Brasil) — `pt_BR` |
| Tipo de variável | Posicional |

## Texto (corpo)

```
Olá, {{1}}! Lembrete do FINALZAP: sua conta "{{2}}" no valor de R$ {{3}} vence em {{4}}. Depois de pagar, é só me avisar por aqui para eu registrar.
```

## Variáveis

| # | Conteúdo | Exemplo |
|---|----------|---------|
| {{1}} | Primeiro nome do usuário (`perfis.nome`) | Maria |
| {{2}} | Descrição da conta (`contas_a_pagar.descricao`) | Aluguel |
| {{3}} | Valor em BRL, vírgula decimal | 1.500,00 |
| {{4}} | Vencimento `dd/mm/aaaa` (ou "hoje"/"amanhã") | 20/11/2026 |

Exemplos para a revisão da Meta: `Maria`, `Aluguel`, `1.500,00`, `20/11/2026`.
Sem cabeçalho, rodapé ou botões. Sem conteúdo promocional (senão a Meta reclassifica como marketing).

## Uso no n8n

Nó WhatsApp "Send template": `template = lembrete_conta_a_pagar`, `language = pt_BR`, parâmetros do corpo na ordem acima. Credencial: a já existente no n8n (nenhuma chave neste repositório). Depois do envio: `UPDATE contas_a_pagar SET lembrete_enviado_em = now()` e `INSERT` em `logs_lembrete` (RPC `contas_para_lembrar(p_hoje)`, contrato do relatório FIN-13).

## Custo

O webhook `api/whatsapp/meta.ts` (GET verificação com `META_VERIFY_TOKEN`; POST validado por `X-Hub-Signature-256` com `META_APP_SECRET`) grava cada mensagem cobrada (`status = sent`, `pricing.billable`) em `uso_servico` (`servico = 'whatsapp'`, `referencia = meta:<id>:sent`, única, então reenvios não duplicam). Tarifa de utilidade padrão: US$ 0,0068 (Brasil) × `USD_BRL`; confirme em developers.facebook.com/docs/whatsapp/pricing ou ajuste via `META_TARIFAS_USD`. No painel de eventos da Meta, assine o campo `messages` apontando para `/api/whatsapp/meta`.
