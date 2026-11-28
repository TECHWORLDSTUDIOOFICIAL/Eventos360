-- =====================================================================
-- Eventos360 · Etapa 7 · Personal y turnos
-- Trabajadores (meseros, montadores, choferes…), turnos por evento,
-- asignación sin choques de horario, confirmación por WhatsApp con un
-- enlace personal, asistencia, cálculo de pago y pagos al personal.
-- El costo del personal entra a Finanzas como costo real del evento.
-- (Migración solo aditiva.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Módulos: Personal y Turnos para Profesional y para las especialidades
-- Business que trabajan con personal de evento.
-- ---------------------------------------------------------------------
update public.modules set name = 'Turnos' where key = 'shifts';
update public.modules set name = 'Personal' where key = 'workforce';
update public.modules set kinds = array_append(kinds, 'professional'::public.workspace_kind)
  where key in ('workforce','shifts') and not ('professional' = any(kinds));
update public.modules set default_kinds = array_append(default_kinds, 'professional'::public.workspace_kind)
  where key in ('workforce','shifts') and not ('professional' = any(default_kinds));
insert into public.specialty_modules(specialty_key, module_key, sort, label_override) values
  ('decoration', 'shifts', 101, null), ('catering', 'shifts', 81, null), ('photo_video', 'shifts', 81, 'Coberturas'),
  ('sound_lighting', 'shifts', 91, null), ('full_service', 'shifts', 111, null),
  ('rental', 'workforce', 95, 'Personal'), ('rental', 'shifts', 96, null),
  ('venue', 'workforce', 95, 'Personal'), ('venue', 'shifts', 96, null),
  ('florist', 'workforce', 75, 'Personal'), ('florist', 'shifts', 76, null)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Trabajadores
-- ---------------------------------------------------------------------
create table public.workers (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  full_name      text not null check (char_length(full_name) between 2 and 120),
  phone          text check (char_length(phone) <= 40),
  id_number      text check (char_length(id_number) <= 40),            -- cédula
  positions      text[] not null default '{}',                        -- puestos que puede cubrir
  pay_type       text not null default 'shift' check (pay_type in ('hour','shift','day')),
  rate           numeric(12,2) not null default 0 check (rate >= 0),
  currency_code  char(3) not null default 'NIO' references public.currencies(code),
  is_active      boolean not null default true,
  emergency_contact text check (char_length(emergency_contact) <= 200),
  notes          text check (char_length(notes) <= 2000),
  portal_token   text unique,                                         -- enlace personal para ver y confirmar turnos
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  check (cardinality(positions) <= 12)
);
create index workers_ws_idx on public.workers(workspace_id, is_active, full_name);
create trigger workers_touch before update on public.workers for each row execute function private.touch_updated_at();

-- El enlace personal solo lo crea worker_portal_link.
create or replace function private.workers_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('eventos360.portal', true), '') <> 'on' then
    new.portal_token := case when tg_op = 'UPDATE' then old.portal_token else null end;
  end if;
  new.positions := array(select distinct trim(p) from unnest(new.positions) p where char_length(trim(p)) between 2 and 60);
  return new;
end $$;
create trigger workers_before before insert or update on public.workers for each row execute function private.workers_before();

-- Días en que no puede trabajar (vacaciones, estudio, otro empleo…)
create table public.worker_unavailability (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  worker_id     uuid not null,
  starts_on     date not null,
  ends_on       date not null,
  reason        text check (char_length(reason) <= 160),
  created_at    timestamptz not null default now(),
  foreign key (workspace_id, worker_id) references public.workers(workspace_id, id) on delete cascade,
  check (ends_on >= starts_on)
);
create index worker_unavailability_idx on public.worker_unavailability(worker_id, starts_on);

