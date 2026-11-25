-- FINALZAP: migrações 15 a 19 em um arquivo (reexecutável). Rode no SQL Editor do Supabase.

-- ##### 20261119000004_contas_idempotency.sql #####
-- Idempotência no cadastro de conta a pagar pelo WhatsApp: a Meta reenvia webhooks e o agente pode
-- repetir a chamada. Chave = wa:<id da mensagem>:<hash>. Nula (painel/outras origens) não restringe nada,
-- então parcelas e contas recorrentes legítimas continuam permitidas.
ALTER TABLE public.contas_a_pagar ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contas_a_pagar_idempotency_key_uq
  ON public.contas_a_pagar (idempotency_key) WHERE idempotency_key IS NOT NULL;


-- ##### 20261119000005_recorrentes_idempotency.sql #####
-- Idempotência no cadastro de lançamento recorrente pelo WhatsApp (onboarding do primeiro acesso):
-- a Meta reenvia webhooks e o agente pode repetir a chamada. Chave = wa:<id da mensagem>:<hash>.
-- Nula (painel) não restringe nada.
ALTER TABLE public.lancamentos_recorrentes ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_recorrentes_idempotency_key_uq
  ON public.lancamentos_recorrentes (idempotency_key) WHERE idempotency_key IS NOT NULL;


-- ##### 20261123000001_compromissos.sql #####
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


-- ##### 20261125000001_credenciais_waha.sql #####
-- Permite guardar a conexão com o WAHA (URL e chave) em credenciais_servico. Não apaga dados.
ALTER TABLE public.credenciais_servico DROP CONSTRAINT IF EXISTS credenciais_servico_chave_check;
ALTER TABLE public.credenciais_servico
  ADD CONSTRAINT credenciais_servico_chave_check
  CHECK (chave IN ('META_ACCESS_TOKEN', 'META_WABA_ID', 'OPENAI_ADMIN_KEY', 'WAHA_URL', 'WAHA_API_KEY'));


-- ##### 20261125000002_hardening_producao.sql #####
-- ============================================================
-- FINALZAP: Hardening de Produção (RLS, LGPD, Storage, Auth, RPCs)
-- 100% idempotente e segura para rodar em banco limpo (sem schema storage).
-- ============================================================

-- ------------------------------------------------------------
-- 1. [DSEC-04] Trava de assinatura ativa na RLS
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_assinatura_ativa(p_telefone TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.normalizar_telefone_br(p_telefone) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.assinaturas a
       WHERE public.normalizar_telefone_br(a.telefone) = public.normalizar_telefone_br(p_telefone)
         AND ((a.status = 'Ativo' AND (a.data_vencimento IS NULL OR a.data_vencimento > now()))
              OR (a.status = 'Cancelado' AND a.data_vencimento > now())))
$$;

REVOKE ALL ON FUNCTION public.verificar_assinatura_ativa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verificar_assinatura_ativa(text) TO authenticated, service_role;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'movimentacoes', 'orcamentos', 'contas_a_pagar', 'lancamentos_recorrentes', 'compromissos'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_dono', t);
      EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (
          telefone = (SELECT public.telefone_do_usuario())
          AND ((SELECT public.eh_admin()) OR (SELECT public.verificar_assinatura_ativa((SELECT public.telefone_do_usuario()))))
        )
        WITH CHECK (
          telefone = (SELECT public.telefone_do_usuario())
          AND ((SELECT public.eh_admin()) OR (SELECT public.verificar_assinatura_ativa((SELECT public.telefone_do_usuario()))))
        )$f$, t || '_dono', t);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. [DSEC-06] vincular_perfil_por_email() nunca assume perfil admin órfão
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vincular_perfil_por_email()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_confirmado BOOLEAN;
  v_perfil UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_uid) THEN RETURN TRUE; END IF;

  SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO v_email, v_confirmado
    FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR NOT v_confirmado THEN RETURN FALSE; END IF;

  SELECT p.id INTO v_perfil FROM public.perfis p
   WHERE lower(p.email) = v_email AND p.auth_id IS NULL AND p.role <> 'admin'
   ORDER BY p.created_at LIMIT 1;
  IF v_perfil IS NULL THEN RETURN FALSE; END IF;

  UPDATE public.perfis SET auth_id = v_uid
   WHERE id = v_perfil AND auth_id IS NULL AND role <> 'admin';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_perfil_por_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_perfil_por_email() TO authenticated;

