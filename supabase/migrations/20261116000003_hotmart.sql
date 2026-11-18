-- Integração Hotmart: eventos de webhook (idempotência) e controle de convite por e-mail.
-- Idempotente: pode ser executado mais de uma vez.

create table if not exists public.hotmart_eventos (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  tipo text,
  transacao text,
  assinante_codigo text,
  recebido_em timestamptz not null default now(),
  payload jsonb
);

-- RLS ligada e nenhuma policy: só a chave de serviço (service_role) acessa.
alter table public.hotmart_eventos enable row level security;

alter table public.assinaturas add column if not exists hotmart_assinante_codigo text unique;
alter table public.assinaturas add column if not exists ultimo_evento_em timestamptz;
alter table public.assinaturas add column if not exists convite_enviado_em timestamptz;
alter table public.assinaturas add column if not exists convite_erro text;
alter table public.assinaturas add column if not exists convite_reenviado_por uuid;
alter table public.assinaturas add column if not exists convite_reenviado_em timestamptz;

-- O webhook grava telefone NULL quando o payload não traz telefone (NULL nunca casa com ninguém).
-- DROP NOT NULL só relaxa a regra; não altera nenhuma linha existente.
alter table public.assinaturas alter column telefone drop not null;
-- Telefones '' antigos (se existirem) viram NULL para seguir a mesma regra.
update public.assinaturas set telefone = null where telefone = '';

-- Busca por telefone normalizado (com/sem 9º dígito). Deliberadamente NÃO único: o mesmo cliente
-- pode ter assinaturas sucessivas (renovação/recompra); a unicidade por assinatura já vem de
-- hotmart_assinante_codigo (UNIQUE).
create index if not exists idx_assinaturas_telefone_norm
  on public.assinaturas (public.normalizar_telefone_br(telefone)) where telefone is not null;