-- ---------------------------------------------------------------------
-- Turnos y asignaciones
-- ---------------------------------------------------------------------
create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  event_id      uuid,
  rental_id     uuid,                                                             -- reservación de alquiler (entregas, montaje)
  booking_id    uuid,                                                             -- reserva de un salón
  position      text not null check (char_length(position) between 2 and 60),   -- puesto: Mesero, Montaje…
  starts_at     timestamptz not null,                                           -- hora de llegada
  ends_at       timestamptz not null,
  needed        int not null default 1 check (needed between 1 and 200),
  location      text check (char_length(location) <= 300),
  instructions  text check (char_length(instructions) <= 2000),                 -- uniforme, qué llevar, a quién buscar
  rate          numeric(12,2) check (rate >= 0),                                -- tarifa de este turno (si no, la del trabajador)
  pay_type      text check (pay_type in ('hour','shift','day')),
  notes         text check (char_length(notes) <= 2000),                        -- internas
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id),
  foreign key (workspace_id, rental_id) references public.rentals(workspace_id, id) on delete set null (rental_id),
  foreign key (workspace_id, booking_id) references public.bookings(workspace_id, id) on delete set null (booking_id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '3 days')
);
create index shifts_ws_idx on public.shifts(workspace_id, starts_at);
create index shifts_event_idx on public.shifts(event_id);
create index shifts_rental_idx on public.shifts(rental_id);
create index shifts_booking_idx on public.shifts(booking_id);
create trigger shifts_touch before update on public.shifts for each row execute function private.touch_updated_at();

create table public.staff_payouts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  worker_id     uuid not null,
  paid_on       date not null default current_date,
  amount        numeric(12,2) not null check (amount >= 0),
  currency_code char(3) not null references public.currencies(code),
  method        text,
  reference     text check (char_length(reference) <= 80),
  notes         text check (char_length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  unique (workspace_id, id),
  foreign key (workspace_id, worker_id) references public.workers(workspace_id, id) on delete restrict
);
create index staff_payouts_ws_idx on public.staff_payouts(workspace_id, paid_on desc);

create table public.shift_assignments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  shift_id      uuid not null,
  worker_id     uuid not null,
  status        text not null default 'assigned' check (status in ('assigned','confirmed','declined','attended','absent')),
  responded_at  timestamptz,
  check_in      timestamptz,
  check_out     timestamptz,
  pay_type      text not null default 'shift' check (pay_type in ('hour','shift','day')),
  rate          numeric(12,2) not null default 0 check (rate >= 0),
  extras        numeric(12,2) not null default 0 check (extras >= 0),           -- horas extra, transporte, viáticos
  extras_note   text check (char_length(extras_note) <= 160),
  pay_amount    numeric(12,2) not null default 0,                               -- calculado
  currency_code char(3) not null default 'NIO' references public.currencies(code),
  payout_id     uuid,
  notes         text check (char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (shift_id, worker_id),
  unique (workspace_id, id),
  foreign key (workspace_id, shift_id) references public.shifts(workspace_id, id) on delete cascade,
  foreign key (workspace_id, worker_id) references public.workers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, payout_id) references public.staff_payouts(workspace_id, id) on delete set null (payout_id),
  check (check_out is null or check_in is null or check_out > check_in)
);
create index shift_assignments_worker_idx on public.shift_assignments(worker_id);
create index shift_assignments_shift_idx on public.shift_assignments(shift_id);
create trigger shift_assignments_touch before update on public.shift_assignments for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
-- Una asignación "cuenta" (ocupa a la persona y genera pago) si no fue rechazada ni marcada como ausente.
create or replace function private.assignment_counts(p_status text)
returns boolean language sql immutable set search_path = '' as $$ select p_status in ('assigned','confirmed','attended') $$;

-- Pago: por hora (horas trabajadas o programadas), por turno o por día; más extras.
create or replace function private.assignment_pay(p_status text, p_type text, p_rate numeric, p_extras numeric,
  p_in timestamptz, p_out timestamptz, p_start timestamptz, p_end timestamptz)
returns numeric language sql immutable set search_path = '' as $$
  select case when not private.assignment_counts(p_status) then 0
    else round(case p_type
      when 'hour' then p_rate * extract(epoch from (case when p_in is not null and p_out is not null then p_out - p_in else p_end - p_start end)) / 3600
      when 'day' then p_rate * greatest(1, ceil(extract(epoch from (p_end - p_start)) / 86400))
      else p_rate end + coalesce(p_extras, 0), 2) end;
