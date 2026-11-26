-- =====================================================================
-- Eventos360 · Etapa 1 · Códigos de acceso, alta de cuentas,
-- renovaciones y operaciones administrativas (todo validado en servidor)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Códigos: normalización, hash y generación
-- ---------------------------------------------------------------------
-- Acepta "e360-abcd-efgh-..." con o sin guiones/espacios.
create or replace function private.normalize_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), '^E360', '');
$$;

create or replace function private.hash_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(private.normalize_code(p_code), 'sha256'), 'hex');
$$;

-- 16 caracteres de un alfabeto sin ambigüedades (31 símbolos ≈ 79 bits).
create or replace function private.random_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(16);
  v_out text := '';
  i int;
begin
  for i in 0..15 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
    if i in (3, 7, 11) then v_out := v_out || '-'; end if;
  end loop;
  return 'E360-' || v_out;
end $$;

-- Núcleo de creación (sin verificación de rol; solo lo llaman funciones verificadas o el dueño de la BD).
create or replace function private.create_access_code(
  p_purpose public.access_code_purpose,
  p_kind public.workspace_kind,
  p_plan_id uuid,
  p_duration_days int,
  p_specialty_keys text[],
  p_label text,
  p_expires_at timestamptz,
  p_target_workspace_id uuid,
  p_payment_id uuid,
  p_max_uses int,
  p_created_by uuid
) returns table (id uuid, code text)
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_id uuid; v_ws_kind public.workspace_kind;
begin
  if p_specialty_keys is not null and cardinality(p_specialty_keys) > 0 then
    if p_kind is distinct from 'business' then
      raise exception 'Las especialidades solo aplican a Eventos360 Business';
    end if;
    if exists (select 1 from unnest(p_specialty_keys) k
               where k not in (select s.key from public.specialties s where s.is_active)) then
      raise exception 'Especialidad no válida';
    end if;
  end if;
  if p_target_workspace_id is not null then
    select w.kind into v_ws_kind from public.workspaces w where w.id = p_target_workspace_id;
    if v_ws_kind is distinct from p_kind then
      raise exception 'El espacio de trabajo destino no corresponde a la modalidad del plan';
    end if;
  end if;

  v_code := private.random_code();
  insert into public.access_codes(code_hash, code_hint, purpose, kind, plan_id, duration_days, specialty_keys,
    target_workspace_id, payment_id, label, max_uses, expires_at, created_by)
  values (private.hash_code(v_code), right(v_code, 4), p_purpose, p_kind, p_plan_id, p_duration_days,
    coalesce(p_specialty_keys, '{}'), p_target_workspace_id, p_payment_id, nullif(trim(p_label), ''),
    coalesce(p_max_uses, 1), coalesce(p_expires_at, now() + interval '30 days'), p_created_by)
  returning access_codes.id into v_id;

  return query select v_id, v_code;
end $$;

-- RPC para el panel admin. Devuelve el código en claro UNA sola vez.
create or replace function public.admin_create_access_code(
  p_purpose public.access_code_purpose,
  p_plan_id uuid default null,
  p_duration_days int default null,
  p_specialty_keys text[] default '{}',
  p_label text default null,
  p_expires_at timestamptz default null,
  p_target_workspace_id uuid default null,
  p_payment_id uuid default null,
  p_max_uses int default 1
) returns table (id uuid, code text)
language plpgsql security definer set search_path = '' as $$
declare v_kind public.workspace_kind; v_res record;
begin
  if not private.is_platform_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_purpose = 'platform_admin' and not private.is_platform_owner() then
    raise exception 'Solo el propietario de la plataforma puede crear códigos de administrador' using errcode = '42501';
  end if;
  if p_purpose <> 'platform_admin' then
    select pl.kind into v_kind from public.plans pl where pl.id = p_plan_id and pl.is_active;
    if v_kind is null then raise exception 'Plan no válido o inactivo'; end if;
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'La fecha de vencimiento del código debe ser futura';
  end if;

  select * into v_res from private.create_access_code(
    p_purpose, v_kind, case when p_purpose = 'platform_admin' then null else p_plan_id end,
    p_duration_days, p_specialty_keys, p_label, p_expires_at, p_target_workspace_id,
    p_payment_id, p_max_uses, auth.uid());

  perform private.audit('access_code.created', 'access_code', v_res.id::text, p_target_workspace_id,
    jsonb_build_object('purpose', p_purpose, 'plan_id', p_plan_id, 'label', p_label));
  return query select v_res.id, v_res.code;
end $$;

