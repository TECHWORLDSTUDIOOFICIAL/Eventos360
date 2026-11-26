-- =====================================================================
-- Eventos360 · Etapa 1 · Autorización multi-tenant y RLS
-- Todas las funciones auxiliares son SECURITY DEFINER en el esquema
-- `private` (no expuesto por PostgREST) con search_path vacío.
-- =====================================================================

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa
    join public.profiles p on p.id = pa.user_id
    where pa.user_id = (select auth.uid()) and not p.is_disabled
  );
$$;

create or replace function private.is_platform_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = (select auth.uid()) and role = 'owner'
  );
$$;

-- Workspaces a los que pertenece el usuario actual (activos y con perfil habilitado).
create or replace function private.user_workspace_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.workspace_id
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = (select auth.uid()) and not w.is_disabled and not p.is_disabled;
$$;

create or replace function private.has_ws_role(p_ws uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_ws and m.user_id = (select auth.uid())
      and m.role = any(p_roles) and not w.is_disabled and not p.is_disabled
  );
$$;

-- ¿La suscripción permite escribir? (trialing/active, o past_due dentro del período de gracia)
create or replace function private.ws_is_writable(p_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    join public.workspaces w on w.id = s.workspace_id
    where s.workspace_id = p_ws and not w.is_disabled
      and s.status in ('trialing', 'active', 'past_due')
  );
$$;

-- Escritura: rol + suscripción vigente. Para usar en políticas de tablas de negocio.
create or replace function private.can_write(p_ws uuid, p_roles public.member_role[]
  default array['owner','admin','manager','staff','collaborator']::public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_ws_role(p_ws, p_roles) and private.ws_is_writable(p_ws);
$$;

-- ---------------------------------------------------------------------
-- Entitlements del plan
-- ---------------------------------------------------------------------
create or replace function private.ws_entitlement(p_ws uuid, p_feature text)
returns table (is_enabled boolean, limit_value int)
language sql stable security definer set search_path = '' as $$
  select coalesce(e.is_enabled, false), e.limit_value
  from public.subscriptions s
  left join public.plan_entitlements e on e.plan_id = s.plan_id and e.feature_key = p_feature
  where s.workspace_id = p_ws;
$$;

create or replace function private.ws_feature_enabled(p_ws uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_enabled from private.ws_entitlement(p_ws, p_feature)), false);
$$;

-- Lanza error si agregar p_adding elementos supera el límite del plan.
-- Uso previsto en triggers BEFORE INSERT de tablas limitadas (eventos, clientes, etc.).
create or replace function private.enforce_limit(p_ws uuid, p_feature text, p_current bigint, p_adding int default 1)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_enabled boolean; v_limit int;
begin
  select is_enabled, limit_value into v_enabled, v_limit from private.ws_entitlement(p_ws, p_feature);
  if not coalesce(v_enabled, false) then
    raise exception 'Tu plan no incluye esta funcionalidad (%).', p_feature using errcode = 'P0001', hint = 'plan_feature_disabled';
  end if;
  if v_limit is not null and p_current + p_adding > v_limit then
    raise exception 'Alcanzaste el límite de tu plan (% de %).', p_current, v_limit using errcode = 'P0001', hint = 'plan_limit_reached';
  end if;
end $$;

-- Módulos efectivos de un workspace (base para navegación y para RLS de módulos).
create or replace function private.ws_modules(p_ws uuid)
returns table (module_key text, label text, sort int)
language sql stable security definer set search_path = '' as $$
  with ws as (select id, kind from public.workspaces where id = p_ws),
  spec as (
    select sm.module_key, sm.label_override, sm.sort, ws_s.is_primary
    from public.workspace_specialties ws_s
    join public.specialty_modules sm on sm.specialty_key = ws_s.specialty_key
    where ws_s.workspace_id = p_ws
  ),
  candidates as (
    select m.key, m.name, m.sort as base_sort, m.required_feature,
           (ws.kind = any(m.default_kinds)) as is_default,
           (select s.label_override from spec s where s.module_key = m.key and s.label_override is not null
              order by s.is_primary desc limit 1) as label_override,
           (select min(s.sort + case when s.is_primary then 0 else 1000 end) from spec s where s.module_key = m.key) as spec_sort,
           (select o.is_enabled from public.workspace_modules o where o.workspace_id = p_ws and o.module_key = m.key) as override
    from public.modules m, ws
    where m.is_active and ws.kind = any(m.kinds)
  )
  select c.key, coalesce(c.label_override, c.name),
         case when c.is_default then c.base_sort else coalesce(c.spec_sort, 5000) + 100 end
  from candidates c
  where coalesce(c.override, c.is_default or c.spec_sort is not null)
    and (c.required_feature is null or private.ws_feature_enabled(p_ws, c.required_feature));
$$;

create or replace function private.ws_has_module(p_ws uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.ws_modules(p_ws) where module_key = p_module);
$$;

