-- =====================================================================
-- Eventos360 · Etapa 4 · Business: alquiler de mobiliario y equipo
-- Inventario, reservaciones con control de disponibilidad (sin
-- sobreventa), entregas, devoluciones, daños/mantenimiento, depósitos
-- de garantía y equipo de trabajo con permisos por rol.
-- Reutilizable por otras especialidades (decoración, sonido, vestidos).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permisos por rol dentro del negocio
--   owner/admin: todo · manager: operación + finanzas
--   staff: operación (sin finanzas ni reportes) · viewer: solo lectura
-- ---------------------------------------------------------------------
create or replace function private.role_can_module(p_ws uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_module in ('finance', 'reports') then private.has_ws_role(p_ws, array['owner','admin','manager']::public.member_role[])
    when p_module = 'team' then private.has_ws_role(p_ws, array['owner','admin']::public.member_role[])
    else true end;
$$;

create or replace function private.can_write_module(p_ws uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_write(p_ws) and private.ws_has_module(p_ws, p_module) and private.role_can_module(p_ws, p_module);
$$;

create or replace function private.can_write_any(p_ws uuid, p_modules text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from unnest(p_modules) m where private.can_write_module(p_ws, m));
$$;
grant execute on function private.role_can_module(uuid, text), private.can_write_any(uuid, text[]) to authenticated;

-- La navegación solo muestra los módulos que el rol puede usar.
create or replace function public.workspace_modules_for(p_ws uuid)
returns table (module_key text, label text, sort int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_ws in (select private.user_workspace_ids()) or private.is_platform_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return query select m.* from private.ws_modules(p_ws) m
    where private.is_platform_admin() or private.role_can_module(p_ws, m.module_key)
    order by 3, 2;
end $$;

-- Los cobros solo los ven quienes tienen acceso a finanzas.
drop policy "miembros leen" on public.customer_payments;
create policy "miembros leen" on public.customer_payments for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()) and private.role_can_module(workspace_id, 'finance'));

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
create table public.resources (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 160),
  category         text check (char_length(category) <= 60),
  sku              text check (char_length(sku) <= 40),
  description      text check (char_length(description) <= 2000),
  image_path       text,
  unit             text not null default 'unidad' check (char_length(unit) between 1 and 20),
  total_qty        int not null default 0 check (total_qty between 0 and 1000000),
  rent_price       numeric(14,2) not null default 0 check (rent_price >= 0),
  replacement_cost numeric(14,2) check (replacement_cost >= 0),
  currency_code    char(3) not null default 'NIO' references public.currencies(code),
  is_active        boolean not null default true,
  notes            text check (char_length(notes) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sku)
);
create index resources_ws_idx on public.resources(workspace_id, category, name);
create trigger resources_touch before update on public.resources for each row execute function private.touch_updated_at();

create or replace function private.resources_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enforce_limit(new.workspace_id, 'resources.max',
    (select count(*) from public.resources where workspace_id = new.workspace_id));
  return new;
end $$;
create trigger resources_limit before insert on public.resources for each row execute function private.resources_limit();

