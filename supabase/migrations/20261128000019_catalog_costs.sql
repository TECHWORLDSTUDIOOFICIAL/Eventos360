-- =====================================================================
-- Eventos360 · Etapa 6 · Catálogo, paquetes, costos reales y gastos
-- Lo que se cobra no es todo ganancia: cada servicio tiene su costo
-- (materiales, mano de obra, proveedor, transporte), el IVA no es
-- ingreso, y el negocio tiene gastos fijos. (Migración solo aditiva.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Módulos: catálogo y paquetes también en Profesional; más especialidades
-- ---------------------------------------------------------------------
update public.modules set kinds = array_append(kinds, 'professional'::public.workspace_kind) where key in ('catalog','packages') and not ('professional' = any(kinds));
update public.modules set default_kinds = array_append(default_kinds, 'professional'::public.workspace_kind) where key in ('catalog','packages') and not ('professional' = any(default_kinds));
update public.modules set name = 'Catálogo' where key = 'catalog';
insert into public.specialty_modules(specialty_key, module_key, sort, label_override) values
  ('catering', 'catalog', 15, 'Servicios y platos'),
  ('photo_video', 'catalog', 25, 'Servicios'),
  ('venue', 'catalog', 45, 'Servicios adicionales'),
  ('venue', 'packages', 46, null)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Catálogo de servicios y productos
-- ---------------------------------------------------------------------
create table public.catalog_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  kind          text not null default 'service' check (kind in ('service','product','rental')),
  name          text not null check (char_length(name) between 2 and 160),
  category      text check (char_length(category) <= 60),
  description   text check (char_length(description) <= 3000),
  image_path    text,
  unit          text not null default 'unidad' check (char_length(unit) between 1 and 30),
  price         numeric(14,2) not null default 0 check (price >= 0),
  cost_total    numeric(14,2) not null default 0,          -- calculado: suma de sus costos
  currency_code char(3) not null default 'NIO' references public.currencies(code),
  is_active     boolean not null default true,
  notes         text check (char_length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id)
);
create index catalog_items_ws_idx on public.catalog_items(workspace_id, category, name);
create trigger catalog_items_touch before update on public.catalog_items for each row execute function private.touch_updated_at();

create or replace function private.catalog_items_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enforce_limit(new.workspace_id, 'catalog_items.max', (select count(*) from public.catalog_items where workspace_id = new.workspace_id));
  return new;
end $$;
create trigger catalog_items_limit before insert on public.catalog_items for each row execute function private.catalog_items_limit();

-- Paquetes: varios elementos del catálogo con un precio propio
create table public.packages (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 160),
  description   text check (char_length(description) <= 3000),
  image_path    text,
  price         numeric(14,2) not null default 0 check (price >= 0),
  cost_total    numeric(14,2) not null default 0,          -- calculado: elementos + costos propios
  items_value   numeric(14,2) not null default 0,          -- calculado: precio de los elementos por separado
  currency_code char(3) not null default 'NIO' references public.currencies(code),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id)
);
create index packages_ws_idx on public.packages(workspace_id, name);
create trigger packages_touch before update on public.packages for each row execute function private.touch_updated_at();

create table public.package_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  package_id   uuid not null,
  item_id      uuid not null,
  quantity     numeric(10,2) not null default 1 check (quantity > 0),
  sort         int not null default 0,
  unique (workspace_id, id),
  unique (package_id, item_id),
  foreign key (workspace_id, package_id) references public.packages(workspace_id, id) on delete cascade,
  foreign key (workspace_id, item_id) references public.catalog_items(workspace_id, id) on delete cascade
);

-- Desglose de costos de un servicio o de un paquete (costos propios del paquete)
create table public.catalog_costs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_id      uuid,
  package_id   uuid,
  kind         text not null default 'material' check (kind in ('material','labor','supplier','transport','other')),
  description  text not null check (char_length(description) between 1 and 200),
  amount       numeric(14,2) not null default 0 check (amount >= 0),
  supplier_id  uuid,
  sort         int not null default 0,
  unique (workspace_id, id),
  check ((item_id is null) <> (package_id is null)),
  foreign key (workspace_id, item_id) references public.catalog_items(workspace_id, id) on delete cascade,
  foreign key (workspace_id, package_id) references public.packages(workspace_id, id) on delete cascade,
  foreign key (workspace_id, supplier_id) references public.suppliers(workspace_id, id) on delete set null (supplier_id)
);
create index catalog_costs_item_idx on public.catalog_costs(item_id) where item_id is not null;
create index catalog_costs_package_idx on public.catalog_costs(package_id) where package_id is not null;

