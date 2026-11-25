# AGENTS.md

Regras curtas. O que dá para checar automaticamente já está em lint, tipos, testes ou hooks;
aqui fica só o que exige julgamento. Para mudar uma regra, prefira transformar em checagem.

## Antes de dizer "pronto"

`npm run verificar` precisa passar (o hook de parada roda isso por você). Mudou tela?
Rode `npm run e2e` e confira os screenshots. Feature nova segue `/feature`.

## Onde as coisas moram

- `src/features/<nome>/`: tudo de uma funcionalidade. Só `index.ts` é público.
- `src/shared/`: genérico e reutilizável. Não conhece features.
- `src/app/`: composição, rotas e providers.
- `docs/regras.md`: regras do produto com ID. **Fonte da verdade.**
- `docs/specs/`: uma spec por feature. `supabase/migrations/`: todo SQL, datado.

## Decisões que são do humano, não suas

Pergunte antes de: criar dependência nova, mudar schema do banco, mudar uma regra de
`docs/regras.md`, mexer em auth/pagamento ou apagar dados.

## Como trabalhar

- Siga o padrão do código vizinho. Se o vizinho estiver ruim, avise. Não copie.
- Faça agora o que é o jeito certo. Você implementa rápido; "isso levaria dias" não é motivo
  para deixar atalho. Não existe TODO neste repositório.
- Não escreva documentação, comentários ou regras novas sem pedido. Um ajuste que eu pedir
  vale para aquele caso, não vira regra geral.
- Não superdimensione: resolva o problema que existe, na escala que existe.
- Teste de regra leva o ID no nome: `it("[R-001] ...")`.