-- Funciones públicas de consulta para el frontend (verifican pertenencia).
create or replace function public.workspace_modules_for(p_ws uuid)
returns table (module_key text, label text, sort int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_ws in (select private.user_workspace_ids()) or private.is_platform_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query select * from private.ws_modules(p_ws) order by 3, 2;
end $$;

create or replace function public.workspace_entitlements_for(p_ws uuid)
returns table (feature_key text, is_enabled boolean, limit_value int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_ws in (select private.user_workspace_ids()) or private.is_platform_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query
    select f.key, coalesce(e.is_enabled, false), e.limit_value
    from public.features f
    left join public.subscriptions s on s.workspace_id = p_ws
    left join public.plan_entitlements e on e.plan_id = s.plan_id and e.feature_key = f.key;
end $$;

grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function public.workspace_modules_for(uuid), public.workspace_entitlements_for(uuid) from public, anon;
grant execute on function public.workspace_modules_for(uuid), public.workspace_entitlements_for(uuid) to authenticated;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.currencies              enable row level security;
alter table public.countries               enable row level security;
alter table public.platform_settings       enable row level security;
alter table public.profiles                enable row level security;
alter table public.platform_admins         enable row level security;
alter table public.features                enable row level security;
alter table public.modules                 enable row level security;
alter table public.specialties             enable row level security;
alter table public.specialty_modules       enable row level security;
alter table public.plans                   enable row level security;
alter table public.plan_entitlements       enable row level security;
alter table public.workspaces              enable row level security;
alter table public.workspace_members       enable row level security;
alter table public.workspace_specialties   enable row level security;
alter table public.workspace_modules       enable row level security;
alter table public.manual_payments         enable row level security;
alter table public.subscriptions           enable row level security;
alter table public.subscription_history    enable row level security;
alter table public.access_codes            enable row level security;
alter table public.access_code_redemptions enable row level security;
alter table public.code_attempts           enable row level security;
alter table public.audit_logs              enable row level security;

-- Privilegios base: nada para anon salvo catálogo público; escrituras solo vía políticas/RPC.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.currencies, public.countries, public.platform_settings,
  public.features, public.modules, public.specialties, public.specialty_modules,
  public.plans, public.plan_entitlements to anon, authenticated;
grant select on public.profiles, public.platform_admins, public.workspaces, public.workspace_members,
  public.workspace_specialties, public.workspace_modules, public.manual_payments, public.subscriptions,
  public.subscription_history, public.access_codes, public.access_code_redemptions, public.audit_logs
  to authenticated;
-- Escrituras de catálogo y planes: solo administradores (validado por RLS).
grant insert, update, delete on public.currencies, public.countries, public.platform_settings,
  public.features, public.modules, public.specialties, public.specialty_modules,
  public.plans, public.plan_entitlements to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant update (name, currency_code, timezone, locale, tax_rate) on public.workspaces to authenticated;

-- Catálogo de referencia: lectura pública, escritura de administradores.
create policy "catalogo lectura" on public.currencies for select to anon, authenticated using (true);
create policy "catalogo admin" on public.currencies for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "catalogo lectura" on public.countries for select to anon, authenticated using (true);
create policy "catalogo admin" on public.countries for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "catalogo lectura" on public.platform_settings for select to anon, authenticated using (true);
create policy "catalogo admin" on public.platform_settings for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "catalogo lectura" on public.features for select to anon, authenticated using (true);
create policy "catalogo admin" on public.features for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "catalogo lectura" on public.modules for select to anon, authenticated using (true);
create policy "catalogo admin" on public.modules for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "catalogo lectura" on public.specialties for select to anon, authenticated using (true);
create policy "catalogo admin" on public.specialties for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "catalogo lectura" on public.specialty_modules for select to anon, authenticated using (true);
create policy "catalogo admin" on public.specialty_modules for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());

-- Planes: públicos y activos visibles para todos; el resto solo admin.
create policy "planes publicos anon" on public.plans for select to anon
  using (is_public and is_active);
create policy "planes publicos" on public.plans for select to authenticated
  using ((is_public and is_active) or private.is_platform_admin()
         or id in (select s.plan_id from public.subscriptions s where s.workspace_id in (select private.user_workspace_ids())));
create policy "planes admin" on public.plans for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "entitlements lectura" on public.plan_entitlements for select to anon, authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id));
create policy "entitlements admin" on public.plan_entitlements for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());

-- Perfiles: el propio, los compañeros de workspace y administradores.
create policy "perfil lectura" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_platform_admin()
    or exists (select 1 from public.workspace_members m
               where m.user_id = profiles.id and m.workspace_id in (select private.user_workspace_ids()))
  );
create policy "perfil propio actualiza" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "admins lectura" on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());

-- Workspaces
create policy "ws lectura" on public.workspaces for select to authenticated
  using (id in (select private.user_workspace_ids()) or private.is_platform_admin());
create policy "ws actualiza" on public.workspaces for update to authenticated
  using (private.can_write(id, array['owner','admin']::public.member_role[]))
  with check (private.can_write(id, array['owner','admin']::public.member_role[]));

create policy "miembros lectura" on public.workspace_members for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()) or private.is_platform_admin());

create policy "especialidades ws lectura" on public.workspace_specialties for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()) or private.is_platform_admin());
create policy "modulos ws lectura" on public.workspace_modules for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()) or private.is_platform_admin());

-- Facturación: propietarios/administradores del workspace y admins de plataforma.
create policy "suscripcion lectura" on public.subscriptions for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()) or private.is_platform_admin());
create policy "historial lectura" on public.subscription_history for select to authenticated
  using (private.has_ws_role(workspace_id, array['owner','admin']::public.member_role[]) or private.is_platform_admin());
create policy "pagos lectura" on public.manual_payments for select to authenticated
  using ((workspace_id is not null and private.has_ws_role(workspace_id, array['owner','admin']::public.member_role[]))
         or private.is_platform_admin());

-- Solo administradores de plataforma.
create policy "codigos admin" on public.access_codes for select to authenticated using (private.is_platform_admin());
create policy "canjes admin" on public.access_code_redemptions for select to authenticated using (private.is_platform_admin());
create policy "auditoria lectura" on public.audit_logs for select to authenticated
  using (private.is_platform_admin()
         or (workspace_id is not null and private.has_ws_role(workspace_id, array['owner','admin']::public.member_role[])));
-- code_attempts: sin políticas => inaccesible desde la API (solo service_role).