-- Recalcular costos (el cliente no puede escribir estos totales)
create or replace function private.recalc_package(p_package uuid)
returns void language sql security definer set search_path = '' as $$
  update public.packages p set
    cost_total = coalesce((select sum(c.amount) from public.catalog_costs c where c.package_id = p.id), 0)
               + coalesce((select sum(pi.quantity * ci.cost_total) from public.package_items pi join public.catalog_items ci on ci.id = pi.item_id where pi.package_id = p.id), 0),
    items_value = coalesce((select sum(pi.quantity * ci.price) from public.package_items pi join public.catalog_items ci on ci.id = pi.item_id where pi.package_id = p.id), 0)
  where p.id = p_package;
$$;

create or replace function private.recalc_item(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update public.catalog_items set cost_total = coalesce((select sum(amount) from public.catalog_costs where item_id = p_item), 0) where id = p_item;
  for r in select distinct package_id from public.package_items where item_id = p_item loop
    perform private.recalc_package(r.package_id);
  end loop;
end $$;

create or replace function private.catalog_costs_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.item_id, old.item_id) is not null then perform private.recalc_item(coalesce(new.item_id, old.item_id)); end if;
  if tg_op = 'UPDATE' and old.item_id is not null and old.item_id is distinct from new.item_id then perform private.recalc_item(old.item_id); end if;
  if coalesce(new.package_id, old.package_id) is not null then perform private.recalc_package(coalesce(new.package_id, old.package_id)); end if;
  return null;
end $$;
create trigger catalog_costs_after after insert or update or delete on public.catalog_costs for each row execute function private.catalog_costs_after();

create or replace function private.package_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalc_package(coalesce(new.package_id, old.package_id));
  return null;
end $$;
create trigger package_items_after after insert or update or delete on public.package_items for each row execute function private.package_items_after();

-- Si cambia el precio de un servicio, cambia el "valor por separado" de sus paquetes; el costo se protege.
create or replace function private.catalog_items_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.cost_total := 0;
  elsif current_setting('eventos360.recalc', true) is distinct from 'on' then
    new.cost_total := coalesce((select sum(amount) from public.catalog_costs where item_id = new.id), 0);
  end if;
  return new;
end $$;
create trigger catalog_items_before before insert or update on public.catalog_items for each row execute function private.catalog_items_before();
create or replace function private.catalog_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.price is distinct from old.price or new.cost_total is distinct from old.cost_total then
    for r in select distinct package_id from public.package_items where item_id = new.id loop
      perform private.recalc_package(r.package_id);
    end loop;
  end if;
  return null;
end $$;
create trigger catalog_items_after after update on public.catalog_items for each row execute function private.catalog_items_after();
create or replace function private.packages_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.cost_total := 0; new.items_value := 0;
  else
    new.cost_total := coalesce((select sum(c.amount) from public.catalog_costs c where c.package_id = new.id), 0)
                    + coalesce((select sum(pi.quantity * ci.cost_total) from public.package_items pi join public.catalog_items ci on ci.id = pi.item_id where pi.package_id = new.id), 0);
    new.items_value := coalesce((select sum(pi.quantity * ci.price) from public.package_items pi join public.catalog_items ci on ci.id = pi.item_id where pi.package_id = new.id), 0);
  end if;
  return new;
end $$;
create trigger packages_before before insert or update on public.packages for each row execute function private.packages_before();

-- ---------------------------------------------------------------------
-- Costos en cotizaciones y reservas (solo los ve el negocio)
-- ---------------------------------------------------------------------
alter table public.quote_items
  add column unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  add column supplier_id uuid,
  add column catalog_item_id uuid,
  add column package_id uuid,
  add constraint quote_items_supplier_fk foreign key (workspace_id, supplier_id) references public.suppliers(workspace_id, id) on delete set null (supplier_id),
  add constraint quote_items_catalog_fk foreign key (workspace_id, catalog_item_id) references public.catalog_items(workspace_id, id) on delete set null (catalog_item_id),
  add constraint quote_items_package_fk foreign key (workspace_id, package_id) references public.packages(workspace_id, id) on delete set null (package_id);
alter table public.quotes add column cost_total numeric(14,2) not null default 0;

