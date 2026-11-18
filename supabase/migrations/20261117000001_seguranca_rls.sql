-- ============================================================
-- FINALZAP: endurecimento de segurança (RLS por auth.uid())
-- Idempotente: pode ser executado mais de uma vez.
-- REVISE antes de aplicar em produção e faça backup.
--
-- O que faz:
--  1. Liga RLS em todas as tabelas do painel.
--  2. Troca as policies baseadas em app.user_phone (que o supabase-js
--     nunca define) por policies baseadas em auth.uid() -> perfis.
--  3. Impede o usuário de alterar role/telefone/auth_id do próprio perfil.
--  4. (as RPCs INVOKER e seus GRANTs ficam em 20261116000002_funcoes_pt.sql)
-- O bot e os webhooks usam service_role, que ignora a RLS.
-- ============================================================

-- 0. Coluna de papel (caso o banco ainda não tenha)
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'perfis_role_check'
  ) THEN
    ALTER TABLE public.perfis
      ADD CONSTRAINT perfis_role_check CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- 1. Funções auxiliares (lêem perfis sem passar pela RLS dele)
CREATE OR REPLACE FUNCTION public.telefone_do_usuario()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT telefone FROM public.perfis WHERE auth_id = (SELECT auth.uid()) LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.eh_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.perfis WHERE auth_id = (SELECT auth.uid()) LIMIT 1),
    FALSE
  )
$$;

REVOKE ALL ON FUNCTION public.telefone_do_usuario() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eh_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telefone_do_usuario() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.eh_admin() TO authenticated, service_role;

-- 2. RLS ligada + remoção das policies antigas
DO $$
DECLARE
  t TEXT;
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'perfis', 'assinaturas', 'movimentacoes', 'orcamentos', 'contas_a_pagar',
    'lancamentos_recorrentes', 'logs_lembrete', 'uso_servico', 'custos_fixos'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- só derruba as policies antigas baseadas em app.user_phone (as nossas são recriadas abaixo)
      FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                   AND (qual ILIKE '%app.user_phone%' OR with_check ILIKE '%app.user_phone%') LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- 3. perfis: vê o próprio (admin vê todos); só edita nome/email do próprio.
DROP POLICY IF EXISTS perfis_select ON public.perfis;
CREATE POLICY perfis_select ON public.perfis FOR SELECT TO authenticated
  USING (auth_id = (SELECT auth.uid()) OR (SELECT public.eh_admin()));
DROP POLICY IF EXISTS perfis_update_proprio ON public.perfis;
CREATE POLICY perfis_update_proprio ON public.perfis FOR UPDATE TO authenticated
  USING (auth_id = (SELECT auth.uid()))
  WITH CHECK (auth_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS perfis_admin_all ON public.perfis;
CREATE POLICY perfis_admin_all ON public.perfis FOR ALL TO authenticated
  USING ((SELECT public.eh_admin())) WITH CHECK ((SELECT public.eh_admin()));

REVOKE INSERT, UPDATE, DELETE ON public.perfis FROM anon, authenticated;
GRANT UPDATE (nome, email) ON public.perfis TO authenticated;
-- (admin altera role/telefone/auth_id pelo painel de serviço ou SQL Editor)

-- 4. assinaturas: o cliente só LÊ a própria; o admin gerencia todas.
DROP POLICY IF EXISTS assinaturas_select ON public.assinaturas;
CREATE POLICY assinaturas_select ON public.assinaturas FOR SELECT TO authenticated
  USING (public.normalizar_telefone_br(telefone) = public.normalizar_telefone_br((SELECT public.telefone_do_usuario()))
         OR (SELECT public.eh_admin()));
DROP POLICY IF EXISTS assinaturas_admin_all ON public.assinaturas;
CREATE POLICY assinaturas_admin_all ON public.assinaturas FOR ALL TO authenticated
  USING ((SELECT public.eh_admin())) WITH CHECK ((SELECT public.eh_admin()));

-- 5. Tabelas por telefone: o dono faz tudo na própria linha.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['movimentacoes', 'orcamentos', 'contas_a_pagar', 'lancamentos_recorrentes'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_dono', t);
      EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (telefone = (SELECT public.telefone_do_usuario()))
        WITH CHECK (telefone = (SELECT public.telefone_do_usuario()))$f$, t || '_dono', t);
    END IF;
  END LOOP;
  IF to_regclass('public.logs_lembrete') IS NOT NULL THEN
    DROP POLICY IF EXISTS logs_lembrete_select ON public.logs_lembrete;
    CREATE POLICY logs_lembrete_select ON public.logs_lembrete FOR SELECT TO authenticated
      USING (telefone = (SELECT public.telefone_do_usuario()));
  END IF;
  -- Custos e uso de serviços são dados do negócio: só admin.
  IF to_regclass('public.uso_servico') IS NOT NULL THEN
    DROP POLICY IF EXISTS uso_servico_admin ON public.uso_servico;
    CREATE POLICY uso_servico_admin ON public.uso_servico FOR ALL TO authenticated
      USING ((SELECT public.eh_admin())) WITH CHECK ((SELECT public.eh_admin()));
  END IF;
  IF to_regclass('public.custos_fixos') IS NOT NULL THEN
    DROP POLICY IF EXISTS custos_fixos_admin ON public.custos_fixos;
    CREATE POLICY custos_fixos_admin ON public.custos_fixos FOR ALL TO authenticated
      USING ((SELECT public.eh_admin())) WITH CHECK ((SELECT public.eh_admin()));
  END IF;
END $$;

-- 6. (removido) As RPCs são SECURITY INVOKER e têm GRANT próprio em 20261116000002_funcoes_pt.sql.
--    Não reconceder EXECUTE em massa aqui: isso reabriria funções para `authenticated`.

-- 7. Sessões do WhatsApp (credenciais Baileys): só service_role.
DO $$
BEGIN
  IF to_regclass('public.whatsapp_sessions') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.whatsapp_sessions FROM anon, authenticated;
  END IF;
  IF to_regclass('public.whatsapp_instances') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS whatsapp_instances_dono ON public.whatsapp_instances;
    DROP POLICY IF EXISTS whatsapp_instances_dono ON public.whatsapp_instances;
    CREATE POLICY whatsapp_instances_dono ON public.whatsapp_instances FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;

-- 8. Tempo real (Supabase Realtime) para o painel admin.
--    A RLS vale também no realtime: só o admin recebe estes eventos.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['uso_servico', 'assinaturas', 'custos_fixos'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
-- (uso_servico.referencia e o índice único estão em 20261116000001_tabelas_pt.sql)
