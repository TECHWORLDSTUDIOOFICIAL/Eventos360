-- =====================================================================
-- Eventos360 · Etapa 5 · Business: salones, locales y espacios
-- Espacios (capacidad por montaje, comodidades, reglas, fotos, espacios
-- combinados), tarifas por día y temporada, reservas con apartado
-- provisional que vence, bloqueo de doble reserva (incluye montaje y
-- desmontaje), bloqueos internos, garantía, pagos y consultas desde una
-- página pública.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo de módulos
-- ---------------------------------------------------------------------
insert into public.modules(key, name, kinds, default_kinds, required_feature, sort) values
  ('bookings',       'Reservas de espacios', '{business}', '{}', null, 112),
  ('venue_calendar', 'Ocupación',            '{business}', '{}', null, 118)
on conflict (key) do nothing;

-- La especialidad "locales" usa sus propias reservas y su calendario de ocupación (se reemplazan, sin borrar filas).
update public.specialty_modules set module_key = 'bookings', sort = 20, label_override = 'Reservas' where specialty_key = 'venue' and module_key = 'reservations';
update public.specialty_modules set module_key = 'venue_calendar', sort = 15, label_override = null where specialty_key = 'venue' and module_key = 'availability';
update public.specialty_modules set sort = 10 where specialty_key = 'venue' and module_key = 'venues';
update public.specialty_modules set sort = 40 where specialty_key = 'venue' and module_key = 'venue_rates';

-- ---------------------------------------------------------------------
-- Espacios
-- ---------------------------------------------------------------------
create table public.venues (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  name              text not null check (char_length(name) between 2 and 120),
  kind              text not null default 'salon' check (kind in ('salon','jardin','terraza','rancho','auditorio','finca','piscina','otro')),
  description       text check (char_length(description) <= 3000),
  indoor            boolean not null default true,
  area_m2           numeric(10,2) check (area_m2 > 0),
  cap_banquet       int check (cap_banquet between 1 and 100000),     -- mesas redondas
  cap_theater       int check (cap_theater between 1 and 100000),     -- auditorio
  cap_cocktail      int check (cap_cocktail between 1 and 100000),    -- de pie
  cap_classroom     int check (cap_classroom between 1 and 100000),   -- escuela
  cap_u             int check (cap_u between 1 and 100000),           -- imperial / en U
  amenities         text[] not null default '{}',
  includes          text check (char_length(includes) <= 2000),       -- qué incluye el alquiler
  rules             text check (char_length(rules) <= 4000),          -- reglas de uso
  setup_minutes     int not null default 120 check (setup_minutes between 0 and 2880),
  teardown_minutes  int not null default 60 check (teardown_minutes between 0 and 2880),
  photos            text[] not null default '{}',
  color             text not null default '#0f7468' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort              int not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  check (cardinality(photos) <= 12)
);
create index venues_ws_idx on public.venues(workspace_id, sort, name);
create trigger venues_touch before update on public.venues for each row execute function private.touch_updated_at();

create or replace function private.venues_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enforce_limit(new.workspace_id, 'venues.max', (select count(*) from public.venues where workspace_id = new.workspace_id));
  return new;
end $$;
create trigger venues_limit before insert on public.venues for each row execute function private.venues_limit();

-- Espacios combinados: "Gran salón" = Salón A + Salón B.
create table public.venue_parts (
  workspace_id uuid not null,
  venue_id     uuid not null,
  part_id      uuid not null,
  primary key (venue_id, part_id),
  check (venue_id <> part_id),
  foreign key (workspace_id, venue_id) references public.venues(workspace_id, id) on delete cascade,
  foreign key (workspace_id, part_id) references public.venues(workspace_id, id) on delete cascade
);
create or replace function private.venue_parts_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Un solo nivel: una parte no puede estar compuesta, ni un compuesto ser parte de otro.
  if exists (select 1 from public.venue_parts where venue_id = new.part_id)
     or exists (select 1 from public.venue_parts where part_id = new.venue_id) then
    raise exception 'Un espacio combinado solo puede formarse con espacios simples.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger venue_parts_check before insert on public.venue_parts for each row execute function private.venue_parts_check();

