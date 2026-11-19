-- ============================================================
-- FINALZAP: vínculo do WhatsApp por código (compra sem telefone na Hotmart).
-- O cliente entra no painel (e-mail confirmado), gera um código de uso único e o envia, DO PRÓPRIO
-- WhatsApp, para o número do FinalZap. O n8n chama vincular_whatsapp com o número de quem enviou
-- (verificado pela Meta) e o código; o banco cria o perfil e grava o telefone na assinatura.
-- Aditiva e reexecutável. Rodar depois de 20261119000002_chave_conta_do_dono.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vinculos_whatsapp (
  codigo TEXT PRIMARY KEY,
  auth_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vinculos_whatsapp_auth ON public.vinculos_whatsapp (auth_id);

-- Só as funções abaixo (SECURITY DEFINER) mexem na tabela: RLS ligada, sem policy e sem grants.
ALTER TABLE public.vinculos_whatsapp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vinculos_whatsapp FROM PUBLIC, anon, authenticated;

-- 1. Painel: gera (ou reaproveita) o código do usuário logado. Só quem tem assinatura para o e-mail confirmado.
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
  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_uid) THEN
    RETURN public.fz_resultado(true, 'Sua conta já está vinculada.', jsonb_build_object('ja_vinculado', true));
  END IF;

  SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO v_email, v_confirmado
    FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR NOT v_confirmado THEN
    RETURN public.fz_resultado(false, 'Confirme o seu e-mail para continuar.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assinaturas a
                  WHERE lower(a.email) = v_email AND a.status IN ('Ativo', 'Cancelado')) THEN
    RETURN public.fz_resultado(false, 'Não encontramos uma assinatura para este e-mail. Entre com o e-mail usado na compra.');
  END IF;

  SELECT v.codigo, v.expira_em INTO v_codigo, v_expira
    FROM public.vinculos_whatsapp v
   WHERE v.auth_id = v_uid AND v.usado_em IS NULL AND v.expira_em > now()
   ORDER BY v.created_at DESC LIMIT 1;

  IF v_codigo IS NULL THEN
    DELETE FROM public.vinculos_whatsapp WHERE auth_id = v_uid AND usado_em IS NULL;
    v_codigo := 'FZ-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)); -- 32 bits: inviável de adivinhar em 30 min
    v_expira := now() + interval '30 minutes';
    INSERT INTO public.vinculos_whatsapp (codigo, auth_id, expira_em) VALUES (v_codigo, v_uid, v_expira);
  END IF;

  RETURN public.fz_resultado(true, 'Código gerado.', jsonb_build_object('codigo', v_codigo, 'expira_em', v_expira));
END;
$$;

-- 2. n8n (service_role): consome o código com o telefone de quem enviou a mensagem.
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

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_vinculo.auth_id;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE auth_id = v_vinculo.auth_id) THEN
    UPDATE public.vinculos_whatsapp SET usado_em = now() WHERE codigo = v_cod;
    RETURN public.fz_resultado(false, 'Esta conta já está vinculada a um WhatsApp.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfis WHERE public.normalizar_telefone_br(telefone) = v_tel) THEN
    RETURN public.fz_resultado(false, 'Este WhatsApp já está vinculado a outra conta. Fale com o suporte.');
  END IF;

  SELECT * INTO v_ass FROM public.assinaturas
   WHERE lower(email) = v_email AND status IN ('Ativo', 'Cancelado')
   ORDER BY ultimo_evento_em DESC NULLS LAST, created_at DESC LIMIT 1;
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
