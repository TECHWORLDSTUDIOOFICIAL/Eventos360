-- =====================================================================
-- Eventos360 · Etapa 1 · Suscripciones, renovaciones y panel administrativo
-- =====================================================================

-- ---------------------------------------------------------------------
-- Suscripciones: extensión común
-- ---------------------------------------------------------------------
create or replace function private.extend_subscription(
  p_ws uuid, p_plan_id uuid, p_days int, p_code_id uuid, p_payment_id uuid, p_notes text, p_action text
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_sub public.subscriptions; v_end timestamptz;
begin
  if p_days is null or p_days < 1 or p_days > 3660 then raise exception 'Cantidad de días no válida'; end if;
  select * into v_sub from public.subscriptions where workspace_id = p_ws for update;
  if v_sub.id is null then raise exception 'El espacio de trabajo no tiene suscripción'; end if;

  v_end := greatest(v_sub.current_period_end, now()) + make_interval(days => p_days);
  update public.subscriptions
     set plan_id = coalesce(p_plan_id, plan_id),
         status = 'active',
         current_period_start = case when current_period_end < now() then now() else current_period_start end,
         current_period_end = v_end,
         suspended_at = null,
         canceled_at = null
   where id = v_sub.id;
  insert into public.subscription_history(workspace_id, plan_id, action, status, period_end, days_added, access_code_id, payment_id, actor_id, notes)
  values (p_ws, coalesce(p_plan_id, v_sub.plan_id), p_action, 'active', v_end, p_days, p_code_id, p_payment_id, auth.uid(), p_notes);
  if p_payment_id is not null then
    update public.manual_payments set workspace_id = p_ws where id = p_payment_id and workspace_id is null;
  end if;
  return v_end;
end $$;

-- Renovación por el cliente con un código (propietario/administrador del workspace).
create or replace function public.redeem_renewal_code(p_workspace_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.access_codes; v_code_id uuid; v_err text; v_kind public.workspace_kind; v_plan public.plans; v_end timestamptz; v_actor text;
begin
  if not private.has_ws_role(p_workspace_id, array['owner','admin']::public.member_role[]) then
    raise exception 'Solo el propietario o un administrador puede renovar' using errcode = '42501';
  end if;
  v_actor := 'user:' || auth.uid()::text;
  if private.attempts_exceeded(v_actor) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts', 'message', private.code_error_message('too_many_attempts'));
  end if;
  select f.code_id, f.error into v_code_id, v_err from private.find_code(p_code, array['renewal']::public.access_code_purpose[]) f;
  select * into v from public.access_codes where id = v_code_id;
  if v_err is null then
    select kind into v_kind from public.workspaces where id = p_workspace_id;
    if v.kind <> v_kind or (v.target_workspace_id is not null and v.target_workspace_id <> p_workspace_id) then
      v_err := 'code_invalid';
    end if;
  end if;
  if v_err is not null then
    perform private.log_attempt(v_actor, false);
    return jsonb_build_object('ok', false, 'error', v_err, 'message', private.code_error_message(v_err));
  end if;
  select * into v_plan from public.plans where id = v.plan_id;
  v_end := private.extend_subscription(p_workspace_id, v.plan_id, coalesce(v.duration_days, v_plan.duration_days),
                                       v.id, v.payment_id, null, 'renewed');
  perform private.consume_code(v.id, auth.uid(), p_workspace_id);
  perform private.log_attempt(v_actor, true);
  perform private.audit('subscription.renewed', 'subscription', p_workspace_id::text, p_workspace_id,
    jsonb_build_object('plan', v_plan.key, 'period_end', v_end));
  return jsonb_build_object('ok', true, 'plan_name', v_plan.name, 'period_end', v_end);
end $$;

-- Cambio de contraseña obligatorio completado.
create or replace function public.clear_must_change_password()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

-- Espacios del usuario con su estado de suscripción.
create or replace function public.my_workspaces()
returns table (id uuid, kind public.workspace_kind, name text, role public.member_role, is_disabled boolean,
               subscription_status public.subscription_status, period_end timestamptz, plan_name text,
               primary_specialty text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.kind, w.name, m.role, w.is_disabled, s.status, s.current_period_end, p.name,
         (select sp.name from public.workspace_specialties ws_s join public.specialties sp on sp.key = ws_s.specialty_key
          where ws_s.workspace_id = w.id and ws_s.is_primary)
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  left join public.subscriptions s on s.workspace_id = w.id
  left join public.plans p on p.id = s.plan_id
  where m.user_id = auth.uid()
  order by w.created_at;
$$;

-- ---------------------------------------------------------------------
-- Operaciones del panel administrativo
-- ---------------------------------------------------------------------
create or replace function public.admin_record_payment(
  p_payer_name text, p_amount numeric, p_currency text, p_method text,
  p_workspace_id uuid default null, p_payer_phone text default null, p_bank text default null,
  p_reference text default null, p_paid_at date default current_date, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  insert into public.manual_payments(workspace_id, payer_name, payer_phone, amount, currency_code, method, bank, reference, paid_at, notes, recorded_by)
  values (p_workspace_id, trim(p_payer_name), nullif(trim(p_payer_phone), ''), p_amount, upper(p_currency), p_method,
          nullif(trim(p_bank), ''), nullif(trim(p_reference), ''), coalesce(p_paid_at, current_date), nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;
  perform private.audit('payment.recorded', 'manual_payment', v_id::text, p_workspace_id,
    jsonb_build_object('amount', p_amount, 'currency', upper(p_currency), 'method', p_method));
  return v_id;
end $$;

create or replace function public.admin_extend_subscription(
  p_workspace_id uuid, p_days int, p_plan_id uuid default null, p_payment_id uuid default null, p_notes text default null
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_end timestamptz;
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_plan_id is not null and not exists (
      select 1 from public.plans pl join public.workspaces w on w.kind = pl.kind
      where pl.id = p_plan_id and w.id = p_workspace_id) then
    raise exception 'El plan no corresponde a la modalidad del espacio de trabajo';
  end if;
  v_end := private.extend_subscription(p_workspace_id, p_plan_id, p_days, null, p_payment_id, p_notes, 'extended');
  perform private.audit('subscription.extended', 'subscription', p_workspace_id::text, p_workspace_id,
    jsonb_build_object('days', p_days, 'plan_id', p_plan_id, 'period_end', v_end));
  return v_end;
end $$;

create or replace function public.admin_change_plan(p_workspace_id uuid, p_plan_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.subscriptions set plan_id = p_plan_id where workspace_id = p_workspace_id; -- FK (plan, kind) valida la modalidad
  if not found then raise exception 'El espacio de trabajo no tiene suscripción'; end if;
  insert into public.subscription_history(workspace_id, plan_id, action, actor_id, notes)
  values (p_workspace_id, p_plan_id, 'plan_changed', auth.uid(), p_notes);
  perform private.audit('subscription.plan_changed', 'subscription', p_workspace_id::text, p_workspace_id,
    jsonb_build_object('plan_id', p_plan_id));
end $$;

create or replace function public.admin_set_subscription_status(
  p_workspace_id uuid, p_status public.subscription_status, p_notes text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.subscriptions
     set status = p_status,
         suspended_at = case when p_status = 'suspended' then now() else null end,
         canceled_at = case when p_status = 'canceled' then now() else null end
   where workspace_id = p_workspace_id;
  if not found then raise exception 'El espacio de trabajo no tiene suscripción'; end if;
  insert into public.subscription_history(workspace_id, action, status, actor_id, notes)
  values (p_workspace_id, 'status_changed', p_status, auth.uid(), p_notes);
  perform private.audit('subscription.status_changed', 'subscription', p_workspace_id::text, p_workspace_id,
    jsonb_build_object('status', p_status, 'notes', p_notes));
end $$;

create or replace function public.admin_set_workspace_disabled(p_workspace_id uuid, p_disabled boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.workspaces set is_disabled = p_disabled where id = p_workspace_id;
  if not found then raise exception 'Espacio de trabajo no encontrado'; end if;
  perform private.audit(case when p_disabled then 'workspace.disabled' else 'workspace.enabled' end,
    'workspace', p_workspace_id::text, p_workspace_id, jsonb_build_object('notes', p_notes));
end $$;

-- Listado de cuentas para el panel (une datos que RLS separa por tabla).
create or replace function public.admin_list_workspaces(p_search text default null, p_kind public.workspace_kind default null)
returns table (id uuid, kind public.workspace_kind, name text, is_disabled boolean, created_at timestamptz,
               owner_id uuid, owner_username text, owner_name text, owner_phone text,
               plan_id uuid, plan_name text, subscription_status public.subscription_status, period_end timestamptz,
               specialties text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select w.id, w.kind, w.name, w.is_disabled, w.created_at,
         o.id, o.username::text, o.full_name, o.phone,
         s.plan_id, p.name, s.status, s.current_period_end,
         array(select ws_s.specialty_key from public.workspace_specialties ws_s
               where ws_s.workspace_id = w.id order by ws_s.is_primary desc, ws_s.specialty_key)
  from public.workspaces w
  left join lateral (select pr.* from public.workspace_members m join public.profiles pr on pr.id = m.user_id
                     where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1) o on true
  left join public.subscriptions s on s.workspace_id = w.id
  left join public.plans p on p.id = s.plan_id
  where (p_kind is null or w.kind = p_kind)
    and (p_search is null or p_search = '' or w.name ilike '%' || p_search || '%'
         or o.username::text ilike '%' || p_search || '%' or o.full_name ilike '%' || p_search || '%'
         or o.phone ilike '%' || p_search || '%')
  order by w.created_at desc
  limit 500;
end $$;

create or replace function public.admin_list_users(p_search text default null)
returns table (id uuid, username text, full_name text, phone text, is_disabled boolean, must_change_password boolean,
               created_at timestamptz, platform_role public.platform_role, workspaces bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select pr.id, pr.username::text, pr.full_name, pr.phone, pr.is_disabled, pr.must_change_password, pr.created_at,
         pa.role, (select count(*) from public.workspace_members m where m.user_id = pr.id)
  from public.profiles pr
  left join public.platform_admins pa on pa.user_id = pr.id
  where p_search is null or p_search = '' or pr.username::text ilike '%' || p_search || '%'
        or pr.full_name ilike '%' || p_search || '%' or pr.phone ilike '%' || p_search || '%'
  order by pr.created_at desc
  limit 500;
end $$;

-- Métricas reales (sin datos ficticios).
create or replace function public.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'users_total', (select count(*) from public.profiles where id not in (select user_id from public.platform_admins)),
    'users_active_30d', (select count(*) from auth.users u where u.last_sign_in_at > now() - interval '30 days'
                          and u.id not in (select user_id from public.platform_admins)),
    'workspaces_total', (select count(*) from public.workspaces),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.workspaces group by kind) t), '{}'),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.subscriptions group by status) t), '{}'),
    'by_specialty', coalesce((select jsonb_object_agg(specialty_key, n) from (
        select specialty_key, count(*) n from public.workspace_specialties where is_primary group by specialty_key) t), '{}'),
    -- MRR estimado: precio del plan normalizado a 30 días, solo suscripciones activas (por moneda del plan).
    'mrr_by_currency', coalesce((select jsonb_object_agg(currency_code, round(total, 2)) from (
        select p.currency_code, sum(p.price * 30.0 / p.duration_days) total
        from public.subscriptions s join public.plans p on p.id = s.plan_id
        where s.status in ('active', 'trialing') group by p.currency_code) t), '{}'),
    'payments_30d_by_currency', coalesce((select jsonb_object_agg(currency_code, total) from (
        select currency_code, sum(amount) total from public.manual_payments
        where paid_at > current_date - 30 group by currency_code) t), '{}'),
    'expiring_7d', (select count(*) from public.subscriptions
                    where status in ('active','trialing') and current_period_end between now() and now() + interval '7 days'),
    'new_workspaces_30d', (select count(*) from public.workspaces where created_at > now() - interval '30 days'),
    'canceled_30d', (select count(*) from public.subscription_history
                     where action = 'status_changed' and status = 'canceled' and created_at > now() - interval '30 days')
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Vencimientos automáticos: active → past_due (gracia) → suspended
-- ---------------------------------------------------------------------
create or replace function private.refresh_subscription_statuses()
returns void language plpgsql security definer set search_path = '' as $$
declare v_grace int := coalesce((select (value #>> '{}')::int from public.platform_settings where key = 'billing.grace_days'), 5);
begin
  with moved as (
    update public.subscriptions set status = 'past_due'
    where status in ('active', 'trialing') and current_period_end < now()
    returning workspace_id
  )
  insert into public.subscription_history(workspace_id, action, status, notes)
  select workspace_id, 'status_changed', 'past_due', 'Vencimiento automático' from moved;

  with moved as (
    update public.subscriptions set status = 'suspended', suspended_at = now()
    where status = 'past_due' and current_period_end + make_interval(days => v_grace) < now()
    returning workspace_id
  )
  insert into public.subscription_history(workspace_id, action, status, notes)
  select workspace_id, 'status_changed', 'suspended', 'Suspensión automática por falta de renovación' from moved;
end $$;

-- Permisos de ejecución de RPC públicas
revoke execute on function
  public.admin_create_access_code(public.access_code_purpose, uuid, int, text[], text, timestamptz, uuid, uuid, int),
  public.admin_revoke_access_code(uuid),
  public.redeem_renewal_code(uuid, text),
  public.clear_must_change_password(),
  public.my_workspaces(),
  public.admin_record_payment(text, numeric, text, text, uuid, text, text, text, date, text),
  public.admin_extend_subscription(uuid, int, uuid, uuid, text),
  public.admin_change_plan(uuid, uuid, text),
  public.admin_set_subscription_status(uuid, public.subscription_status, text),
  public.admin_set_workspace_disabled(uuid, boolean, text),
  public.admin_list_workspaces(text, public.workspace_kind),
  public.admin_list_users(text),
  public.admin_metrics()
from public, anon;
grant execute on function
  public.admin_create_access_code(public.access_code_purpose, uuid, int, text[], text, timestamptz, uuid, uuid, int),
  public.admin_revoke_access_code(uuid),
  public.redeem_renewal_code(uuid, text),
  public.clear_must_change_password(),
  public.my_workspaces(),
  public.admin_record_payment(text, numeric, text, text, uuid, text, text, text, date, text),
  public.admin_extend_subscription(uuid, int, uuid, uuid, text),
  public.admin_change_plan(uuid, uuid, text),
  public.admin_set_subscription_status(uuid, public.subscription_status, text),
  public.admin_set_workspace_disabled(uuid, boolean, text),
  public.admin_list_workspaces(text, public.workspace_kind),
  public.admin_list_users(text),
  public.admin_metrics()
to authenticated;

-- Las funciones privadas que modifican datos no deben ser invocables por usuarios finales.
-- (Las funciones de `private` tienen EXECUTE para PUBLIC por defecto en Postgres.)
revoke execute on function private.create_access_code, private.find_code, private.consume_code,
  private.attempts_exceeded, private.log_attempt, private.extend_subscription, private.refresh_subscription_statuses,
  private.audit, private.random_code, private.code_error_message
from public, anon, authenticated;