-- ---------------------------------------------------------------------
-- Tarifas
-- ---------------------------------------------------------------------
create table public.venue_rates (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  venue_id         uuid not null,
  name             text not null check (char_length(name) between 2 and 80),
  weekdays         smallint[] not null default '{}',     -- 0=domingo … 6=sábado; vacío = todos los días
  season_from      text check (season_from ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),   -- MM-DD, se repite cada año
  season_to        text check (season_to ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  base_hours       numeric(5,2) not null default 5 check (base_hours > 0 and base_hours <= 72),
  base_price       numeric(14,2) not null check (base_price >= 0),
  extra_hour_price numeric(14,2) not null default 0 check (extra_hour_price >= 0),
  deposit_amount   numeric(14,2) not null default 0 check (deposit_amount >= 0),     -- garantía sugerida
  currency_code    char(3) not null default 'NIO' references public.currencies(code),
  is_active        boolean not null default true,
  sort             int not null default 0,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  check ((season_from is null) = (season_to is null)),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  foreign key (workspace_id, venue_id) references public.venues(workspace_id, id) on delete cascade
);
create index venue_rates_venue_idx on public.venue_rates(venue_id, sort);

-- ---------------------------------------------------------------------
-- Reservas de espacios
--   inquiry   = consulta (no aparta; lista de espera)
--   hold      = apartado provisional: aparta hasta hold_until; si vence vuelve a consulta
--   confirmed = confirmada (aparta)
--   done      = realizada
--   canceled  = cancelada
--   kind block = bloqueo interno (mantenimiento, uso propio): aparta sin cliente
-- ---------------------------------------------------------------------
create table public.bookings (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  number           int not null,
  kind             text not null default 'event' check (kind in ('event','block')),
  status           text not null default 'inquiry' check (status in ('inquiry','hold','confirmed','done','canceled')),
  venue_id         uuid not null,
  customer_id      uuid,
  event_id         uuid,
  title            text not null check (char_length(title) between 2 and 160),
  setup            text not null default 'banquet' check (setup in ('banquet','theater','cocktail','classroom','u','other')),
  guests           int check (guests between 0 and 100000),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  setup_minutes    int not null default 0 check (setup_minutes between 0 and 2880),
  teardown_minutes int not null default 0 check (teardown_minutes between 0 and 2880),
  hold_until       timestamptz,
  hold_expired_at  timestamptz,
  rate_id          uuid,
  source           text check (source in ('telefono','whatsapp','visita','web','redes','referido','otro')),
  currency_code    char(3) not null default 'NIO' references public.currencies(code),
  discount_amount  numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_rate         numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  advance_pct      numeric(5,2) not null default 50 check (advance_pct between 0 and 100),
  subtotal         numeric(14,2) not null default 0,
  tax_amount       numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  deposit_amount   numeric(14,2) not null default 0 check (deposit_amount >= 0),
  deposit_received numeric(14,2) not null default 0 check (deposit_received >= 0),
  deposit_refunded numeric(14,2) not null default 0 check (deposit_refunded >= 0),
  deposit_retained numeric(14,2) not null default 0 check (deposit_retained >= 0),
  deposit_notes    text check (char_length(deposit_notes) <= 1000),
  client_message   text check (char_length(client_message) <= 2000),     -- lo que escribió el cliente (consultas web)
  ops_notes        text check (char_length(ops_notes) <= 4000),          -- para la hoja del evento
  notes            text check (char_length(notes) <= 2000),              -- internas
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  check (ends_at > starts_at),
  check (deposit_refunded + deposit_retained <= deposit_received),
  check (kind = 'block' or customer_id is not null),
  foreign key (workspace_id, venue_id) references public.venues(workspace_id, id) on delete no action,
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete no action,
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id),
  foreign key (workspace_id, rate_id) references public.venue_rates(workspace_id, id) on delete set null (rate_id)
);
create index bookings_ws_idx on public.bookings(workspace_id, starts_at);
create index bookings_venue_idx on public.bookings(venue_id, starts_at) where status in ('hold','confirmed','done');
create trigger bookings_touch before update on public.bookings for each row execute function private.touch_updated_at();