create or replace function public.admin_revoke_access_code(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.access_codes set status = 'revoked', revoked_at = now()
  where id = p_id and status = 'active';
  if not found then raise exception 'El código no existe o ya no está activo'; end if;
  perform private.audit('access_code.revoked', 'access_code', p_id::text);
end $$;

-- Busca y bloquea un código. No lanza excepciones: devuelve el motivo del rechazo
-- para que el intento fallido quede registrado (una excepción revertiría el registro).
create or replace function private.find_code(p_code text, p_purposes public.access_code_purpose[])
returns table (code_id uuid, error text)
language plpgsql security definer set search_path = '' as $$
declare v public.access_codes;
begin
  select * into v from public.access_codes ac where ac.code_hash = private.hash_code(p_code) for update;
  if v.id is null or not (v.purpose = any(p_purposes)) then
    return query select null::uuid, 'code_invalid'::text; return;
  end if;
  if v.status <> 'active' or v.use_count >= v.max_uses then
    return query select null::uuid, 'code_used'::text; return;
  end if;
  if v.expires_at <= now() then
    return query select null::uuid, 'code_expired'::text; return;
  end if;
  return query select v.id, null::text;
end $$;

create or replace function private.code_error_message(p_error text)
returns text language sql immutable set search_path = '' as $$
  select case p_error
    when 'code_invalid' then 'Código no válido'
    when 'code_used' then 'Este código ya fue utilizado o fue anulado'
    when 'code_expired' then 'Este código venció'
    when 'too_many_attempts' then 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.'
    else 'No se pudo validar el código' end;
$$;

create or replace function private.consume_code(p_code_id uuid, p_user uuid, p_ws uuid)
returns void language sql security definer set search_path = '' as $$
  update public.access_codes
     set use_count = use_count + 1,
         status = case when use_count + 1 >= max_uses then 'used'::public.access_code_status else status end
   where id = p_code_id;
  insert into public.access_code_redemptions(access_code_id, user_id, workspace_id) values (p_code_id, p_user, p_ws);
$$;

-- ---------------------------------------------------------------------
-- Limitación de intentos (fuerza bruta)
-- ---------------------------------------------------------------------
create or replace function private.attempts_exceeded(p_actor text, p_max int default 8, p_window interval default '15 minutes')
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.code_attempts
          where actor = p_actor and not succeeded and created_at > now() - p_window) >= p_max;
$$;

create or replace function private.log_attempt(p_actor text, p_ok boolean)
returns void language sql security definer set search_path = '' as $$
  insert into public.code_attempts(actor, succeeded) values (p_actor, p_ok);
  delete from public.code_attempts where created_at < now() - interval '2 days';
$$;

