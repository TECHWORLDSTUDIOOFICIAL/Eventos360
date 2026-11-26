-- El primer administrador de plataforma registrado queda como propietario (bootstrap).
create or replace function private.first_admin_is_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('eventos360.platform_admins.bootstrap'));
  if not exists (select 1 from public.platform_admins) then
    new.role := 'owner';
  end if;
  return new;
end $$;
revoke execute on function private.first_admin_is_owner() from public, anon, authenticated;

create trigger platform_admins_bootstrap before insert on public.platform_admins
  for each row execute function private.first_admin_is_owner();