alter table public.booking_items
  add column unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  add column supplier_id uuid,
  add constraint booking_items_supplier_fk foreign key (workspace_id, supplier_id) references public.suppliers(workspace_id, id) on delete set null (supplier_id);
alter table public.bookings add column cost_total numeric(14,2) not null default 0;

-- Totales de la cotización: se agrega el costo (lo demás igual que antes).
create or replace function private.quotes_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sub numeric(14,2); v_disc numeric(14,2);
begin
  if tg_op = 'INSERT' then
    new.number := private.next_number(new.workspace_id, 'quote');
  else
    new.number := old.number;
    new.public_token := old.public_token;
  end if;
  select coalesce(sum(line_total), 0), coalesce(sum(round(quantity * unit_cost, 2)), 0) into v_sub, new.cost_total
    from public.quote_items where quote_id = new.id;
  v_disc := least(new.discount_amount, v_sub);
  new.subtotal := v_sub;
  new.tax_amount := round((v_sub - v_disc) * new.tax_rate / 100, 2);
  new.total := v_sub - v_disc + new.tax_amount;
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') and new.accepted_at is null then
    new.accepted_at := now();
  end if;
  return new;
end $$;

-- Costo de la reserva de espacio (sumado a sus reglas actuales).
create or replace function private.bookings_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.cost_total := coalesce((select sum(round(quantity * unit_cost, 2)) from public.booking_items where booking_id = new.id), 0);
  return new;
end $$;
create trigger bookings_cost before insert or update on public.bookings for each row execute function private.bookings_cost();

-- ---------------------------------------------------------------------
-- Gastos del negocio (fijos y generales: alquiler, salarios, luz…)
-- ---------------------------------------------------------------------
create table public.business_expenses (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  spent_at      date not null default current_date,
  category      text not null default 'otros' check (category in ('alquiler','salarios','servicios_basicos','transporte','publicidad','impuestos','mantenimiento','compras','comisiones','otros')),
  description   text not null check (char_length(description) between 2 and 200),
  amount        numeric(14,2) not null check (amount > 0),
  currency_code char(3) not null default 'NIO' references public.currencies(code),
  supplier_id   uuid,
  method        text check (method in ('transferencia','deposito','efectivo','tarjeta','billetera','otro')),
  notes         text check (char_length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, supplier_id) references public.suppliers(workspace_id, id) on delete set null (supplier_id)
);
create index business_expenses_ws_idx on public.business_expenses(workspace_id, spent_at desc);

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare t record;
begin
  for t in select * from (values
    ('catalog_items', array['catalog','packages']), ('packages', array['packages','catalog']),
    ('package_items', array['packages','catalog']), ('catalog_costs', array['catalog','packages'])
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
-- Los costos son información interna: solo quien ve finanzas (u opera el catálogo) los lee.
-- (catalog_costs y los costos de cotizaciones los ve el equipo con acceso al catálogo; los gastos, solo finanzas.)
alter table public.business_expenses enable row level security;
grant select, insert, update, delete on public.business_expenses to authenticated;
create policy "finanzas leen" on public.business_expenses for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()) and private.role_can_module(workspace_id, 'finance'));
create policy "finanzas crean" on public.business_expenses for insert to authenticated with check (private.can_write_module(workspace_id, 'finance'));
create policy "finanzas editan" on public.business_expenses for update to authenticated
  using (private.can_write_module(workspace_id, 'finance')) with check (private.can_write_module(workspace_id, 'finance'));
create policy "finanzas eliminan" on public.business_expenses for delete to authenticated using (private.can_write_module(workspace_id, 'finance'));

-- Proveedores: se pueden crear al vuelo desde cotizaciones, catálogo, reservas o gastos (además del módulo Proveedores).
create policy "crear proveedor desde otras pantallas" on public.suppliers for insert to authenticated
  with check (private.can_write_any(workspace_id, array['quotes','catalog','packages','bookings','finance','events','budget']));
create policy "editar proveedor desde otras pantallas" on public.suppliers for update to authenticated
  using (private.can_write_any(workspace_id, array['quotes','catalog','packages','bookings','finance','events','budget']))
  with check (private.can_write_any(workspace_id, array['quotes','catalog','packages','bookings','finance','events','budget']));

-- Los visitantes sin sesión no tienen permisos directos sobre estas tablas.
revoke all on public.catalog_items, public.packages, public.package_items, public.catalog_costs, public.business_expenses from anon;