$$;

-- ¿Puede esta persona trabajar este turno? Devuelve el motivo si no.
create or replace function private.worker_conflict(p_worker uuid, p_shift uuid, p_from timestamptz, p_to timestamptz, p_tz text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'Ya tiene otro turno de ' || s2.position || ' ese día (' || to_char(s2.starts_at at time zone p_tz, 'HH24:MI') || '–' || to_char(s2.ends_at at time zone p_tz, 'HH24:MI') || ').'
       from public.shift_assignments a2 join public.shifts s2 on s2.id = a2.shift_id
      where a2.worker_id = p_worker and a2.shift_id <> p_shift and private.assignment_counts(a2.status)
        and s2.starts_at < p_to and s2.ends_at > p_from limit 1),
    (select 'Marcó que no está disponible' || coalesce(' (' || u.reason || ')', '') || '.'
       from public.worker_unavailability u
      where u.worker_id = p_worker and u.starts_on <= (p_to at time zone p_tz)::date and u.ends_on >= (p_from at time zone p_tz)::date limit 1));
$$;

create or replace function private.shift_assignments_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.shifts; w public.workers; v_tz text; v_conflict text;
begin
  select * into s from public.shifts where id = new.shift_id;
  select * into w from public.workers where id = new.worker_id;
  select timezone into v_tz from public.workspaces where id = new.workspace_id;
  if tg_op = 'INSERT' then
    if not w.is_active then raise exception '% está marcado como inactivo.', w.full_name using errcode = 'P0001'; end if;
    -- La tarifa se guarda al asignar: si luego cambia la del trabajador, este turno no cambia.
    new.pay_type := coalesce(s.pay_type, w.pay_type);
    new.rate := coalesce(s.rate, w.rate);
    new.currency_code := w.currency_code;
    new.payout_id := null;
  end if;
  if tg_op = 'UPDATE' then
    -- El vínculo al pago solo lo pone staff_pay; se quita solo si el pago se anuló.
    if new.payout_id is distinct from old.payout_id and coalesce(current_setting('eventos360.paying', true), '') <> 'on'
       and not (new.payout_id is null and not exists (select 1 from public.staff_payouts where id = old.payout_id)) then
      new.payout_id := old.payout_id;
    end if;
    if new.status is not distinct from old.status then new.responded_at := old.responded_at; end if;
  end if;
  -- Lo que ya se pagó no se modifica (para que los pagos cuadren).
  if tg_op = 'UPDATE' and old.payout_id is not null and new.payout_id is not distinct from old.payout_id
     and (new.status, new.check_in, new.check_out, new.rate, new.pay_type, new.extras) is distinct from (old.status, old.check_in, old.check_out, old.rate, old.pay_type, old.extras) then
    raise exception 'Este turno ya se le pagó a % y no se puede modificar.', w.full_name using errcode = 'P0001';
  end if;
  if private.assignment_counts(new.status) and (tg_op = 'INSERT' or not private.assignment_counts(old.status)) then
    v_conflict := private.worker_conflict(new.worker_id, new.shift_id, s.starts_at, s.ends_at, v_tz);
    if v_conflict is not null then raise exception '%: %', w.full_name, v_conflict using errcode = 'P0001'; end if;
  end if;
  if new.status in ('confirmed','declined') and (tg_op = 'INSERT' or new.status is distinct from old.status) then new.responded_at := now(); end if;
  new.pay_amount := private.assignment_pay(new.status, new.pay_type, new.rate, new.extras, new.check_in, new.check_out, s.starts_at, s.ends_at);
  return new;
end $$;
create trigger shift_assignments_before before insert or update on public.shift_assignments
  for each row execute function private.shift_assignments_before();

-- No asignar más personas de las que pide el turno.
create or replace function private.shift_assignments_needed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_needed int; v_count int;
begin
  perform pg_advisory_xact_lock(hashtext('shift:' || new.shift_id::text));
  select needed into v_needed from public.shifts where id = new.shift_id;
  select count(*) into v_count from public.shift_assignments where shift_id = new.shift_id and private.assignment_counts(status);
  if v_count > v_needed then
    raise exception 'Este turno ya tiene las % personas que necesita. Aumenta la cantidad si necesitas más.', v_needed using errcode = 'P0001';
  end if;
  return null;