-- ---------------------------------------------------------------------
-- Reservaciones (órdenes de alquiler)
--   draft     = cotizando, NO aparta inventario
--   reserved  = apartado: bloquea las unidades en sus fechas
--   out       = entregado al cliente (sigue bloqueando; si se atrasa, bloquea hasta volver)
--   returned  = devuelto y revisado (libera; daños pasan a mantenimiento)
--   canceled  = cancelado (libera)
-- ---------------------------------------------------------------------
create table public.rentals (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  number            int not null,
  customer_id       uuid not null,
  event_id          uuid,
  quote_id          uuid,
  title             text not null check (char_length(title) between 2 and 160),
  status            text not null default 'draft' check (status in ('draft','reserved','out','returned','canceled')),
  starts_at         timestamptz not null,           -- entrega / retiro por el cliente
  ends_at           timestamptz not null,           -- devolución / recolección
  delivery_mode     text not null default 'delivery' check (delivery_mode in ('delivery','pickup')),
  delivery_address  text check (char_length(delivery_address) <= 300),
  delivery_contact  text check (char_length(delivery_contact) <= 120),
  delivery_phone    text check (char_length(delivery_phone) <= 40),
  currency_code     char(3) not null default 'NIO' references public.currencies(code),
  discount_amount   numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_rate          numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  advance_pct       numeric(5,2) not null default 50 check (advance_pct between 0 and 100),
  subtotal          numeric(14,2) not null default 0,
  tax_amount        numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  damage_total      numeric(14,2) not null default 0,     -- cargos por daños/faltantes (de la devolución)
  deposit_amount    numeric(14,2) not null default 0 check (deposit_amount >= 0),   -- garantía solicitada
  deposit_received  numeric(14,2) not null default 0 check (deposit_received >= 0),
  deposit_refunded  numeric(14,2) not null default 0 check (deposit_refunded >= 0),
  deposit_retained  numeric(14,2) not null default 0 check (deposit_retained >= 0),
  deposit_notes     text check (char_length(deposit_notes) <= 1000),
  out_at            timestamptz,
  out_received_by   text check (char_length(out_received_by) <= 120),
  returned_at       timestamptz,
  return_notes      text check (char_length(return_notes) <= 2000),
  notes             text check (char_length(notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  check (ends_at > starts_at),
  check (deposit_refunded + deposit_retained <= deposit_received),
  -- NO ACTION: no se puede borrar un cliente con reservaciones, pero sí todo el espacio en cascada.
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete no action,
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete set null (quote_id)
);
alter table public.rentals add constraint rentals_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
create index rentals_ws_idx on public.rentals(workspace_id, starts_at);
create index rentals_hold_idx on public.rentals(workspace_id, status) where status in ('reserved','out');
create trigger rentals_touch before update on public.rentals for each row execute function private.touch_updated_at();

create table public.rental_items (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  rental_id      uuid not null,
  resource_id    uuid,                 -- null = servicio (transporte, montaje…), no usa inventario
  sort           int not null default 0,
  description    text not null check (char_length(description) between 1 and 300),
  quantity       int not null default 1 check (quantity between 1 and 1000000),
  unit_price     numeric(14,2) not null default 0 check (unit_price >= 0),
  line_total     numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  returned_ok    int check (returned_ok >= 0),
  damaged_qty    int not null default 0 check (damaged_qty >= 0),
  lost_qty       int not null default 0 check (lost_qty >= 0),
  damage_charge  numeric(14,2) not null default 0 check (damage_charge >= 0),
  check_notes    text check (char_length(check_notes) <= 500),
  unique (workspace_id, id),
  check (coalesce(returned_ok, 0) + damaged_qty + lost_qty <= quantity),
  foreign key (workspace_id, rental_id) references public.rentals(workspace_id, id) on delete cascade,
  foreign key (workspace_id, resource_id) references public.resources(workspace_id, id) on delete no action
);
alter table public.rental_items add constraint rental_items_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
create index rental_items_rental_idx on public.rental_items(rental_id, sort);
create index rental_items_resource_idx on public.rental_items(resource_id) where resource_id is not null;

-- ---------------------------------------------------------------------
-- Daños, pérdidas y mantenimiento (unidades fuera de servicio)
-- ---------------------------------------------------------------------
create table public.maintenance_records (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  resource_id      uuid not null,
  rental_id        uuid,
  kind             text not null default 'damaged' check (kind in ('damaged','lost','cleaning','repair')),
  quantity         int not null check (quantity between 1 and 1000000),
  status           text not null default 'open' check (status in ('open','resolved','written_off')),
  description      text check (char_length(description) <= 1000),
  cost             numeric(14,2) check (cost >= 0),
  currency_code    char(3) not null default 'NIO' references public.currencies(code),
  opened_at        timestamptz not null default now(),
  resolved_at      timestamptz,
  resolution_notes text check (char_length(resolution_notes) <= 1000),
  created_by       uuid references public.profiles(id) on delete set null,
  unique (workspace_id, id),
  foreign key (workspace_id, resource_id) references public.resources(workspace_id, id) on delete cascade,
  foreign key (workspace_id, rental_id) references public.rentals(workspace_id, id) on delete set null (rental_id)
);
alter table public.maintenance_records add constraint maintenance_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
create index maintenance_ws_idx on public.maintenance_records(workspace_id, status, opened_at desc);
create index maintenance_open_idx on public.maintenance_records(resource_id) where status = 'open';

-- Vínculos con cotizaciones, cobros y contratos
alter table public.quote_items add column resource_id uuid,
  add constraint quote_items_resource_fk foreign key (workspace_id, resource_id)
    references public.resources(workspace_id, id) on delete set null (resource_id);
alter table public.customer_payments add column rental_id uuid,
  add constraint customer_payments_rental_fk foreign key (workspace_id, rental_id)
    references public.rentals(workspace_id, id) on delete set null (rental_id);
create index customer_payments_rental_idx on public.customer_payments(rental_id) where rental_id is not null;
alter table public.contracts add column rental_id uuid,
  add constraint contracts_rental_fk foreign key (workspace_id, rental_id)
    references public.rentals(workspace_id, id) on delete set null (rental_id);
grant insert (rental_id), update (rental_id) on public.contracts to authenticated;

-- =====================================================================
-- Motor de disponibilidad
-- =====================================================================
-- Rango que bloquea una reservación. Si fue entregada y ya pasó la fecha de
-- devolución sin recibirla, bloquea indefinidamente hasta que regrese.
create or replace function private.rental_hold(p_status text, p_starts timestamptz, p_ends timestamptz)
returns tstzrange language sql stable set search_path = '' as $$
  select case when p_status = 'out' and p_ends <= now() then tstzrange(p_starts, null, '[)')
              else tstzrange(p_starts, p_ends, '[)') end;
$$;

-- Unidades fuera de servicio (daños, pérdidas, limpieza o reparación abiertos).
create or replace function private.resource_out_of_service(p_resource uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(quantity), 0)::int from public.maintenance_records where resource_id = p_resource and status = 'open';
$$;

-- Máximo de unidades comprometidas AL MISMO TIEMPO dentro de [p_from, p_to).
-- (Dos reservas que no se cruzan entre sí no suman: se calcula el pico real.)
create or replace function private.resource_peak(p_resource uuid, p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns int language sql stable security definer set search_path = '' as $$
  with rel as (
    select i.quantity, private.rental_hold(r.status, r.starts_at, r.ends_at) as rg
    from public.rental_items i
    join public.rentals r on r.id = i.rental_id
    where i.resource_id = p_resource and r.status in ('reserved','out')
      and (p_exclude is null or r.id <> p_exclude)
      and private.rental_hold(r.status, r.starts_at, r.ends_at) && tstzrange(p_from, p_to, '[)')
  ), pts as (
    select p_from as p
    union select lower(rg) from rel where lower(rg) > p_from and lower(rg) < p_to
  )
  select coalesce(max((select coalesce(sum(rel.quantity), 0) from rel where rel.rg @> pts.p)), 0)::int from pts;
$$;

-- Disponible para un rango (puede ser negativo si hay faltante).
create or replace function private.resource_available(p_resource uuid, p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns int language sql stable security definer set search_path = '' as $$
  select r.total_qty - private.resource_out_of_service(r.id) - private.resource_peak(r.id, p_from, p_to, p_exclude)
  from public.resources r where r.id = p_resource;
$$;

-- Verifica que una reservación que aparta inventario no exceda lo disponible.
-- Bloqueo por artículo (en orden) para que dos reservas simultáneas no tomen las mismas unidades.
create or replace function private.check_rental_stock(p_rental uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.rentals; r record; v_to timestamptz; v_avail int;
begin
  select * into v from public.rentals where id = p_rental;
  if not found or v.status not in ('reserved','out') then return; end if;
  -- Se valida con sus propias fechas; el bloqueo indefinido por atraso solo afecta a las demás reservas.
  v_to := v.ends_at;
  for r in
    select i.resource_id, sum(i.quantity)::int as qty
    from public.rental_items i where i.rental_id = p_rental and i.resource_id is not null
    group by i.resource_id order by i.resource_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('e360-resource-' || r.resource_id::text, 0));
    v_avail := private.resource_available(r.resource_id, v.starts_at, v_to, p_rental);
    if r.qty > v_avail then
      raise exception 'No hay suficientes "%" para esas fechas: pides %, disponibles %.',
        (select name from public.resources where id = r.resource_id), r.qty, greatest(v_avail, 0)
        using errcode = 'P0001', hint = 'stock_unavailable';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Reglas de reservaciones
-- ---------------------------------------------------------------------
create or replace function private.rentals_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sub numeric(14,2); v_disc numeric(14,2); v_returning boolean := coalesce(current_setting('eventos360.returning', true) = 'on', false);
begin
  if tg_op = 'INSERT' then
    new.number := private.next_number(new.workspace_id, 'rental');
    if new.status not in ('draft','reserved') then new.status := 'draft'; end if;
    new.out_at := null; new.returned_at := null; new.damage_total := 0;
  else
    new.number := old.number;
    -- Transiciones de estado permitidas
    if new.status <> old.status then
      if not (
        (old.status = 'draft'    and new.status in ('reserved','canceled')) or
        (old.status = 'reserved' and new.status in ('draft','out','canceled')) or
        (old.status = 'out'      and new.status = 'returned' and v_returning) or
        (old.status = 'out'      and new.status = 'reserved') or      -- deshacer una entrega registrada por error
        (old.status = 'canceled' and new.status = 'draft')
      ) then
        if new.status = 'returned' then
          raise exception 'Para cerrar la reservación registra la devolución (revisión de artículos).' using errcode = 'P0001';
        end if;
        raise exception 'No se puede pasar de "%" a "%".', old.status, new.status using errcode = 'P0001';
      end if;
    end if;
    if new.status = 'out' and old.status <> 'out' then new.out_at := now();
    elsif new.status <> 'out' and new.status <> 'returned' then new.out_at := null; new.out_received_by := null;
    else new.out_at := old.out_at; end if;
    if new.status = 'returned' and old.status <> 'returned' then new.returned_at := now(); else new.returned_at := old.returned_at; end if;
    -- Una vez entregada no cambia el cliente ni la moneda; devuelta, tampoco las fechas ni los precios.
    if old.status in ('out','returned') and (new.customer_id <> old.customer_id or new.currency_code <> old.currency_code or new.starts_at <> old.starts_at) then
      raise exception 'La reservación ya fue entregada: no se puede cambiar el cliente, la moneda ni la fecha de entrega.' using errcode = 'P0001';
    end if;
    if old.status = 'returned' and (new.ends_at <> old.ends_at or new.discount_amount <> old.discount_amount or new.tax_rate <> old.tax_rate) then
      raise exception 'La reservación ya está cerrada: no se pueden cambiar fechas ni precios.' using errcode = 'P0001';
    end if;
  end if;
  select coalesce(sum(line_total), 0), coalesce(sum(damage_charge), 0) into v_sub, new.damage_total
    from public.rental_items where rental_id = new.id;
  v_disc := least(new.discount_amount, v_sub);
  new.subtotal := v_sub;
  new.tax_amount := round((v_sub - v_disc) * new.tax_rate / 100, 2);
  new.total := v_sub - v_disc + new.tax_amount;
  if new.deposit_refunded + new.deposit_retained > new.deposit_received then
    raise exception 'Lo devuelto más lo retenido no puede superar el depósito recibido.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger rentals_before before insert or update on public.rentals for each row execute function private.rentals_before();

create or replace function private.rentals_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('reserved','out') and (tg_op = 'INSERT' or new.status <> old.status
      or new.starts_at <> old.starts_at or new.ends_at <> old.ends_at) then
    perform private.check_rental_stock(new.id);
  end if;
  return null;
end $$;
create trigger rentals_after after insert or update on public.rentals for each row execute function private.rentals_after();

create or replace function private.rental_items_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text; v_returning boolean := coalesce(current_setting('eventos360.returning', true) = 'on', false);
begin
  select status into v_status from public.rentals where id = coalesce(new.rental_id, old.rental_id);
  if tg_op = 'DELETE' then
    -- Al eliminar todo el espacio (cascada) no se aplican las reglas.
    if v_status in ('out','returned') and exists (select 1 from public.workspaces where id = old.workspace_id) then
      raise exception 'La reservación ya fue entregada: no se pueden quitar artículos.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not v_returning then
    -- Los datos de revisión solo los escribe el registro de devolución.
    if tg_op = 'INSERT' then
      new.returned_ok := null; new.damaged_qty := 0; new.lost_qty := 0; new.damage_charge := 0; new.check_notes := null;
    else
      new.returned_ok := old.returned_ok; new.damaged_qty := old.damaged_qty; new.lost_qty := old.lost_qty;
      new.damage_charge := old.damage_charge; new.check_notes := old.check_notes;
    end if;
    if v_status in ('out','returned') and (tg_op = 'INSERT' or new.quantity <> old.quantity
        or new.resource_id is distinct from old.resource_id or new.unit_price <> old.unit_price) then
      raise exception 'La reservación ya fue entregada: no se pueden cambiar los artículos ni sus precios.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' then new.rental_id := old.rental_id; end if;
  return new;
end $$;
create trigger rental_items_before before insert or update or delete on public.rental_items for each row execute function private.rental_items_before();

create or replace function private.rental_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.rentals set updated_at = now() where id = coalesce(new.rental_id, old.rental_id);   -- recalcula totales
  if tg_op <> 'DELETE' and new.resource_id is not null then
    perform private.check_rental_stock(new.rental_id);
  end if;
  return null;
end $$;
create trigger rental_items_after after insert or update or delete on public.rental_items for each row execute function private.rental_items_after();

-- ---------------------------------------------------------------------
-- Reglas de mantenimiento
-- ---------------------------------------------------------------------
create or replace function private.maintenance_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_total int;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'open' and exists (select 1 from public.resources where id = old.resource_id) then
      raise exception 'Un registro cerrado no se puede eliminar.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'open'; new.resolved_at := null; new.opened_at := now();
    new.created_by := coalesce(new.created_by, (select auth.uid()));
    perform pg_advisory_xact_lock(hashtextextended('e360-resource-' || new.resource_id::text, 0));
    select total_qty into v_total from public.resources where id = new.resource_id;
    if new.quantity + private.resource_out_of_service(new.resource_id) > v_total then
      raise exception 'No puedes registrar más unidades de las que existen en inventario (% en total, % ya fuera de servicio).',
        v_total, private.resource_out_of_service(new.resource_id) using errcode = 'P0001';
    end if;
    return new;
  end if;
  new.resource_id := old.resource_id; new.rental_id := old.rental_id; new.opened_at := old.opened_at; new.created_by := old.created_by;
  if old.status <> 'open' then
    raise exception 'Este registro ya está cerrado.' using errcode = 'P0001';
  end if;
  if new.quantity <> old.quantity and new.quantity > old.quantity then
    if new.quantity - old.quantity + private.resource_out_of_service(new.resource_id)
       > (select total_qty from public.resources where id = new.resource_id) then
      raise exception 'No puedes registrar más unidades de las que existen en inventario.' using errcode = 'P0001';
    end if;
  end if;
  if new.status <> 'open' then
    new.resolved_at := now();
    if new.status = 'written_off' then
      -- Baja definitiva: las unidades salen del inventario.
      update public.resources set total_qty = greatest(0, total_qty - new.quantity) where id = new.resource_id;
    end if;
  end if;
  return new;
end $$;
create trigger maintenance_before before insert or update or delete on public.maintenance_records
  for each row execute function private.maintenance_before();

-- Resolver solo una parte: el resto sigue fuera de servicio en un registro nuevo.
create or replace function private.maintenance_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'open' and new.status <> 'open' and new.quantity < old.quantity then
    insert into public.maintenance_records(workspace_id, resource_id, rental_id, kind, quantity, description, currency_code, created_by)
    values (old.workspace_id, old.resource_id, old.rental_id, old.kind, old.quantity - new.quantity, old.description, old.currency_code, old.created_by);
  end if;
  return null;
end $$;
create trigger maintenance_after after update on public.maintenance_records
  for each row execute function private.maintenance_after();

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare t record;
begin
  for t in select * from (values
    ('resources', array['inventory']),
    ('rentals', array['reservations','deliveries','returns']),
    ('rental_items', array['reservations','deliveries','returns']),
    ('maintenance_records', array['maintenance','returns','inventory'])
  ) as x(tbl, modules)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('revoke all on public.%I from anon', t.tbl);
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
-- Una reservación entregada o cerrada es historial: no se borra (se puede cancelar antes de entregar).
drop policy "miembros eliminan" on public.rentals;
create policy "miembros eliminan" on public.rentals for delete to authenticated
  using (private.can_write_module(workspace_id, 'reservations') and status in ('draft','canceled'));

-- =====================================================================
-- Consultas y acciones
-- =====================================================================
-- Disponibilidad de todo el inventario para un rango de fechas.
create or replace function public.rental_availability(p_ws uuid, p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns table (resource_id uuid, total int, out_of_service int, committed int, available int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_to <= p_from then raise exception 'La fecha final debe ser posterior a la inicial.' using errcode = 'P0001'; end if;
  return query
    select r.id, r.total_qty, private.resource_out_of_service(r.id), private.resource_peak(r.id, p_from, p_to, p_exclude),
           r.total_qty - private.resource_out_of_service(r.id) - private.resource_peak(r.id, p_from, p_to, p_exclude)
    from public.resources r where r.workspace_id = p_ws and r.is_active;
end $$;

-- Disponibilidad día por día (zona horaria del negocio), hasta 31 días.
create or replace function public.rental_availability_days(p_ws uuid, p_from date, p_days int default 14)
returns table (resource_id uuid, day date, available int, committed int)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select timezone into v_tz from public.workspaces where id = p_ws;
  return query
    with d as (select (p_from + g)::date as day from generate_series(0, least(greatest(p_days, 1), 31) - 1) g)
    select r.id, d.day,
           r.total_qty - private.resource_out_of_service(r.id)
             - private.resource_peak(r.id, (d.day::timestamp at time zone v_tz), ((d.day + 1)::timestamp at time zone v_tz)),
           private.resource_peak(r.id, (d.day::timestamp at time zone v_tz), ((d.day + 1)::timestamp at time zone v_tz))
    from public.resources r cross join d
    where r.workspace_id = p_ws and r.is_active;
end $$;

-- Reservaciones activas que hoy no tienen unidades suficientes (por daños, bajas o ajustes de inventario).
create or replace function public.rental_shortages(p_ws uuid)
returns table (rental_id uuid, rental_number int, title text, starts_at timestamptz, resource_id uuid, resource_name text, requested int, available int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select x.id, x.number, x.title, x.starts_at, x.resource_id, x.name, x.qty, x.avail from (
      select r.id, r.number, r.title, r.starts_at, i.resource_id, res.name, sum(i.quantity)::int as qty,
             private.resource_available(i.resource_id, r.starts_at,
               coalesce(upper(private.rental_hold(r.status, r.starts_at, r.ends_at)), 'infinity'), r.id) as avail
      from public.rentals r
      join public.rental_items i on i.rental_id = r.id and i.resource_id is not null
      join public.resources res on res.id = i.resource_id
      where r.workspace_id = p_ws and r.status = 'reserved' and r.ends_at > now()
      group by r.id, r.number, r.title, r.starts_at, r.status, r.ends_at, i.resource_id, res.name
    ) x where x.qty > x.avail
    order by x.starts_at;
end $$;

-- Registro de devolución: revisa cada artículo, cierra la reservación y
-- envía lo dañado o perdido a mantenimiento (fuera de servicio).
create or replace function public.rental_register_return(p_rental uuid, p_items jsonb, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.rentals; it public.rental_items; e jsonb; v_ok int; v_dmg int; v_lost int; v_charge numeric;
begin
  select * into v from public.rentals where id = p_rental for update;
  if not found or not private.can_write_any(v.workspace_id, array['returns','reservations']) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v.status <> 'out' then raise exception 'Solo se registra la devolución de una reservación entregada.' using errcode = 'P0001'; end if;
  perform set_config('eventos360.returning', 'on', true);
  for it in select * from public.rental_items where rental_id = p_rental loop
    if it.resource_id is null then continue; end if;
    e := null;
    select x.value into e from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x(value) where x.value->>'id' = it.id::text limit 1;
    v_dmg := greatest(coalesce((e->>'damaged')::int, 0), 0);
    v_lost := greatest(coalesce((e->>'lost')::int, 0), 0);
    v_charge := greatest(coalesce((e->>'charge')::numeric, 0), 0);
    v_ok := it.quantity - v_dmg - v_lost;
    if v_ok < 0 then
      raise exception 'En "%" los dañados y perdidos superan la cantidad entregada.', it.description using errcode = 'P0001';
    end if;
    update public.rental_items set returned_ok = v_ok, damaged_qty = v_dmg, lost_qty = v_lost, damage_charge = round(v_charge, 2),
      check_notes = nullif(left(trim(coalesce(e->>'notes', '')), 500), '') where id = it.id;
    if v_dmg > 0 then
      insert into public.maintenance_records(workspace_id, resource_id, rental_id, kind, quantity, description, currency_code)
      values (v.workspace_id, it.resource_id, v.id, 'damaged', v_dmg,
              'Dañado en devolución de RES-' || lpad(v.number::text, 4, '0') || coalesce(': ' || nullif(trim(e->>'notes'), ''), ''), v.currency_code);
    end if;
    if v_lost > 0 then
      insert into public.maintenance_records(workspace_id, resource_id, rental_id, kind, quantity, description, currency_code)
      values (v.workspace_id, it.resource_id, v.id, 'lost', v_lost,
              'Faltante en devolución de RES-' || lpad(v.number::text, 4, '0') || coalesce(': ' || nullif(trim(e->>'notes'), ''), ''), v.currency_code);
    end if;
  end loop;
  update public.rentals set status = 'returned', return_notes = nullif(left(trim(coalesce(p_notes, '')), 2000), '') where id = p_rental;
  perform set_config('eventos360.returning', 'off', true);
  insert into public.audit_logs(workspace_id, actor_id, action, entity, entity_id)
  values (v.workspace_id, (select auth.uid()), 'rental.returned', 'rental', p_rental::text);
end $$;

-- Panel del negocio de alquiler (cifras reales).
create or replace function public.rental_dashboard(p_ws uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_today timestamptz; v_tomorrow timestamptz;
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select timezone into v_tz from public.workspaces where id = p_ws;
  v_today := (now() at time zone v_tz)::date::timestamp at time zone v_tz;
  v_tomorrow := v_today + interval '1 day';
  return jsonb_build_object(
    'resources',          (select count(*) from public.resources where workspace_id = p_ws and is_active),
    'units',              (select coalesce(sum(total_qty), 0) from public.resources where workspace_id = p_ws and is_active),
    'deliveries_today',   (select count(*) from public.rentals where workspace_id = p_ws and status = 'reserved' and starts_at >= v_today and starts_at < v_tomorrow),
    'deliveries_overdue', (select count(*) from public.rentals where workspace_id = p_ws and status = 'reserved' and starts_at < v_today),
    'deliveries_week',    (select count(*) from public.rentals where workspace_id = p_ws and status = 'reserved' and starts_at >= v_today and starts_at < v_today + interval '7 days'),
    'returns_today',      (select count(*) from public.rentals where workspace_id = p_ws and status = 'out' and ends_at >= v_today and ends_at < v_tomorrow),
    'returns_pending',    (select count(*) from public.rentals where workspace_id = p_ws and status = 'out'),
    'returns_overdue',    (select count(*) from public.rentals where workspace_id = p_ws and status = 'out' and ends_at < now()),
    'drafts',             (select count(*) from public.rentals where workspace_id = p_ws and status = 'draft'),
    'maintenance_units',  (select coalesce(sum(quantity), 0) from public.maintenance_records where workspace_id = p_ws and status = 'open'),
    'deposits_held',      (select coalesce(jsonb_object_agg(currency_code, amt), '{}') from (
                             select currency_code, sum(deposit_received - deposit_refunded - deposit_retained) amt
                             from public.rentals where workspace_id = p_ws group by currency_code
                             having sum(deposit_received - deposit_refunded - deposit_retained) <> 0) d)
  );
end $$;

revoke execute on function public.rental_availability(uuid, timestamptz, timestamptz, uuid), public.rental_availability_days(uuid, date, int),
  public.rental_shortages(uuid), public.rental_register_return(uuid, jsonb, text), public.rental_dashboard(uuid) from public, anon;
grant execute on function public.rental_availability(uuid, timestamptz, timestamptz, uuid), public.rental_availability_days(uuid, date, int),
  public.rental_shortages(uuid), public.rental_register_return(uuid, jsonb, text), public.rental_dashboard(uuid) to authenticated;

-- =====================================================================
-- Equipo de trabajo (cuentas creadas por el propietario, sin correo)
-- =====================================================================
create or replace function public.team_members(p_ws uuid)
returns table (user_id uuid, username text, full_name text, phone text, role public.member_role, is_disabled boolean,
               must_change_password boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select p.id, p.username::text, p.full_name, p.phone, m.role, p.is_disabled, p.must_change_password, m.created_at
    from public.workspace_members m join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_ws
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 when 'staff' then 3 else 4 end, p.full_name;
end $$;

-- ¿Puede p_caller administrar a p_target en p_ws? (p_target null = crear uno nuevo con p_role)
create or replace function private.team_can_manage(p_ws uuid, p_caller uuid, p_target uuid, p_role public.member_role)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_caller public.member_role; v_target public.member_role; v_kind public.workspace_kind;
begin
  select kind into v_kind from public.workspaces where id = p_ws and not is_disabled;
  if v_kind is null or v_kind <> 'business' then return 'El equipo de trabajo está disponible en Eventos360 Business.'; end if;
  if not exists (select 1 from public.subscriptions where workspace_id = p_ws and status in ('trialing','active','past_due')) then
    return 'Tu suscripción no está vigente.';
  end if;
  select m.role into v_caller from public.workspace_members m join public.profiles p on p.id = m.user_id
   where m.workspace_id = p_ws and m.user_id = p_caller and not p.is_disabled;
  if v_caller is null or v_caller not in ('owner','admin') then return 'Solo el propietario o un administrador puede gestionar el equipo.'; end if;
  if p_role = 'owner' then return 'Solo puede haber un propietario.'; end if;
  if p_role = 'admin' and v_caller <> 'owner' then return 'Solo el propietario puede nombrar administradores.'; end if;
  if p_target is not null then
    if p_target = p_caller then return 'No puedes cambiar tu propia cuenta desde aquí.'; end if;
    select role into v_target from public.workspace_members where workspace_id = p_ws and user_id = p_target;
    if v_target is null then return 'Ese usuario no pertenece a tu equipo.'; end if;
    if v_target = 'owner' then return 'No se puede modificar al propietario.'; end if;
    if v_target = 'admin' and v_caller <> 'owner' then return 'Solo el propietario puede gestionar administradores.'; end if;
  end if;
  return null;
end $$;

create or replace function public.team_set_role(p_ws uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_err text;
begin
  v_err := private.team_can_manage(p_ws, (select auth.uid()), p_user, p_role);
  if v_err is not null then raise exception '%', v_err using errcode = 'P0001'; end if;
  update public.workspace_members set role = p_role where workspace_id = p_ws and user_id = p_user;
  insert into public.audit_logs(workspace_id, actor_id, action, entity, entity_id, details)
  values (p_ws, (select auth.uid()), 'team.role_changed', 'profile', p_user::text, jsonb_build_object('role', p_role));
end $$;
revoke execute on function public.team_members(uuid), public.team_set_role(uuid, uuid, public.member_role) from public, anon;
grant execute on function public.team_members(uuid), public.team_set_role(uuid, uuid, public.member_role) to authenticated;

-- Llamadas desde la Edge Function `team` (service role).
create or replace function public.svc_team_check(p_ws uuid, p_caller uuid, p_target uuid, p_role public.member_role)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_err text; v_other int; v_admin boolean;
begin
  v_err := private.team_can_manage(p_ws, p_caller, p_target, coalesce(p_role, 'staff'));
  if v_err is not null then return jsonb_build_object('ok', false, 'message', v_err); end if;
  if p_target is null then
    begin
      perform private.enforce_limit(p_ws, 'members.max', (select count(*) from public.workspace_members where workspace_id = p_ws));
    exception when others then
      return jsonb_build_object('ok', false, 'message', sqlerrm);
    end;
    return jsonb_build_object('ok', true);
  end if;
  -- La cuenta solo se puede restablecer/borrar si pertenece únicamente a este negocio.
  select count(*) into v_other from public.workspace_members where user_id = p_target and workspace_id <> p_ws;
  v_admin := exists (select 1 from public.platform_admins where user_id = p_target);
  return jsonb_build_object('ok', true, 'exclusive', v_other = 0 and not v_admin);
end $$;

create or replace function public.svc_team_add(p_ws uuid, p_caller uuid, p_user uuid, p_username text, p_full_name text, p_phone text, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_err text;
begin
  v_err := private.team_can_manage(p_ws, p_caller, null, p_role);
  if v_err is not null then raise exception '%', v_err using errcode = 'P0001'; end if;
  perform private.enforce_limit(p_ws, 'members.max', (select count(*) from public.workspace_members where workspace_id = p_ws));
  insert into public.profiles(id, username, full_name, phone, must_change_password)
  values (p_user, lower(p_username), trim(p_full_name), nullif(trim(p_phone), ''), true);
  insert into public.workspace_members(workspace_id, user_id, role) values (p_ws, p_user, p_role);
  insert into public.audit_logs(workspace_id, actor_id, action, entity, entity_id, details)
  values (p_ws, p_caller, 'team.member_added', 'profile', p_user::text, jsonb_build_object('username', lower(p_username), 'role', p_role));
end $$;

create or replace function public.svc_team_remove(p_ws uuid, p_caller uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  v := public.svc_team_check(p_ws, p_caller, p_user, 'staff');
  if not (v->>'ok')::boolean then raise exception '%', v->>'message' using errcode = 'P0001'; end if;
  delete from public.workspace_members where workspace_id = p_ws and user_id = p_user;
  insert into public.audit_logs(workspace_id, actor_id, action, entity, entity_id)
  values (p_ws, p_caller, 'team.member_removed', 'profile', p_user::text);
  return v;
end $$;

create or replace function public.svc_team_log(p_ws uuid, p_caller uuid, p_user uuid, p_action text)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(workspace_id, actor_id, action, entity, entity_id) values (p_ws, p_caller, p_action, 'profile', p_user::text);
$$;

revoke execute on function public.svc_team_check(uuid, uuid, uuid, public.member_role), public.svc_team_add(uuid, uuid, uuid, text, text, text, public.member_role),
  public.svc_team_remove(uuid, uuid, uuid), public.svc_team_log(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.svc_team_check(uuid, uuid, uuid, public.member_role), public.svc_team_add(uuid, uuid, uuid, text, text, text, public.member_role),
  public.svc_team_remove(uuid, uuid, uuid), public.svc_team_log(uuid, uuid, uuid, text) to service_role;

-- =====================================================================
-- Catálogo: el motor de inventario también sirve a vestidos y trajes.
-- =====================================================================
insert into public.specialty_modules(specialty_key, module_key, sort, label_override)
values ('attire', 'inventory', 15, 'Prendas')
on conflict do nothing;
