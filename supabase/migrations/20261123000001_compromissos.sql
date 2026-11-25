-- ============================================================
-- FINALZAP: tabela compromissos (Agente de Agenda no WhatsApp + painel /agenda)
-- Aditiva e reexecutável. Rodar depois de 20261118000001_n8n_no_supabase.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.compromissos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  titulo TEXT NOT NULL CHECK (char_length(trim(titulo)) > 0 AND char_length(titulo) <= 200),
  descricao TEXT CHECK (descricao IS NULL OR char_length(descricao) <= 1000),
  local TEXT CHECK (local IS NULL OR char_length(local) <= 200),
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado', 'concluido', 'cancelado')),
  permitir_conflito BOOLEAN NOT NULL DEFAULT FALSE,
  fonte TEXT NOT NULL DEFAULT 'whatsapp' CHECK (fonte IN ('whatsapp', 'painel')),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compromissos_fim_maior_inicio CHECK (fim > inicio)
);

CREATE INDEX IF NOT EXISTS idx_compromissos_telefone_periodo
  ON public.compromissos (telefone, inicio, fim)
  WHERE status = 'agendado';

CREATE INDEX IF NOT EXISTS idx_compromissos_telefone_inicio
  ON public.compromissos (telefone, inicio DESC);

CREATE UNIQUE INDEX IF NOT EXISTS compromissos_idempotency_key_uq
  ON public.compromissos (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tr_compromissos_conflito()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conflito RECORD;
BEGIN
  IF NEW.status = 'agendado' AND NOT COALESCE(NEW.permitir_conflito, FALSE) THEN
    FOR v_conflito IN
      SELECT titulo,
             to_char(timezone('America/Sao_Paulo', inicio), 'DD/MM/YYYY HH24:MI') AS ini_fmt,
             to_char(timezone('America/Sao_Paulo', fim), 'HH24:MI') AS fim_fmt
        FROM public.compromissos
       WHERE telefone = NEW.telefone
         AND status = 'agendado'
         AND id IS DISTINCT FROM NEW.id
         AND inicio < NEW.fim
         AND fim > NEW.inicio
       ORDER BY inicio
       LIMIT 1
    LOOP
      RAISE EXCEPTION 'CONFLITO_HORARIO: Já existe compromisso neste horário: % (%-%).',
        v_conflito.titulo, v_conflito.ini_fmt, v_conflito.fim_fmt
        USING ERRCODE = 'check_violation';
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_compromissos_a_telefone ON public.compromissos;
CREATE TRIGGER tr_compromissos_a_telefone
  BEFORE INSERT OR UPDATE OF telefone ON public.compromissos
  FOR EACH ROW EXECUTE FUNCTION public.tr_canoniza_telefone();

DROP TRIGGER IF EXISTS tr_compromissos_b_conflito ON public.compromissos;
CREATE TRIGGER tr_compromissos_b_conflito
  BEFORE INSERT OR UPDATE OF telefone, inicio, fim, status, permitir_conflito ON public.compromissos
  FOR EACH ROW EXECUTE FUNCTION public.tr_compromissos_conflito();

DROP TRIGGER IF EXISTS tr_compromissos_updated ON public.compromissos;
CREATE TRIGGER tr_compromissos_updated
  BEFORE UPDATE ON public.compromissos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.compromissos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compromissos_dono ON public.compromissos;
CREATE POLICY compromissos_dono ON public.compromissos
  FOR ALL TO authenticated
  USING (telefone = (SELECT public.telefone_do_usuario()))
  WITH CHECK (telefone = (SELECT public.telefone_do_usuario()));

REVOKE ALL ON public.compromissos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compromissos TO authenticated, service_role;