-- ------------------------------------------------------------
-- 3. [DSEC-09] Remoção de policies e privilégios legados
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "System can insert logs" ON public.logs_lembrete;
REVOKE INSERT, UPDATE, DELETE ON public.logs_lembrete FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  pol RECORD;
BEGIN
  IF to_regclass('public.whatsapp_instances') IS NOT NULL THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'whatsapp_instances'
        AND policyname <> 'whatsapp_instances_dono'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_instances', pol.policyname);
    END LOOP;
  END IF;

  IF to_regclass('public.whatsapp_sessions') IS NOT NULL THEN
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'whatsapp_sessions'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.whatsapp_sessions', pol.policyname);
    END LOOP;
    REVOKE ALL ON TABLE public.whatsapp_sessions FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. [DSEC-10] Storage bucket avatars privado e restrito (protegido contra ausência do schema storage)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $s$
      UPDATE storage.buckets
         SET public = false,
             file_size_limit = 2097152,
             allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
       WHERE id = 'avatars'
    $s$;
    EXECUTE 'DROP POLICY IF EXISTS "Public avatar read" ON storage.objects';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. [DSEC-13] UNIQUE(auth_id) parcial + isolamento no trigger despagar
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_perfis_auth_id_unico
  ON public.perfis (auth_id)
  WHERE auth_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tr_conta_despagar_remove_despesa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'paga' AND NEW.status IS DISTINCT FROM 'paga' THEN
    DELETE FROM public.movimentacoes
     WHERE idempotency_key = 'conta_' || OLD.id::text
       AND telefone = OLD.telefone
       AND fonte = 'conta_paga';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tr_conta_despagar_remove_despesa() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. [DSEC-14] gerar_codigo_vinculo() e vincular_whatsapp() com assinatura ativa/vencimento, lock e e-mail confirmado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_codigo_vinculo()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_confirmado BOOLEAN;
  v_codigo TEXT;
  v_expira TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN public.fz_resultado(false, 'Faça login para continuar.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_uid) THEN
    RETURN public.fz_resultado(true, 'Sua conta já está vinculada.', jsonb_build_object('ja_vinculado', true));
  END IF;

  SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO v_email, v_confirmado
    FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR NOT v_confirmado THEN
    RETURN public.fz_resultado(false, 'Confirme o seu e-mail para continuar.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.assinaturas a
    WHERE lower(a.email) = v_email
      AND ((a.status = 'Ativo' AND (a.data_vencimento IS NULL OR a.data_vencimento > now()))
           OR (a.status = 'Cancelado' AND a.data_vencimento > now()))
  ) THEN
    RETURN public.fz_resultado(false, 'Não encontramos uma assinatura para este e-mail. Entre com o e-mail usado na compra.');
  END IF;

  DELETE FROM public.vinculos_whatsapp WHERE usado_em IS NULL AND expira_em <= now();

  SELECT v.codigo, v.expira_em INTO v_codigo, v_expira
    FROM public.vinculos_whatsapp v
   WHERE v.auth_id = v_uid AND v.usado_em IS NULL AND v.expira_em > now()
   ORDER BY v.created_at DESC LIMIT 1;

  IF v_codigo IS NULL THEN
    DELETE FROM public.vinculos_whatsapp WHERE auth_id = v_uid AND usado_em IS NULL;
    v_codigo := 'FZ-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    v_expira := now() + interval '30 minutes';
    INSERT INTO public.vinculos_whatsapp (codigo, auth_id, expira_em) VALUES (v_codigo, v_uid, v_expira);
  END IF;

  RETURN public.fz_resultado(true, 'Código gerado.', jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira));
END;
$$;

