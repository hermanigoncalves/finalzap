-- ============================================================
-- FINALZAP: Realtime e REPLICA IDENTITY FULL nas tabelas do usuário
-- Idempotente e aditiva. Necessária para DELETE com filtro/RLS no Realtime.
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'movimentacoes',
    'contas_a_pagar',
    'orcamentos',
    'compromissos',
    'perfis',
    'assinaturas'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;
