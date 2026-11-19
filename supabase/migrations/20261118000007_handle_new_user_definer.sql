-- No banco, handle_new_user perdeu o SECURITY DEFINER: o gatilho roda como o usuário interno do Auth,
-- que não grava em profiles (RLS sem regra de INSERT), e todo cadastro novo (Google ou e-mail) falha
-- com "Database error saving new user". Restaura a definição original da migração 20260311000001.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Só o gatilho chama esta função.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