CREATE OR REPLACE FUNCTION public.vincular_whatsapp(p_telefone TEXT, p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tel TEXT := public.normalizar_telefone_br(p_telefone);
  v_cod TEXT := upper(btrim(COALESCE(p_codigo, '')));
  v_vinculo public.vinculos_whatsapp%ROWTYPE;
  v_email TEXT;
  v_confirmado BOOLEAN;
  v_ass public.assinaturas%ROWTYPE;
BEGIN
  IF v_tel IS NULL THEN
    RETURN public.fz_resultado(false, 'Telefone inválido.');
  END IF;

  SELECT * INTO v_vinculo FROM public.vinculos_whatsapp
   WHERE codigo = v_cod AND usado_em IS NULL AND expira_em > now() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.fz_resultado(false, 'Código inválido ou expirado. Gere um novo no painel do FinalZap.');
  END IF;

  SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO v_email, v_confirmado
    FROM auth.users u WHERE u.id = v_vinculo.auth_id;
  IF v_email IS NULL OR NOT v_confirmado THEN
    RETURN public.fz_resultado(false, 'Confirme o seu e-mail para continuar.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_vinculo.auth_id) THEN
    UPDATE public.vinculos_whatsapp SET usado_em = now() WHERE codigo = v_cod;
    RETURN public.fz_resultado(false, 'Esta conta já está vinculada a um WhatsApp.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE public.normalizar_telefone_br(telefone) = v_tel) THEN
    RETURN public.fz_resultado(false, 'Este WhatsApp já está vinculado a outra conta. Fale com o suporte.');
  END IF;

  SELECT * INTO v_ass FROM public.assinaturas a
   WHERE lower(a.email) = v_email
     AND ((a.status = 'Ativo' AND (a.data_vencimento IS NULL OR a.data_vencimento > now()))
          OR (a.status = 'Cancelado' AND a.data_vencimento > now()))
   ORDER BY a.ultimo_evento_em DESC NULLS LAST, a.created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN public.fz_resultado(false, 'Não encontramos uma assinatura para esta conta.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.assinaturas
              WHERE public.normalizar_telefone_br(telefone) = v_tel AND lower(email) <> v_email) THEN
    RETURN public.fz_resultado(false, 'Este WhatsApp já está ligado a outra assinatura. Fale com o suporte.');
  END IF;

  INSERT INTO public.perfis (auth_id, telefone, nome, email, role)
  VALUES (v_vinculo.auth_id, v_tel, v_ass.nome, v_email, 'user');

  UPDATE public.assinaturas SET telefone = v_tel, convite_erro = NULL
   WHERE lower(email) = v_email AND telefone IS NULL;
  UPDATE public.vinculos_whatsapp SET usado_em = now() WHERE codigo = v_cod;

  RETURN public.fz_resultado(true,
    'WhatsApp vinculado! ✅ Agora é só me mandar seus gastos por aqui. Exemplo: "gastei 25 no almoço".');
END;
$$;

REVOKE ALL ON FUNCTION public.gerar_codigo_vinculo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_codigo_vinculo() TO authenticated;
REVOKE ALL ON FUNCTION public.vincular_whatsapp(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_whatsapp(text, text) TO service_role;

-- ------------------------------------------------------------
-- 7. [DSEC-18] search_path = '' e guarda explícita nas RPCs admin + hotmart_eventos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tr_despesa_apagada_reabre_conta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.contas_a_pagar
     SET status = 'pendente'
   WHERE 'conta_' || id::text = OLD.idempotency_key
     AND telefone = OLD.telefone
     AND status = 'paga';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tr_despesa_apagada_reabre_conta() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resumo_admin_mensal(meses integer DEFAULT 6)
RETURNS TABLE (
  mes text,
  entradas numeric,
  qtd_entradas integer,
  taxas_hotmart numeric,
  custos_fixos numeric,
  custo_servicos_usd numeric,
  custo_servicos_brl numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.eh_admin() THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH m AS (
    SELECT date_trunc('month', timezone('America/Sao_Paulo', now()))::date - (i * interval '1 month') AS ini
    FROM generate_series(0, GREATEST(LEAST(meses, 24), 1) - 1) AS i
  )
  SELECT to_char(m.ini, 'YYYY-MM'),
    COALESCE(e.valor, 0), COALESCE(e.qtd, 0), COALESCE(e.taxa, 0),
    COALESCE((SELECT SUM(c.valor) FROM public.custos_fixos c
              WHERE c.status <> 'cancelado' AND c.vencimento >= m.ini AND c.vencimento < m.ini + interval '1 month'), 0),
    COALESCE((SELECT SUM(u.custo_usd) FROM public.uso_servico u
              WHERE u.data >= m.ini AND u.data < m.ini + interval '1 month'), 0),
    COALESCE((SELECT SUM(u.custo_brl) FROM public.uso_servico u
              WHERE COALESCE(u.custo_usd, 0) = 0 AND u.data >= m.ini AND u.data < m.ini + interval '1 month'), 0)
  FROM m
  LEFT JOIN LATERAL (
    SELECT SUM(x.valor) AS valor, COUNT(*)::integer AS qtd, SUM(x.taxa) AS taxa
    FROM public.entradas x
    WHERE x.moeda = 'BRL' AND x.data >= m.ini AND x.data < m.ini + interval '1 month'
  ) e ON TRUE
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resumo_admin_mensal(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_admin_mensal(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.resumo_admin_periodo(p_inicio date, p_fim date)
RETURNS TABLE (
  entradas numeric,
  qtd_entradas integer,
  taxas_hotmart numeric,
  custos_fixos numeric,
  custo_servicos_usd numeric,
  custo_servicos_brl numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.eh_admin() THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(e.valor, 0), COALESCE(e.qtd, 0), COALESCE(e.taxa, 0),
    COALESCE((SELECT SUM(c.valor) FROM public.custos_fixos c
              WHERE c.status <> 'cancelado' AND c.vencimento BETWEEN p_inicio AND p_fim), 0),
    COALESCE((SELECT SUM(u.custo_usd) FROM public.uso_servico u
              WHERE u.data BETWEEN p_inicio AND p_fim), 0),
    COALESCE((SELECT SUM(u.custo_brl) FROM public.uso_servico u
              WHERE COALESCE(u.custo_usd, 0) = 0 AND u.data BETWEEN p_inicio AND p_fim), 0)
  FROM (
    SELECT SUM(x.valor) AS valor, COUNT(*)::integer AS qtd, SUM(x.taxa) AS taxa
    FROM public.entradas x
    WHERE x.moeda = 'BRL' AND x.data BETWEEN p_inicio AND p_fim
  ) e;
END;
$$;

REVOKE ALL ON FUNCTION public.resumo_admin_periodo(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_admin_periodo(date, date) TO authenticated;

REVOKE ALL ON TABLE public.hotmart_eventos FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8. [DSEC-05] Limpeza de credenciais Meta legadas e atualização da constraint
-- ------------------------------------------------------------
DELETE FROM public.credenciais_servico WHERE chave IN ('META_ACCESS_TOKEN', 'META_WABA_ID');

ALTER TABLE public.credenciais_servico DROP CONSTRAINT IF EXISTS credenciais_servico_chave_check;
ALTER TABLE public.credenciais_servico
  ADD CONSTRAINT credenciais_servico_chave_check
  CHECK (chave IN ('OPENAI_ADMIN_KEY', 'WAHA_URL', 'WAHA_API_KEY', 'WAHA_WEBHOOK_SECRET'));

-- ------------------------------------------------------------
-- 9. [DSEC-07] LGPD: exclusão e anonimização de conta pelo próprio usuário
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_minha_conta()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_perfil public.perfis%ROWTYPE;
  v_tel_norm TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN public.fz_resultado(false, 'Faça login para continuar.');
  END IF;

  SELECT * INTO v_perfil FROM public.perfis WHERE auth_id = v_uid LIMIT 1;
  IF NOT FOUND THEN
    DELETE FROM public.vinculos_whatsapp WHERE auth_id = v_uid;
    RETURN public.fz_resultado(true, 'Conta e dados excluídos.');
  END IF;

  IF v_perfil.role = 'admin' THEN
    RETURN public.fz_resultado(false, 'Conta de administrador não pode ser excluída por esta função.');
  END IF;

  v_tel_norm := public.normalizar_telefone_br(v_perfil.telefone);

  DELETE FROM public.logs_lembrete
   WHERE telefone = v_perfil.telefone
      OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone_br(telefone) = v_tel_norm);

  DELETE FROM public.contas_a_pagar
   WHERE telefone = v_perfil.telefone
      OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone_br(telefone) = v_tel_norm);

  DELETE FROM public.movimentacoes
   WHERE telefone = v_perfil.telefone
      OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone_br(telefone) = v_tel_norm);

  DELETE FROM public.orcamentos
   WHERE telefone = v_perfil.telefone
      OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone_br(telefone) = v_tel_norm);

  DELETE FROM public.lancamentos_recorrentes
   WHERE telefone = v_perfil.telefone
      OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone_br(telefone) = v_tel_norm);

  DELETE FROM public.compromissos
   WHERE telefone = v_perfil.telefone
      OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone_br(telefone) = v_tel_norm);

  DELETE FROM public.vinculos_whatsapp WHERE auth_id = v_uid;

  UPDATE public.perfis
     SET nome = 'Conta excluída',
         email = NULL,
         auth_id = NULL
   WHERE id = v_perfil.id;

  RETURN public.fz_resultado(true, 'Conta e dados excluídos.');
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_minha_conta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_minha_conta() TO authenticated;