-- ---------------------------------------------------------------------
-- Alta de cuentas (solo service_role: lo usa la Edge Function `signup`)
-- ---------------------------------------------------------------------
create or replace function public.svc_check_code(p_code text, p_actor text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.access_codes; v_code_id uuid; v_err text; v_plan public.plans; v_max int;
begin
  if private.attempts_exceeded(p_actor) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts', 'message', private.code_error_message('too_many_attempts'));
  end if;
  select f.code_id, f.error into v_code_id, v_err from private.find_code(p_code, array['signup','platform_admin']::public.access_code_purpose[]) f;
  select * into v from public.access_codes where id = v_code_id;
  if v_err is not null then
    perform private.log_attempt(p_actor, false);
    return jsonb_build_object('ok', false, 'error', v_err, 'message', private.code_error_message(v_err));
  end if;
  if v.purpose = 'platform_admin' then
    return jsonb_build_object('ok', true, 'purpose', 'platform_admin');
  end if;
  select * into v_plan from public.plans where id = v.plan_id;
  select e.limit_value into v_max from public.plan_entitlements e
    where e.plan_id = v.plan_id and e.feature_key = 'specialties.max' and e.is_enabled;
  return jsonb_build_object(
    'ok', true,
    'purpose', 'signup',
    'kind', v.kind,
    'plan_name', v_plan.name,
    'duration_days', coalesce(v.duration_days, v_plan.duration_days),
    'preset_specialties', to_jsonb(v.specialty_keys),
    'specialties_max', coalesce(v_max, 1)
  );
end $$;

create or replace function public.svc_complete_signup(
  p_code text,
  p_actor text,
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_phone text,
  p_workspace_name text,
  p_specialties text[]       -- el primero es la especialidad principal
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.access_codes;
  v_plan public.plans;
  v_ws uuid;
  v_days int;
  v_specs text[];
  v_max int;
  v_end timestamptz;
  v_err text;
  v_code_id uuid;
begin
  select f.code_id, f.error into v_code_id, v_err from private.find_code(p_code, array['signup','platform_admin']::public.access_code_purpose[]) f;
  select * into v from public.access_codes where id = v_code_id;
  if v_err is not null then
    -- La Edge Function ya registró el usuario de Auth y lo elimina al recibir este error.
    raise exception '%', private.code_error_message(v_err) using errcode = 'P0001', hint = v_err;
  end if;

  insert into public.profiles(id, username, full_name, phone)
  values (p_user_id, lower(p_username), trim(p_full_name), nullif(trim(p_phone), ''));

  if v.purpose = 'platform_admin' then
    insert into public.platform_admins(user_id, role) values (p_user_id, 'admin');
    perform private.consume_code(v.id, p_user_id, null);
    perform private.log_attempt(p_actor, true);
    insert into public.audit_logs(actor_id, action, entity, entity_id)
      values (p_user_id, 'platform_admin.created', 'profile', p_user_id::text);
    return jsonb_build_object('purpose', 'platform_admin');
  end if;

  select * into v_plan from public.plans where id = v.plan_id;
  v_days := coalesce(v.duration_days, v_plan.duration_days);

  insert into public.workspaces(kind, name, created_by)
  values (v.kind, trim(p_workspace_name), p_user_id) returning id into v_ws;
  insert into public.workspace_members(workspace_id, user_id, role) values (v_ws, p_user_id, 'owner');

  if v.kind = 'business' then
    -- Sin duplicados y conservando el orden (el primero es el principal).
    v_specs := array(select k from unnest(case when cardinality(v.specialty_keys) > 0 then v.specialty_keys
                                               else coalesce(p_specialties, '{}') end)
                     with ordinality t(k, n) group by k order by min(n));
    if exists (select 1 from unnest(v_specs) k where k not in (select s.key from public.specialties s where s.is_active)) then
      raise exception 'Especialidad no válida' using errcode = 'P0001';
    end if;
    if coalesce(cardinality(v_specs), 0) = 0 then
      raise exception 'Selecciona la especialidad principal de tu empresa' using errcode = 'P0001';
    end if;
    select e.limit_value into v_max from public.plan_entitlements e
      where e.plan_id = v.plan_id and e.feature_key = 'specialties.max' and e.is_enabled;
    if cardinality(v_specs) > coalesce(v_max, 1) then
      raise exception 'Tu plan permite hasta % especialidad(es)', coalesce(v_max, 1) using errcode = 'P0001';
    end if;
    insert into public.workspace_specialties(workspace_id, specialty_key, is_primary)
    select v_ws, k, n = 1 from unnest(v_specs) with ordinality t(k, n);
  end if;

  v_end := now() + make_interval(days => v_days);
  insert into public.subscriptions(workspace_id, workspace_kind, plan_id, status, current_period_start, current_period_end)
  values (v_ws, v.kind, v.plan_id, 'active', now(), v_end);
  insert into public.subscription_history(workspace_id, plan_id, action, status, period_end, days_added, access_code_id, payment_id, actor_id)
  values (v_ws, v.plan_id, 'created', 'active', v_end, v_days, v.id, v.payment_id, p_user_id);
  if v.payment_id is not null then
    update public.manual_payments set workspace_id = v_ws where id = v.payment_id and workspace_id is null;
  end if;

  perform private.consume_code(v.id, p_user_id, v_ws);
  perform private.log_attempt(p_actor, true);
  insert into public.audit_logs(workspace_id, actor_id, action, entity, entity_id, details)
    values (v_ws, p_user_id, 'workspace.created', 'workspace', v_ws::text, jsonb_build_object('kind', v.kind, 'plan', v_plan.key));

  return jsonb_build_object('purpose', 'signup', 'workspace_id', v_ws, 'kind', v.kind);
end $$;

create or replace function public.svc_log_attempt(p_actor text, p_ok boolean)
returns void language sql security definer set search_path = '' as $$
  select private.log_attempt(p_actor, p_ok);
$$;

revoke execute on function public.svc_check_code(text, text),
  public.svc_complete_signup(text, text, uuid, text, text, text, text, text[]),
  public.svc_log_attempt(text, boolean) from public, anon, authenticated;
grant execute on function public.svc_check_code(text, text),
  public.svc_complete_signup(text, text, uuid, text, text, text, text, text[]),
  public.svc_log_attempt(text, boolean) to service_role;
