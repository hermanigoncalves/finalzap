-- ============================================================
-- Seed: dados de exemplo para desenvolvimento local (modelo em inglês, legado)
-- Não cria usuário nem senha. Crie o usuário de dev pelo Supabase Auth (signup/Studio)
-- e rode com o id dele:  select set_config('seed.user_id', '<uuid do usuário>', false);
-- Sem o usuário, nada é inserido.
-- ============================================================
do $$
declare
  v_user_id uuid := nullif(current_setting('seed.user_id', true), '')::uuid;
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise notice 'seed ignorado: defina seed.user_id com um usuário existente em auth.users';
    return;
  end if;

  insert into public.profiles (id, first_name, last_name, phone)
  values (v_user_id, 'Dev', 'User', '+55 11 99999-9999')
  on conflict (id) do nothing;

  perform public.seed_default_categories(v_user_id);

  insert into public.accounts (user_id, name, type, balance, color) values
    (v_user_id, 'Nubank',          'Conta Corrente', 2272.50, 'bg-slate-800'),
    (v_user_id, 'Inter PJ',        'Conta PJ',       8320.00, 'bg-orange-500'),
    (v_user_id, 'Carteira Física', 'Dinheiro',        120.00, 'bg-green-600');
end $$;