end $$;
create trigger shift_assignments_needed after insert or update of status on public.shift_assignments
  for each row when (private.assignment_counts(new.status)) execute function private.shift_assignments_needed();

-- Si cambia el horario del turno: revisar choques y recalcular pagos.
create or replace function private.shifts_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; v_tz text; v_conflict text;
begin
  if (new.starts_at, new.ends_at, new.rate, new.pay_type) is not distinct from (old.starts_at, old.ends_at, old.rate, old.pay_type) then return null; end if;
  select timezone into v_tz from public.workspaces where id = new.workspace_id;
  for a in select sa.*, w.full_name, w.rate as w_rate, w.pay_type as w_type from public.shift_assignments sa join public.workers w on w.id = sa.worker_id
           where sa.shift_id = new.id and sa.payout_id is null loop
    if private.assignment_counts(a.status) and (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
      v_conflict := private.worker_conflict(a.worker_id, new.id, new.starts_at, new.ends_at, v_tz);
      if v_conflict is not null then raise exception 'No se puede mover el turno. %: %', a.full_name, v_conflict using errcode = 'P0001'; end if;
    end if;
    update public.shift_assignments set
      rate = case when (new.rate, new.pay_type) is distinct from (old.rate, old.pay_type) then coalesce(new.rate, a.w_rate) else rate end,
      pay_type = case when (new.rate, new.pay_type) is distinct from (old.rate, old.pay_type) then coalesce(new.pay_type, a.w_type) else pay_type end,
      updated_at = now()
    where id = a.id;
  end loop;
  return null;
end $$;
create trigger shifts_after after update on public.shifts for each row execute function private.shifts_after();

-- No se puede bajar "needed" por debajo de los ya asignados.
create or replace function private.shifts_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if tg_op = 'UPDATE' and new.needed < old.needed then
    select count(*) into v_count from public.shift_assignments where shift_id = new.id and private.assignment_counts(status);
    if v_count > new.needed then raise exception 'Ya hay % personas asignadas; quita a alguien antes de reducir la cantidad.', v_count using errcode = 'P0001'; end if;
  end if;
  if tg_op = 'DELETE' and exists (select 1 from public.shift_assignments where shift_id = old.id and payout_id is not null) then
    raise exception 'Este turno ya tiene pagos registrados y no se puede eliminar.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger shifts_before before update or delete on public.shifts for each row execute function private.shifts_before();

-- Un pago no se borra si deja turnos sin pagar a medias: al borrarlo, los turnos vuelven a "pendientes".
-- (on delete set null en payout_id; se permite saltar la regla de "ya pagado" en ese caso.)

-- ---------------------------------------------------------------------
-- Funciones para la pantalla
-- ---------------------------------------------------------------------
-- Candidatos para un turno: quién puede, quién está ocupado y por qué.
create or replace function public.shift_candidates(p_shift uuid)
returns table (worker_id uuid, full_name text, phone text, positions text[], pay_type text, rate numeric, currency_code char(3),
               matches boolean, conflict text, assigned boolean)
language plpgsql stable security definer set search_path = '' as $$
declare s public.shifts; v_tz text;
begin
  select * into s from public.shifts where id = p_shift;
  if not found or s.workspace_id not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select timezone into v_tz from public.workspaces where id = s.workspace_id;
  return query
    select w.id, w.full_name, w.phone, w.positions, coalesce(s.pay_type, w.pay_type), coalesce(s.rate, w.rate), w.currency_code,
           exists (select 1 from unnest(w.positions) p where lower(p) = lower(s.position)),
           private.worker_conflict(w.id, s.id, s.starts_at, s.ends_at, v_tz),
           exists (select 1 from public.shift_assignments a where a.shift_id = s.id and a.worker_id = w.id)
      from public.workers w
     where w.workspace_id = s.workspace_id and w.is_active
     order by 8 desc, (private.worker_conflict(w.id, s.id, s.starts_at, s.ends_at, v_tz) is null) desc, w.full_name;
end $$;

-- Pagar a un trabajador los turnos elegidos (todo o nada).
create or replace function public.staff_pay(p_ws uuid, p_worker uuid, p_assignments uuid[], p_paid_on date, p_method text, p_reference text, p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_total numeric; v_cur text; v_n int; v_id uuid;
begin
  if not private.can_write_module(p_ws, 'finance') or not private.ws_has_module(p_ws, 'workforce') then
    raise exception 'Solo quien maneja las finanzas puede registrar pagos al personal.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || p_worker::text));
  select count(*), sum(a.pay_amount), min(a.currency_code)
    into v_n, v_total, v_cur from public.shift_assignments a join public.shifts s on s.id = a.shift_id
   where a.id = any(p_assignments) and a.workspace_id = p_ws and a.worker_id = p_worker and a.payout_id is null
     and a.status in ('assigned','confirmed','attended') and s.starts_at <= now();
  if v_n is null or v_n = 0 or v_n <> cardinality(p_assignments) then
    raise exception 'Algunos turnos ya se pagaron, aún no ocurren o no son de esta persona. Actualiza la página.' using errcode = 'P0001';
  end if;
  if (select count(distinct currency_code) from public.shift_assignments where id = any(p_assignments)) > 1 then
    raise exception 'Paga por separado los turnos en córdobas y en dólares.' using errcode = 'P0001';
  end if;
  insert into public.staff_payouts(workspace_id, worker_id, paid_on, amount, currency_code, method, reference, notes)
    values (p_ws, p_worker, coalesce(p_paid_on, current_date), v_total, v_cur, nullif(trim(p_method), ''), nullif(trim(p_reference), ''), nullif(trim(p_notes), ''))
    returning id into v_id;
  perform set_config('eventos360.paying', 'on', true);
  -- Quien estaba "asignado/confirmado" en un turno pasado y se le paga, asistió.
  update public.shift_assignments set payout_id = v_id, status = 'attended' where id = any(p_assignments);
  perform set_config('eventos360.paying', '', true);
  return v_id;
end $$;

-- Enlace personal del trabajador (crear o renovar)
create or replace function public.worker_portal_link(p_worker uuid, p_renew boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare w public.workers;
begin
  select * into w from public.workers where id = p_worker;
  if not found or not private.can_write_any(w.workspace_id, array['workforce','shifts']) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if w.portal_token is null or p_renew then
    perform set_config('eventos360.portal', 'on', true);
    update public.workers set portal_token = private.random_token(12) where id = p_worker returning portal_token into w.portal_token;
    perform set_config('eventos360.portal', '', true);
  end if;
  return w.portal_token;
end $$;

grant execute on function public.shift_candidates(uuid), public.staff_pay(uuid, uuid, uuid[], date, text, text, text),
  public.worker_portal_link(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Página del trabajador (sin cuenta): ve sus turnos y confirma o rechaza
-- ---------------------------------------------------------------------
create or replace function public.public_worker(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w public.workers; v_tz text;
begin
  if p_token is null or char_length(p_token) < 12 then return null; end if;
  select * into w from public.workers where portal_token = p_token;
  if not found or not w.is_active or not private.ws_public_ok(w.workspace_id) or not private.ws_has_module(w.workspace_id, 'shifts') then return null; end if;
  select timezone into v_tz from public.workspaces where id = w.workspace_id;
  return jsonb_build_object(
    'business', private.public_business(w.workspace_id),
    'worker', jsonb_build_object('name', split_part(w.full_name, ' ', 1)),
    'timezone', v_tz,
    'shifts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status, 'position', s.position, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'location', coalesce(s.location, e.venue_name, r.delivery_address, (select v.name from public.venues v where v.id = b.venue_id)), 'address', e.venue_address, 'map_url', e.venue_map_url,
        'event', coalesce(e.name, r.title, b.title), 'instructions', s.instructions,
        'pay', a.pay_amount, 'currency', a.currency_code, 'paid', a.payout_id is not null)
        order by s.starts_at), '[]')
      from public.shift_assignments a join public.shifts s on s.id = a.shift_id left join public.events e on e.id = s.event_id
      left join public.rentals r on r.id = s.rental_id left join public.bookings b on b.id = s.booking_id
     where a.worker_id = w.id and s.ends_at > now() - interval '30 days' and s.starts_at < now() + interval '120 days')
  );
end $$;

create table public.public_worker_log (
  id         bigint generated always as identity primary key,
  worker_id  uuid not null references public.workers(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.public_worker_log enable row level security;   -- sin políticas: solo funciones
create index public_worker_log_idx on public.public_worker_log(worker_id, created_at desc);

create or replace function public.public_worker_respond(p_token text, p_assignment uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.workers; a public.shift_assignments; s public.shifts;
begin
  select * into w from public.workers where portal_token = p_token and p_token is not null and char_length(p_token) >= 12;
  if not found or not w.is_active or not private.ws_public_ok(w.workspace_id) then
    return jsonb_build_object('ok', false, 'message', 'Este enlace ya no está disponible. Pide uno nuevo.');
  end if;
  if (select count(*) from public.public_worker_log where worker_id = w.id and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'message', 'Demasiados cambios seguidos. Intenta más tarde o escribe por WhatsApp.');
  end if;
  insert into public.public_worker_log(worker_id) values (w.id);
  select * into a from public.shift_assignments where id = p_assignment and worker_id = w.id;
  if not found then return jsonb_build_object('ok', false, 'message', 'No encontramos ese turno.'); end if;
  select * into s from public.shifts where id = a.shift_id;
  if s.starts_at <= now() then return jsonb_build_object('ok', false, 'message', 'Ese turno ya empezó; para cambios escribe por WhatsApp.'); end if;
  if a.status not in ('assigned','confirmed','declined') or a.payout_id is not null then
    return jsonb_build_object('ok', false, 'message', 'Ese turno ya no se puede cambiar desde aquí.');
  end if;
  begin
    update public.shift_assignments set status = case when p_accept then 'confirmed' else 'declined' end where id = a.id;
  exception when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'message', 'No se pudo confirmar: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.public_worker(text), public.public_worker_respond(text, uuid, boolean) to anon, authenticated;

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare t record;
begin
  for t in select * from (values
    ('workers', array['workforce','shifts']), ('worker_unavailability', array['workforce','shifts']),
    ('shifts', array['shifts']), ('shift_assignments', array['shifts'])
  ) as x(tbl, modules)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.tbl);
    execute format($p$create policy "miembros leen" on public.%I for select to authenticated
                     using (workspace_id in (select private.user_workspace_ids()))$p$, t.tbl);
    execute format($p$create policy "miembros crean" on public.%I for insert to authenticated
                     with check (private.can_write_any(workspace_id, %L))$p$, t.tbl, t.modules);
    execute format($p$create policy "miembros editan" on public.%I for update to authenticated
                     using (private.can_write_any(workspace_id, %L)) with check (private.can_write_any(workspace_id, %L))$p$, t.tbl, t.modules, t.modules);
    execute format($p$create policy "miembros eliminan" on public.%I for delete to authenticated
                     using (private.can_write_any(workspace_id, %L))$p$, t.tbl, t.modules);
  end loop;
end $$;
-- (El pago calculado, el vínculo al pago y el enlace personal los protegen los triggers.)

-- Pagos al personal: solo quien ve finanzas. Se crean con staff_pay; se pueden anular (borrar) para corregir.
alter table public.staff_payouts enable row level security;
grant select, delete on public.staff_payouts to authenticated;
create policy "finanzas leen" on public.staff_payouts for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()) and private.role_can_module(workspace_id, 'finance'));
create policy "finanzas anulan" on public.staff_payouts for delete to authenticated using (private.can_write_module(workspace_id, 'finance'));

-- Los visitantes sin sesión no tienen permisos directos sobre estas tablas.
revoke all on public.workers, public.worker_unavailability, public.shifts, public.shift_assignments, public.staff_payouts, public.public_worker_log from anon;