create table public.booking_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  booking_id   uuid not null,
  sort         int not null default 0,
  description  text not null check (char_length(description) between 1 and 300),
  quantity     numeric(10,2) not null default 1 check (quantity > 0),
  unit_price   numeric(14,2) not null default 0 check (unit_price >= 0),
  line_total   numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  unique (workspace_id, id),
  foreign key (workspace_id, booking_id) references public.bookings(workspace_id, id) on delete cascade
);
create index booking_items_idx on public.booking_items(booking_id, sort);

alter table public.customer_payments add column booking_id uuid,
  add constraint customer_payments_booking_fk foreign key (workspace_id, booking_id)
    references public.bookings(workspace_id, id) on delete set null (booking_id);
create index customer_payments_booking_idx on public.customer_payments(booking_id) where booking_id is not null;
alter table public.contracts add column booking_id uuid,
  add constraint contracts_booking_fk foreign key (workspace_id, booking_id)
    references public.bookings(workspace_id, id) on delete set null (booking_id);
grant insert (booking_id), update (booking_id) on public.contracts to authenticated;

-- Página pública de consultas
alter table public.workspaces add column booking_token text unique;

-- =====================================================================
-- Motor de ocupación
-- =====================================================================
-- Espacios "base" que ocupa un espacio (un combinado ocupa sus partes).
create or replace function private.venue_atoms(p_venue uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce((select array_agg(part_id order by part_id) from public.venue_parts where venue_id = p_venue), array[p_venue]);
$$;

-- ¿La reserva ocupa el espacio en este momento? (un apartado vencido ya no ocupa)
create or replace function private.booking_blocks(p_kind text, p_status text, p_hold_until timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select case when p_status = 'canceled' then false
              when p_kind = 'block' then true
              when p_status in ('confirmed','done') then true
              when p_status = 'hold' then p_hold_until is null or p_hold_until > now()
              else false end;
$$;

-- Reservas que chocan con un espacio y horario (incluye montaje y desmontaje).
create or replace function private.venue_conflicts(p_venue uuid, p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns table (id uuid, number int, title text, status text, kind text, venue_name text, starts_at timestamptz, ends_at timestamptz, hold_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, b.number, b.title, b.status, b.kind, v.name, b.starts_at, b.ends_at, b.hold_until
  from public.bookings b
  join public.venues v on v.id = b.venue_id
  where (p_exclude is null or b.id <> p_exclude)
    and private.booking_blocks(b.kind, b.status, b.hold_until)
    and private.venue_atoms(b.venue_id) && private.venue_atoms(p_venue)
    and tstzrange(b.starts_at - make_interval(mins => b.setup_minutes), b.ends_at + make_interval(mins => b.teardown_minutes), '[)')
        && tstzrange(p_from, p_to, '[)')
  order by b.starts_at;
$$;

create or replace function private.check_booking(p_booking uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; a uuid; c record; v_tz text;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or not private.booking_blocks(b.kind, b.status, b.hold_until) then return; end if;
  -- Bloqueo por espacio base, en orden, para que dos reservas simultáneas no tomen la misma fecha.
  foreach a in array private.venue_atoms(b.venue_id) loop
    perform pg_advisory_xact_lock(hashtextextended('e360-venue-' || a::text, 0));
  end loop;
  select c2.* into c from private.venue_conflicts(b.venue_id, b.starts_at - make_interval(mins => b.setup_minutes),
                                                  b.ends_at + make_interval(mins => b.teardown_minutes), b.id) c2 limit 1;
  if found then
    select timezone into v_tz from public.workspaces where id = b.workspace_id;
    raise exception '"%" ya está ocupado ese día por RSV-% (%: "%", %). Puedes guardarla como consulta para quedar en lista de espera.',
      c.venue_name, lpad(c.number::text, 4, '0'),
      case when c.kind = 'block' then 'bloqueo' when c.status = 'hold' then 'apartado provisional' else 'confirmada' end,
      c.title, to_char(c.starts_at at time zone v_tz, 'DD/MM/YYYY HH24:MI') || ' a ' || to_char(c.ends_at at time zone v_tz, 'HH24:MI')
      using errcode = 'P0001', hint = 'venue_taken';
  end if;
end $$;

create or replace function private.bookings_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sub numeric(14,2); v_disc numeric(14,2);
begin
  if tg_op = 'INSERT' then
    new.number := private.next_number(new.workspace_id, 'booking');
    if new.status in ('done') then new.status := 'inquiry'; end if;
    new.confirmed_at := case when new.status = 'confirmed' then now() end;
    new.hold_expired_at := null;
  else
    new.number := old.number;
    new.kind := old.kind;
    if new.status <> old.status then
      if not (
        (old.status = 'inquiry'   and new.status in ('hold','confirmed','canceled')) or
        (old.status = 'hold'      and new.status in ('inquiry','confirmed','canceled')) or
        (old.status = 'confirmed' and new.status in ('hold','done','canceled')) or
        (old.status = 'done'      and new.status = 'confirmed') or
        (old.status = 'canceled'  and new.status = 'inquiry')
      ) then
        raise exception 'No se puede pasar de "%" a "%".', old.status, new.status using errcode = 'P0001';
      end if;
      if new.status = 'confirmed' and old.status <> 'confirmed' then new.confirmed_at := now(); end if;
      if new.status <> 'inquiry' then new.hold_expired_at := null; end if;
    end if;
  end if;
  if new.kind = 'block' then
    new.customer_id := null; new.setup := 'other';
    if new.status in ('inquiry','hold') then new.status := 'confirmed'; end if;
  end if;
  if new.status = 'hold' and (new.hold_until is null or (tg_op = 'UPDATE' and old.status <> 'hold' and new.hold_until <= now())) then
    new.hold_until := now() + interval '7 days';
  end if;
  if new.status = 'hold' and new.hold_until <= now() then
    raise exception 'La fecha de vencimiento del apartado debe ser futura.' using errcode = 'P0001';
  end if;
  select coalesce(sum(line_total), 0) into v_sub from public.booking_items where booking_id = new.id;
  v_disc := least(new.discount_amount, v_sub);
  new.subtotal := v_sub;
  new.tax_amount := round((v_sub - v_disc) * new.tax_rate / 100, 2);
  new.total := v_sub - v_disc + new.tax_amount;
  if new.deposit_refunded + new.deposit_retained > new.deposit_received then
    raise exception 'Lo devuelto más lo retenido no puede superar la garantía recibida.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger bookings_before before insert or update on public.bookings for each row execute function private.bookings_before();

create or replace function private.bookings_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status <> old.status or new.venue_id <> old.venue_id or new.starts_at <> old.starts_at
     or new.ends_at <> old.ends_at or new.setup_minutes <> old.setup_minutes or new.teardown_minutes <> old.teardown_minutes
     or new.hold_until is distinct from old.hold_until then
    perform private.check_booking(new.id);
  end if;
  return null;
end $$;
create trigger bookings_after after insert or update on public.bookings for each row execute function private.bookings_after();

create or replace function private.booking_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set updated_at = now() where id = coalesce(new.booking_id, old.booking_id);
  return null;
end $$;
create trigger booking_items_after after insert or update or delete on public.booking_items for each row execute function private.booking_items_after();

-- Los apartados vencidos vuelven a "consulta" (cada hora).
create or replace function private.expire_venue_holds()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.bookings set status = 'inquiry', hold_expired_at = hold_until
   where status = 'hold' and hold_until is not null and hold_until <= now();
  get diagnostics n = row_count;
  return n;
end $$;
select cron.schedule('eventos360-expire-venue-holds', '12 * * * *', $$select private.expire_venue_holds()$$);

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare t record;
begin
  for t in select * from (values
    ('venues', array['venues']), ('venue_parts', array['venues']), ('venue_rates', array['venue_rates','venues']),
    ('booking_items', array['bookings'])
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
alter table public.bookings enable row level security;
grant select, insert, update, delete on public.bookings to authenticated;
create policy "miembros leen" on public.bookings for select to authenticated using (workspace_id in (select private.user_workspace_ids()));
create policy "miembros crean" on public.bookings for insert to authenticated with check (private.can_write_any(workspace_id, array['bookings']));
create policy "miembros editan" on public.bookings for update to authenticated
  using (private.can_write_any(workspace_id, array['bookings'])) with check (private.can_write_any(workspace_id, array['bookings']));
-- Una reserva confirmada o realizada es historial: se cancela, no se borra.
create policy "miembros eliminan" on public.bookings for delete to authenticated
  using (private.can_write_module(workspace_id, 'bookings') and status in ('inquiry','canceled'));
-- El token público solo lo genera la función venue_public_link (no hay permiso de columna para editarlo).

-- =====================================================================
-- Consultas para la app
-- =====================================================================
create or replace function public.venue_check(p_ws uuid, p_venue uuid, p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns table (id uuid, number int, title text, status text, kind text, venue_name text, starts_at timestamptz, ends_at timestamptz, hold_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ws not in (select private.user_workspace_ids()) or not exists (select 1 from public.venues v0 where v0.id = p_venue and v0.workspace_id = p_ws) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query select * from private.venue_conflicts(p_venue, p_from, p_to, p_exclude);
end $$;

-- Tarifa que aplica a un espacio en una fecha/horario y precio sugerido.
create or replace function public.venue_price(p_ws uuid, p_venue uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_local timestamp; v_dow int; v_md text; r public.venue_rates; v_hours numeric; v_extra numeric;
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select timezone into v_tz from public.workspaces where id = p_ws;
  v_local := p_from at time zone v_tz;
  v_dow := extract(dow from v_local)::int;
  v_md := to_char(v_local, 'MM-DD');
  select * into r from public.venue_rates vr
   where vr.workspace_id = p_ws and vr.venue_id = p_venue and vr.is_active
     and (cardinality(vr.weekdays) = 0 or v_dow = any(vr.weekdays))
     and (vr.season_from is null
          or (vr.season_from <= vr.season_to and v_md between vr.season_from and vr.season_to)
          or (vr.season_from > vr.season_to and (v_md >= vr.season_from or v_md <= vr.season_to)))
   order by (vr.season_from is not null) desc, (cardinality(vr.weekdays) > 0) desc, vr.sort, vr.created_at
   limit 1;
  if not found then return null; end if;
  v_hours := round(extract(epoch from (p_to - p_from)) / 3600.0, 2);
  v_extra := greatest(0, ceil(v_hours - r.base_hours));
  return jsonb_build_object('rate_id', r.id, 'rate_name', r.name, 'hours', v_hours, 'base_hours', r.base_hours, 'base_price', r.base_price,
    'extra_hours', v_extra, 'extra_hour_price', r.extra_hour_price, 'deposit_amount', r.deposit_amount, 'currency_code', r.currency_code,
    'total', r.base_price + v_extra * r.extra_hour_price);
end $$;

-- Ocupación de un mes por espacio y día (para el calendario).
create or replace function public.venue_month(p_ws uuid, p_from date, p_days int default 42)
returns table (booking_id uuid, number int, venue_id uuid, title text, status text, kind text, starts_at timestamptz, ends_at timestamptz,
               hold_until timestamptz, guests int, customer_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select timezone into v_tz from public.workspaces where id = p_ws;
  return query
    select b.id, b.number, b.venue_id, b.title, b.status, b.kind, b.starts_at, b.ends_at, b.hold_until, b.guests, c.name
    from public.bookings b left join public.customers c on c.id = b.customer_id
    where b.workspace_id = p_ws and b.status <> 'canceled'
      and b.ends_at > (p_from::timestamp at time zone v_tz)
      and b.starts_at < ((p_from + least(greatest(p_days, 1), 62))::timestamp at time zone v_tz)
    order by b.starts_at;
end $$;

create or replace function public.venue_dashboard(p_ws uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_today timestamptz; v_month timestamptz; v_next_month timestamptz; v_days int;
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select timezone into v_tz from public.workspaces where id = p_ws;
  v_today := (now() at time zone v_tz)::date::timestamp at time zone v_tz;
  v_month := date_trunc('month', now() at time zone v_tz)::timestamp at time zone v_tz;
  v_next_month := (date_trunc('month', now() at time zone v_tz) + interval '1 month')::timestamp at time zone v_tz;
  v_days := extract(day from (v_next_month - v_month))::int;
  return jsonb_build_object(
    'venues',         (select count(*) from public.venues where workspace_id = p_ws and is_active),
    'rates',          (select count(*) from public.venue_rates where workspace_id = p_ws and is_active),
    'today',          (select count(*) from public.bookings where workspace_id = p_ws and kind = 'event' and status in ('confirmed','hold') and starts_at < v_today + interval '1 day' and ends_at > v_today),
    'week',           (select count(*) from public.bookings where workspace_id = p_ws and kind = 'event' and status in ('confirmed','hold') and starts_at >= v_today and starts_at < v_today + interval '7 days'),
    'inquiries',      (select count(*) from public.bookings where workspace_id = p_ws and status = 'inquiry' and ends_at > now()),
    'holds',          (select count(*) from public.bookings where workspace_id = p_ws and status = 'hold' and hold_until > now()),
    'holds_expiring', (select count(*) from public.bookings where workspace_id = p_ws and status = 'hold' and hold_until > now() and hold_until < now() + interval '3 days'),
    'confirmed_month',(select count(*) from public.bookings where workspace_id = p_ws and kind = 'event' and status in ('confirmed','done') and starts_at >= v_month and starts_at < v_next_month),
    'occupancy',      (select coalesce(jsonb_agg(jsonb_build_object('venue_id', v.id, 'name', v.name, 'days', (
                          select count(distinct d::date) from public.bookings b,
                            generate_series((greatest(b.starts_at, v_month) at time zone v_tz)::date, ((least(b.ends_at, v_next_month) - interval '1 second') at time zone v_tz)::date, interval '1 day') d
                          where b.workspace_id = p_ws and b.status in ('confirmed','done') and b.kind = 'event'
                            and private.venue_atoms(b.venue_id) && private.venue_atoms(v.id)
                            and b.starts_at < v_next_month and b.ends_at > v_month), 'month_days', v_days) order by v.sort, v.name), '[]')
                        from public.venues v where v.workspace_id = p_ws and v.is_active)
  );
end $$;

-- Activar / renovar el enlace público de consultas (propietario o administrador).
create or replace function public.venue_public_link(p_ws uuid, p_enable boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if not private.can_write(p_ws, array['owner','admin']::public.member_role[]) or not private.ws_has_module(p_ws, 'venues') then
    raise exception 'Solo el propietario o un administrador puede cambiar el enlace público.' using errcode = '42501';
  end if;
  v := case when p_enable then private.random_token(12) else null end;
  update public.workspaces set booking_token = v where id = p_ws;
  return v;
end $$;

-- Todas validan internamente que quien llama pertenezca al negocio.
grant execute on function public.venue_check(uuid, uuid, timestamptz, timestamptz, uuid), public.venue_price(uuid, uuid, timestamptz, timestamptz),
  public.venue_month(uuid, date, int), public.venue_dashboard(uuid), public.venue_public_link(uuid, boolean) to authenticated;

-- =====================================================================
-- Página pública: espacios, fechas ocupadas y formulario de consulta
-- =====================================================================
create or replace function public.public_venues(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w public.workspaces; v_tz text;
begin
  select * into w from public.workspaces where booking_token = p_token and booking_token is not null;
  if not found or not private.ws_public_ok(w.id) or not private.ws_has_module(w.id, 'venues') then return null; end if;
  v_tz := w.timezone;
  return jsonb_build_object(
    'business', private.public_business(w.id),
    'venues', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'kind', v.kind, 'description', v.description,
                 'indoor', v.indoor, 'area_m2', v.area_m2, 'cap_banquet', v.cap_banquet, 'cap_theater', v.cap_theater, 'cap_cocktail', v.cap_cocktail,
                 'cap_classroom', v.cap_classroom, 'cap_u', v.cap_u, 'amenities', v.amenities, 'includes', v.includes, 'rules', v.rules, 'photos', v.photos,
                 -- Solo los días ocupados (sin datos de clientes), próximos 12 meses.
                 'busy', (select coalesce(jsonb_agg(distinct to_char(d, 'YYYY-MM-DD')), '[]') from public.bookings b,
                           generate_series((b.starts_at at time zone v_tz)::date, ((b.ends_at - interval '1 second') at time zone v_tz)::date, interval '1 day') d
                          where b.workspace_id = w.id and private.booking_blocks(b.kind, b.status, b.hold_until)
                            and private.venue_atoms(b.venue_id) && private.venue_atoms(v.id)
                            and b.ends_at > now() and b.starts_at < now() + interval '12 months'))
               order by v.sort, v.name), '[]') from public.venues v where v.workspace_id = w.id and v.is_active)
  );
end $$;

create table public.public_inquiry_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ip           text not null,
  created_at   timestamptz not null default now()
);
alter table public.public_inquiry_log enable row level security;   -- sin políticas: solo funciones
create index public_inquiry_log_idx on public.public_inquiry_log(workspace_id, created_at desc);

create or replace function public.public_venue_inquiry(p_token text, p_venue uuid, p_date date, p_slot text, p_guests int,
  p_name text, p_phone text, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.workspaces; v_headers jsonb; v_ip text; v_cust uuid; v_from timestamp; v_to timestamp; v_num int; v_venue text; v_phone text;
begin
  select * into w from public.workspaces where booking_token = p_token and booking_token is not null;
  if not found or not private.ws_public_ok(w.id) or not private.ws_has_module(w.id, 'venues') then
    return jsonb_build_object('ok', false, 'message', 'Este enlace ya no está disponible.');
  end if;
  select name into v_venue from public.venues where id = p_venue and workspace_id = w.id and is_active;
  if v_venue is null then return jsonb_build_object('ok', false, 'message', 'Elige un espacio.'); end if;
  if p_date is null or p_date < (now() at time zone w.timezone)::date or p_date > (now() at time zone w.timezone)::date + 730 then
    return jsonb_build_object('ok', false, 'message', 'Elige una fecha válida.');
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 3 then return jsonb_build_object('ok', false, 'message', 'Escribe tu nombre completo.'); end if;
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if char_length(v_phone) < 8 then return jsonb_build_object('ok', false, 'message', 'Escribe un teléfono o WhatsApp válido.'); end if;
  begin
    v_headers := current_setting('request.headers', true)::jsonb;
  exception when others then v_headers := '{}'::jsonb; end;
  v_ip := coalesce(nullif(trim(split_part(coalesce(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''), ',', 1)), ''), 'desconocida');
  -- Límites anti-abuso: 5 por hora por dispositivo y 60 por día por negocio.
  if (select count(*) from public.public_inquiry_log where workspace_id = w.id and ip = v_ip and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.public_inquiry_log where workspace_id = w.id and created_at > now() - interval '1 day') >= 60 then
    return jsonb_build_object('ok', false, 'message', 'Recibimos muchas solicitudes. Intenta más tarde o escríbenos por WhatsApp.');
  end if;
  insert into public.public_inquiry_log(workspace_id, ip) values (w.id, v_ip);
  v_from := p_date + case p_slot when 'manana' then time '08:00' when 'tarde' then time '13:00' else time '18:00' end;
  v_to := v_from + interval '5 hours';
  select id into v_cust from public.customers where workspace_id = w.id and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = v_phone limit 1;
  if v_cust is null then
    begin
      insert into public.customers(workspace_id, name, phone, source, status)
      values (w.id, left(trim(p_name), 160), left(trim(p_phone), 40), 'Página de consultas', 'lead') returning id into v_cust;
    exception when sqlstate 'P0001' then
      return jsonb_build_object('ok', false, 'message', 'No pudimos registrar tu consulta. Escríbenos por WhatsApp.');
    end;
  end if;
  insert into public.bookings(workspace_id, kind, status, venue_id, customer_id, title, guests, starts_at, ends_at, source, client_message, currency_code, tax_rate)
  values (w.id, 'event', 'inquiry', p_venue, v_cust, left('Consulta de ' || trim(p_name), 160), greatest(0, least(coalesce(p_guests, 0), 100000)),
          v_from at time zone w.timezone, v_to at time zone w.timezone, 'web', nullif(left(trim(coalesce(p_message, '')), 2000), ''), w.currency_code, w.tax_rate)
  returning number into v_num;
  return jsonb_build_object('ok', true, 'number', v_num);
end $$;

grant execute on function public.public_venues(text), public.public_venue_inquiry(text, uuid, date, text, int, text, text, text) to anon, authenticated;
