-- =====================================================================
-- Eventos360 · Etapa 9 · Catering
-- Ingredientes con unidades de compra y merma → recetas con costo por
-- porción → menús por persona (con opciones y precios por volumen) →
-- pedidos con invitados, restricciones y cierre de número → hoja de
-- producción y lista de compras automáticas → costo real vs. estimado.
-- Degustaciones como módulo opcional que el negocio activa.
-- (Migración solo aditiva.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Módulos opcionales: el dueño o un administrador los activa en Configuración
-- ---------------------------------------------------------------------
alter table public.modules add column if not exists is_optional boolean not null default false;
insert into public.modules(key, name, kinds, default_kinds, required_feature, sort)
  values ('tastings', 'Degustaciones', '{business}', '{}', null, 162) on conflict (key) do nothing;
update public.modules set is_optional = true where key = 'tastings';
update public.modules set name = 'Menús' where key = 'menus';
update public.modules set name = 'Pedidos' where key = 'orders';
update public.modules set name = 'Ingredientes y recetas' where key = 'ingredients';
update public.specialty_modules set label_override = 'Ingredientes y recetas' where specialty_key = 'catering' and module_key = 'ingredients';
insert into public.specialty_modules(specialty_key, module_key, sort, label_override) values
  ('catering', 'shifts', 85, null), ('catering', 'contracts', 55, null), ('catering', 'events', 35, null)
on conflict do nothing;

create or replace function public.workspace_set_module(p_ws uuid, p_module text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_write(p_ws, array['owner','admin']::public.member_role[]) then
    raise exception 'Solo el propietario o un administrador puede activar módulos.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.modules m join public.workspaces w on w.id = p_ws
                  where m.key = p_module and m.is_optional and m.is_active and w.kind = any(m.kinds)) then
    raise exception 'Ese módulo no se puede activar o desactivar.' using errcode = '22023';
  end if;
  insert into public.workspace_modules(workspace_id, module_key, is_enabled) values (p_ws, p_module, p_enabled)
    on conflict (workspace_id, module_key) do update set is_enabled = excluded.is_enabled;
end $$;
create or replace function public.workspace_optional_modules(p_ws uuid)
returns table (module_key text, name text, enabled boolean) language sql stable security definer set search_path = '' as $$
  select m.key, m.name, coalesce((select o.is_enabled from public.workspace_modules o where o.workspace_id = p_ws and o.module_key = m.key), false)
    from public.modules m join public.workspaces w on w.id = p_ws
   where m.is_optional and m.is_active and w.kind = any(m.kinds) and p_ws in (select private.user_workspace_ids())
   order by m.sort;
$$;
grant execute on function public.workspace_set_module(uuid, text, boolean), public.workspace_optional_modules(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Unidades de medida (se convierten solas dentro del mismo tipo)
-- peso → gramos · volumen → mililitros · conteo → unidades
-- ---------------------------------------------------------------------
create or replace function private.unit_info(p_unit text, out dim text, out factor numeric)
language sql immutable set search_path = '' as $$
  select x.dim, x.factor from (values
    ('g','mass',1::numeric), ('kg','mass',1000), ('lb','mass',453.592), ('oz','mass',28.3495), ('quintal','mass',45359.2),
    ('ml','volume',1), ('l','volume',1000), ('gal','volume',3785.41), ('taza','volume',240), ('cda','volume',15), ('cdta','volume',5), ('oz_fl','volume',29.5735), ('botella','volume',750),
    ('unidad','count',1), ('docena','count',12), ('cajilla','count',30), ('ciento','count',100)
  ) as x(u, dim, factor) where x.u = p_unit;
$$;

create table public.catering_settings (
  workspace_id      uuid primary key references public.workspaces(id) on delete cascade,
  cutoff_days       int not null default 7 check (cutoff_days between 0 and 90),        -- cierre del número de invitados
  guests_per_waiter int not null default 12 check (guests_per_waiter between 1 and 100),
  kids_portion      numeric(4,2) not null default 0.5 check (kids_portion between 0 and 1),
  food_cost_target  numeric(5,2) not null default 33 check (food_cost_target between 1 and 100),
  updated_at        timestamptz not null default now()
);
create or replace function private.catering_setting(p_ws uuid)
returns public.catering_settings language sql stable security definer set search_path = '' as $$
  select coalesce((select s from public.catering_settings s where s.workspace_id = p_ws),
                  row(p_ws, 7, 12, 0.5, 33, now())::public.catering_settings);
$$;

-- ---------------------------------------------------------------------
-- Ingredientes
-- ---------------------------------------------------------------------
create table public.ingredients (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  name           text not null check (char_length(name) between 2 and 120),
  category       text check (char_length(category) <= 60),
  purchase_unit  text not null default 'lb',                 -- unidad estándar o 'paquete'
  pack_name      text check (char_length(pack_name) <= 40),  -- si es paquete: "saco", "caja", "galón de 4"
  pack_size      numeric(12,3) check (pack_size > 0),        -- cuánto trae el paquete…
  pack_unit      text,                                       -- …en esta unidad estándar
  price          numeric(12,2) not null default 0 check (price >= 0),   -- precio por unidad de compra
  currency_code  char(3) not null default 'NIO' references public.currencies(code),
  yield_pct      numeric(5,2) not null default 100 check (yield_pct > 0 and yield_pct <= 100),  -- aprovechamiento (merma)
  supplier_id    uuid,
  is_active      boolean not null default true,
  notes          text check (char_length(notes) <= 1000),
  dim            text not null default 'mass',               -- calculado
  base_qty       numeric(14,4) not null default 1,           -- calculado: unidad de compra en unidades base
  cost_base      numeric(14,6) not null default 0,           -- calculado: costo por g / ml / unidad aprovechable
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, supplier_id) references public.suppliers(workspace_id, id) on delete set null (supplier_id)
);
create index ingredients_ws_idx on public.ingredients(workspace_id, name);
create trigger ingredients_touch before update on public.ingredients for each row execute function private.touch_updated_at();

create or replace function private.ingredients_before()
returns trigger language plpgsql set search_path = '' as $$
declare u record;
begin
  if new.purchase_unit = 'paquete' then
    if new.pack_size is null or new.pack_unit is null or new.pack_name is null then
      raise exception 'Indica cómo se llama el paquete y cuánto trae (por ejemplo, saco de 50 lb).' using errcode = 'P0001';
    end if;
    u := private.unit_info(new.pack_unit);
    if u.dim is null then raise exception 'Unidad del paquete no válida.' using errcode = 'P0001'; end if;
    new.base_qty := new.pack_size * u.factor;
  else
    u := private.unit_info(new.purchase_unit);
    if u.dim is null then raise exception 'Unidad de compra no válida.' using errcode = 'P0001'; end if;
    new.base_qty := u.factor; new.pack_name := null; new.pack_size := null; new.pack_unit := null;
  end if;
  if tg_op = 'UPDATE' and u.dim <> old.dim and exists (select 1 from public.recipe_items where ingredient_id = new.id) then
    raise exception 'Este ingrediente ya está en recetas medido por %; no se puede cambiar a otro tipo de unidad.',
      case old.dim when 'mass' then 'peso' when 'volume' then 'volumen' else 'unidades' end using errcode = 'P0001';
  end if;
  new.dim := u.dim;
  new.cost_base := new.price / new.base_qty / (new.yield_pct / 100);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Recetas (platos)
-- ---------------------------------------------------------------------
create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 120),
  course        text not null default 'fuerte' check (course in ('bocadillo','entrada','sopa','fuerte','acompanamiento','postre','bebida','otro')),
  portions      numeric(10,2) not null default 10 check (portions > 0),     -- rinde
  currency_code char(3) not null default 'NIO' references public.currencies(code),
  description   text check (char_length(description) <= 1000),            -- aparece en el menú
  instructions  text check (char_length(instructions) <= 5000),           -- preparación (solo cocina)
  image_path    text,
  is_active     boolean not null default true,
  cost_total    numeric(14,2) not null default 0,                         -- calculado
  cost_portion  numeric(14,4) not null default 0,                         -- calculado
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id)
);
create index recipes_ws_idx on public.recipes(workspace_id, course, name);
create trigger recipes_touch before update on public.recipes for each row execute function private.touch_updated_at();

create table public.recipe_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  recipe_id     uuid not null,
  ingredient_id uuid not null,
  quantity      numeric(12,3) not null check (quantity > 0),
  unit          text not null,
  note          text check (char_length(note) <= 80),       -- "picado", "en cubos"
  sort          int not null default 0,
  cost          numeric(14,4) not null default 0,           -- calculado
  foreign key (workspace_id, recipe_id) references public.recipes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ingredient_id) references public.ingredients(workspace_id, id) on delete restrict
);
create index recipe_items_recipe_idx on public.recipe_items(recipe_id);
create index recipe_items_ing_idx on public.recipe_items(ingredient_id);

-- ---------------------------------------------------------------------
-- Menús por persona
-- ---------------------------------------------------------------------
create table public.menus (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  name              text not null check (char_length(name) between 2 and 120),
  description       text check (char_length(description) <= 2000),
  image_path        text,
  currency_code     char(3) not null default 'NIO' references public.currencies(code),
  price_per_person  numeric(12,2) not null default 0 check (price_per_person >= 0),   -- sin IVA
  kids_price        numeric(12,2) check (kids_price >= 0),                            -- si no, el de adulto
  min_guests        int not null default 1 check (min_guests >= 1),
  is_active         boolean not null default true,
  cost_per_person   numeric(14,4) not null default 0,                                 -- calculado
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id)
);
create index menus_ws_idx on public.menus(workspace_id, name);
create trigger menus_touch before update on public.menus for each row execute function private.touch_updated_at();

create table public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  menu_id       uuid not null,
  recipe_id     uuid not null,
  portions      numeric(6,2) not null default 1 check (portions > 0),   -- porciones por invitado
  option_group  text check (char_length(option_group) <= 40),           -- mismo grupo = el invitado elige uno
  sort          int not null default 0,
  unique (menu_id, recipe_id),
  foreign key (workspace_id, menu_id) references public.menus(workspace_id, id) on delete cascade,
  foreign key (workspace_id, recipe_id) references public.recipes(workspace_id, id) on delete restrict
);
create index menu_items_menu_idx on public.menu_items(menu_id);
create index menu_items_recipe_idx on public.menu_items(recipe_id);

create table public.menu_price_tiers (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  menu_id          uuid not null,
  min_guests       int not null check (min_guests >= 2),
  price_per_person numeric(12,2) not null check (price_per_person >= 0),
  unique (menu_id, min_guests),
  foreign key (workspace_id, menu_id) references public.menus(workspace_id, id) on delete cascade
);

-- Recalcular costos en cadena: ingrediente → receta → menú
create or replace function private.recalc_recipe(p_recipe uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_menu uuid;
begin
  update public.recipes r set cost_total = round(coalesce((select sum(cost) from public.recipe_items where recipe_id = p_recipe), 0), 2),
    cost_portion = coalesce((select sum(cost) from public.recipe_items where recipe_id = p_recipe), 0) / r.portions
   where r.id = p_recipe;
  for v_menu in select distinct menu_id from public.menu_items where recipe_id = p_recipe loop perform private.recalc_menu(v_menu); end loop;
end $$;

create or replace function private.recipe_items_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare i public.ingredients; r public.recipes; u record;
begin
  select * into i from public.ingredients where id = new.ingredient_id;
  select * into r from public.recipes where id = new.recipe_id;
  if i.currency_code <> r.currency_code then
    raise exception '% tiene precio en %, pero la receta está en %. Usa la misma moneda.', i.name, i.currency_code, r.currency_code using errcode = 'P0001';
  end if;
  u := private.unit_info(new.unit);
  if u.dim is null or u.dim <> i.dim then
    raise exception '% se mide en %; usa una unidad de ese tipo.', i.name,
      case i.dim when 'mass' then 'peso (lb, kg, g, oz)' when 'volume' then 'volumen (l, ml, taza, cda…)' else 'unidades (unidad, docena…)' end using errcode = 'P0001';
  end if;
  new.cost := new.quantity * u.factor * i.cost_base;
  return new;
end $$;
create trigger recipe_items_before before insert or update on public.recipe_items for each row execute function private.recipe_items_before();
create or replace function private.recipe_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalc_recipe(coalesce(new.recipe_id, old.recipe_id));
  if tg_op = 'UPDATE' and new.recipe_id <> old.recipe_id then perform private.recalc_recipe(old.recipe_id); end if;
  return null;
end $$;
create trigger recipe_items_after after insert or update or delete on public.recipe_items for each row execute function private.recipe_items_after();

create trigger ingredients_before before insert or update on public.ingredients for each row execute function private.ingredients_before();
create or replace function private.ingredients_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_recipe uuid;
begin
  if new.cost_base is distinct from old.cost_base then
    update public.recipe_items set cost = cost where ingredient_id = new.id;     -- dispara el recálculo de cada línea
    for v_recipe in select distinct recipe_id from public.recipe_items where ingredient_id = new.id loop perform private.recalc_recipe(v_recipe); end loop;
  end if;
  return null;
end $$;
create trigger ingredients_after after update on public.ingredients for each row execute function private.ingredients_after();

create or replace function private.recipes_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.portions is distinct from old.portions then perform private.recalc_recipe(new.id); end if;
  if new.currency_code <> old.currency_code and exists (select 1 from public.recipe_items where recipe_id = new.id) then
    raise exception 'La receta ya tiene ingredientes en %; no se puede cambiar de moneda.', old.currency_code using errcode = 'P0001';
  end if;
  return null;
end $$;
create trigger recipes_after after update on public.recipes for each row execute function private.recipes_after();

create or replace function private.menu_items_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select currency_code from public.recipes where id = new.recipe_id) <> (select currency_code from public.menus where id = new.menu_id) then
    raise exception 'El plato y el menú deben estar en la misma moneda.' using errcode = 'P0001';
  end if;
  new.option_group := nullif(trim(new.option_group), '');
  return new;
end $$;
create trigger menu_items_before before insert or update on public.menu_items for each row execute function private.menu_items_before();
create or replace function private.menu_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalc_menu(coalesce(new.menu_id, old.menu_id));
  return null;
end $$;
create trigger menu_items_after after insert or update or delete on public.menu_items for each row execute function private.menu_items_after();

-- Costo por persona del menú (solo lo escribe el sistema)
create or replace function private.recalc_menu(p_menu uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  select coalesce(sum(g.cost), 0) into v from (
    select max(r.cost_portion * mi.portions) cost from public.menu_items mi join public.recipes r on r.id = mi.recipe_id
     where mi.menu_id = p_menu group by coalesce(mi.option_group, mi.id::text)) g;
  perform set_config('eventos360.menu_cost', 'on', true);
  update public.menus set cost_per_person = v where id = p_menu;
  perform set_config('eventos360.menu_cost', '', true);
end $$;
create or replace function private.menus_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('eventos360.menu_cost', true), '') <> 'on' then
    if tg_op = 'INSERT' then new.cost_per_person := 0; else new.cost_per_person := old.cost_per_person; end if;
  end if;
  if tg_op = 'UPDATE' and new.currency_code <> old.currency_code and exists (select 1 from public.menu_items where menu_id = new.id) then
    raise exception 'El menú ya tiene platos en %; no se puede cambiar de moneda.', old.currency_code using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger menus_before before insert or update on public.menus for each row execute function private.menus_before();

-- Lo mismo para recetas: el navegador no escribe sus costos.
create or replace function private.recipes_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() <= 1 then
    if tg_op = 'INSERT' then new.cost_total := 0; new.cost_portion := 0; else new.cost_total := old.cost_total; new.cost_portion := old.cost_portion; end if;
  end if;
  return new;
end $$;
create trigger recipes_before before insert or update on public.recipes for each row execute function private.recipes_before();

-- Precio por persona según la cantidad de invitados
create or replace function public.menu_price(p_menu uuid, p_guests int)
returns numeric language sql stable security invoker set search_path = '' as $$
  select coalesce((select t.price_per_person from public.menu_price_tiers t where t.menu_id = p_menu and t.min_guests <= p_guests order by t.min_guests desc limit 1),
                  (select price_per_person from public.menus where id = p_menu));
$$;
grant execute on function public.menu_price(uuid, int) to authenticated;

-- Las cotizaciones pueden llevar un menú (cantidad = invitados)
alter table public.quote_items add column if not exists menu_id uuid;
alter table public.quote_items add constraint quote_items_menu_fk foreign key (workspace_id, menu_id) references public.menus(workspace_id, id) on delete set null (menu_id);

-- ---------------------------------------------------------------------
-- Pedidos de catering
-- ---------------------------------------------------------------------
create table public.catering_orders (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  number           int not null default 0,
  customer_id      uuid not null,
  event_id         uuid,
  quote_id         uuid,                       -- si viene de una cotización, el cobro está en la cotización
  title            text not null check (char_length(title) between 2 and 160),
  status           text not null default 'confirmed' check (status in ('draft','confirmed','production','delivered','canceled')),
  service_at       timestamptz not null,
  location         text check (char_length(location) <= 300),
  menu_id          uuid,
  adults           int not null default 0 check (adults >= 0),
  kids             int not null default 0 check (kids >= 0),
  cutoff_days      int check (cutoff_days between 0 and 90),        -- si no, el del negocio
  currency_code    char(3) not null default 'NIO' references public.currencies(code),
  price_per_person numeric(12,2) not null default 0 check (price_per_person >= 0),  -- solo si no hay cotización
  kids_price       numeric(12,2) not null default 0 check (kids_price >= 0),
  other_charges    numeric(12,2) not null default 0 check (other_charges >= 0),
  discount_amount  numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_rate         numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  subtotal         numeric(14,2) not null default 0,     -- calculado
  tax_amount       numeric(14,2) not null default 0,     -- calculado
  total            numeric(14,2) not null default 0,     -- calculado
  cost_estimated   numeric(14,2) not null default 0,     -- calculado (menú × invitados)
  cost_actual      numeric(14,2) not null default 0,     -- calculado (compras registradas)
  kitchen_notes    text check (char_length(kitchen_notes) <= 2000),
  notes            text check (char_length(notes) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete set null (quote_id),
  foreign key (workspace_id, menu_id) references public.menus(workspace_id, id) on delete restrict
);
create index catering_orders_ws_idx on public.catering_orders(workspace_id, service_at);
create index catering_orders_quote_idx on public.catering_orders(quote_id);
create trigger catering_orders_touch before update on public.catering_orders for each row execute function private.touch_updated_at();

create table public.catering_order_choices (       -- cuántos platos de cada opción (cuando el menú tiene opciones)
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  order_id      uuid not null,
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  plates        int not null check (plates >= 0),
  unique (order_id, menu_item_id),
  foreign key (workspace_id, order_id) references public.catering_orders(workspace_id, id) on delete cascade
);
create table public.catering_order_restrictions (  -- vegetarianos, alergias, platos especiales
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  order_id      uuid not null,
  label         text not null check (char_length(label) between 2 and 80),
  people        int not null default 1 check (people between 1 and 5000),
  notes         text check (char_length(notes) <= 300),
  foreign key (workspace_id, order_id) references public.catering_orders(workspace_id, id) on delete cascade
);
create table public.catering_purchases (            -- lo que de verdad se compró para el pedido
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  order_id      uuid not null,
  purchased_on  date not null default current_date,
  description   text not null check (char_length(description) between 2 and 160),
  amount        numeric(12,2) not null check (amount >= 0),
  supplier_id   uuid,
  created_at    timestamptz not null default now(),
  foreign key (workspace_id, order_id) references public.catering_orders(workspace_id, id) on delete cascade,
  foreign key (workspace_id, supplier_id) references public.suppliers(workspace_id, id) on delete set null (supplier_id)
);
create index catering_purchases_order_idx on public.catering_purchases(order_id);
create index catering_choices_order_idx on public.catering_order_choices(order_id);
create index catering_restr_order_idx on public.catering_order_restrictions(order_id);

-- Porciones de cada plato para un pedido
create or replace function private.order_dish_portions(p_order uuid)
returns table (menu_item_id uuid, recipe_id uuid, portions numeric)
language sql stable security definer set search_path = '' as $$
  with o as (select co.*, (private.catering_setting(co.workspace_id)).kids_portion kp from public.catering_orders co where co.id = p_order),
  g as (select (select adults from o) + (select kids from o) * (select kp from o) eq, (select adults + kids from o) people),
  items as (select mi.*, count(*) over (partition by coalesce(mi.option_group, mi.id::text)) n_opts,
                   (select c.plates from public.catering_order_choices c where c.order_id = p_order and c.menu_item_id = mi.id) chosen
              from public.menu_items mi where mi.menu_id = (select menu_id from o))
  select i.id, i.recipe_id,
         round(case when i.option_group is null then (select eq from g) * i.portions
                    when i.chosen is not null then i.chosen * i.portions * (select eq / nullif(people, 0) from g)
                    else (select eq from g) * i.portions / i.n_opts end, 2)
    from items i;
$$;

create or replace function private.catering_orders_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cut int; v_lock timestamptz; v_cpp numeric; v_kp numeric; v_disc numeric; v_cur text;
begin
  if tg_op = 'INSERT' then new.number := private.next_number(new.workspace_id, 'catering'); else new.number := old.number; end if;
  if new.menu_id is not null then
    select currency_code into v_cur from public.menus where id = new.menu_id;
    if v_cur <> new.currency_code then raise exception 'El menú está en %; el pedido debe estar en la misma moneda.', v_cur using errcode = 'P0001'; end if;
  end if;
  -- Cierre del número de invitados: después de la fecha de cierre solo se puede aumentar.
  if tg_op = 'UPDATE' and old.status not in ('draft','canceled') and (new.adults < old.adults or new.adults + new.kids < old.adults + old.kids) then
    v_cut := coalesce(new.cutoff_days, (private.catering_setting(new.workspace_id)).cutoff_days);
    v_lock := old.service_at - make_interval(days => v_cut);
    if now() >= v_lock then
      raise exception 'Ya pasó el cierre del número de invitados (% días antes del evento). Solo se puede aumentar.', v_cut using errcode = 'P0001';
    end if;
  end if;
  v_kp := (private.catering_setting(new.workspace_id)).kids_portion;
  select cost_per_person into v_cpp from public.menus where id = new.menu_id;
  new.cost_estimated := round(coalesce(v_cpp, 0) * (new.adults + new.kids * v_kp), 2);
  new.cost_actual := coalesce((select sum(amount) from public.catering_purchases where order_id = new.id), 0);
  if new.quote_id is not null then
    new.subtotal := 0; new.tax_amount := 0; new.total := 0;     -- se cobra con la cotización
  else
    new.subtotal := new.adults * new.price_per_person + new.kids * new.kids_price + new.other_charges;
    v_disc := least(new.discount_amount, new.subtotal);
    new.tax_amount := round((new.subtotal - v_disc) * new.tax_rate / 100, 2);
    new.total := new.subtotal - v_disc + new.tax_amount;
  end if;
  return new;
end $$;
create trigger catering_orders_before before insert or update on public.catering_orders for each row execute function private.catering_orders_before();

-- Si cambia el costo del menú o llegan compras, se actualizan los pedidos abiertos
create or replace function private.catering_purchases_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.catering_orders set updated_at = now() where id = coalesce(new.order_id, old.order_id);
  return null;
end $$;
create trigger catering_purchases_after after insert or update or delete on public.catering_purchases for each row execute function private.catering_purchases_after();
create or replace function private.menus_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cost_per_person is distinct from old.cost_per_person then
    update public.catering_orders set updated_at = now() where menu_id = new.id and status in ('draft','confirmed','production');
  end if;
  return null;
end $$;
create trigger menus_after after update on public.menus for each row execute function private.menus_after();

-- Hoja de producción de un pedido: cada plato con porciones e ingredientes
create or replace function public.catering_sheet(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.catering_orders;
begin
  select * into o from public.catering_orders where id = p_order;
  if not found or o.workspace_id not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return jsonb_build_object('dishes', (select coalesce(jsonb_agg(jsonb_build_object('recipe_id', r.id, 'name', r.name, 'course', r.course, 'option_group', mi.option_group,
      'portions', p.portions, 'instructions', r.instructions,
      'ingredients', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'quantity', round(ri.quantity * p.portions / r.portions, 2), 'unit', ri.unit, 'note', ri.note) order by ri.sort, i.name), '[]')
                        from public.recipe_items ri join public.ingredients i on i.id = ri.ingredient_id where ri.recipe_id = r.id))
      order by array_position(array['bocadillo','entrada','sopa','fuerte','acompanamiento','postre','bebida','otro'], r.course), mi.sort), '[]')
    from private.order_dish_portions(p_order) p join public.menu_items mi on mi.id = p.menu_item_id join public.recipes r on r.id = p.recipe_id));
end $$;

-- Lista de compras: ingredientes de todos los pedidos de un rango, en unidades de compra
create or replace function public.catering_shopping(p_ws uuid, p_from date, p_to date)
returns table (ingredient_id uuid, name text, category text, purchase_unit text, pack_name text, pack_size numeric, pack_unit text,
               dim text, base_needed numeric, purchase_qty numeric, est_cost numeric, currency_code char(3), supplier_id uuid, orders int)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  if p_ws not in (select private.user_workspace_ids()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select timezone into v_tz from public.workspaces where id = p_ws;
  return query
    with ords as (select id from public.catering_orders where workspace_id = p_ws and status in ('confirmed','production')
                    and (service_at at time zone v_tz)::date between p_from and p_to),
    need as (
      select ri.ingredient_id, o.id order_id, sum(ri.quantity * (private.unit_info(ri.unit)).factor * p.portions / r.portions) base
        from ords o cross join lateral private.order_dish_portions(o.id) p
        join public.recipes r on r.id = p.recipe_id join public.recipe_items ri on ri.recipe_id = r.id
       group by ri.ingredient_id, o.id)
    select i.id, i.name, i.category, i.purchase_unit, i.pack_name, i.pack_size, i.pack_unit, i.dim,
           round(sum(n.base), 2),
           round(sum(n.base) / (i.yield_pct / 100) / i.base_qty, 2),            -- incluye la merma
           round(sum(n.base) * i.cost_base, 2), i.currency_code, i.supplier_id, count(distinct n.order_id)::int
      from need n join public.ingredients i on i.id = n.ingredient_id
     group by i.id order by i.category nulls last, i.name;
end $$;
grant execute on function public.catering_sheet(uuid), public.catering_shopping(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Degustaciones (módulo opcional)
-- ---------------------------------------------------------------------
create table public.tastings (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  customer_id    uuid not null,
  quote_id       uuid,
  menu_id        uuid,
  scheduled_at   timestamptz not null,
  people         int not null default 2 check (people between 1 and 50),
  dishes         text check (char_length(dishes) <= 1000),       -- qué se va a probar
  price          numeric(12,2) not null default 0 check (price >= 0),
  currency_code  char(3) not null default 'NIO' references public.currencies(code),
  credit_on_hire boolean not null default true,                  -- se descuenta si contrata
  status         text not null default 'scheduled' check (status in ('scheduled','done','canceled','no_show')),
  result         text check (char_length(result) <= 2000),       -- qué le gustó, cambios pedidos
  notes          text check (char_length(notes) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete set null (quote_id),
  foreign key (workspace_id, menu_id) references public.menus(workspace_id, id) on delete set null (menu_id)
);
create index tastings_ws_idx on public.tastings(workspace_id, scheduled_at);
create trigger tastings_touch before update on public.tastings for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Finanzas y reportes: pedidos sin cotización son ventas; las compras reales cuentan como costo
-- ---------------------------------------------------------------------
create or replace function private.report_deals(p_ws uuid, p_cur text)
returns table (kind text, id uuid, event_id uuid, customer_id uuid, d date, net numeric, gross numeric, est_cost numeric, retained numeric)
language sql stable security definer set search_path = '' as $$
  with tz as (select timezone from public.workspaces where id = p_ws)
  select 'quote', q.id, q.event_id, q.customer_id, coalesce((q.accepted_at at time zone (select timezone from tz))::date, q.issue_date),
         q.subtotal - least(q.discount_amount, q.subtotal), q.total,
         greatest(q.cost_total, coalesce((select sum(co.cost_actual) from public.catering_orders co where co.quote_id = q.id and co.status <> 'canceled'), 0)), 0::numeric
    from public.quotes q
   where q.workspace_id = p_ws and q.status = 'accepted' and q.currency_code = p_cur
     and not exists (select 1 from public.rentals r where r.quote_id = q.id and r.status in ('reserved','out','returned'))
  union all
  select 'rental', r.id, r.event_id, r.customer_id, (r.starts_at at time zone (select timezone from tz))::date,
         r.subtotal - least(r.discount_amount, r.subtotal) + r.damage_total, r.total + r.damage_total, 0::numeric, r.deposit_retained
    from public.rentals r
   where r.workspace_id = p_ws and r.status in ('reserved','out','returned') and r.currency_code = p_cur
  union all
  select 'booking', b.id, b.event_id, b.customer_id, (b.starts_at at time zone (select timezone from tz))::date,
         b.subtotal - least(b.discount_amount, b.subtotal), b.total, b.cost_total, b.deposit_retained
    from public.bookings b
   where b.workspace_id = p_ws and b.kind = 'event' and b.status in ('confirmed','done') and b.currency_code = p_cur
  union all
  select 'catering', co.id, co.event_id, co.customer_id, (co.service_at at time zone (select timezone from tz))::date,
         co.subtotal - least(co.discount_amount, co.subtotal), co.total, greatest(co.cost_estimated, co.cost_actual), 0::numeric
    from public.catering_orders co
   where co.workspace_id = p_ws and co.quote_id is null and co.status in ('confirmed','production','delivered') and co.currency_code = p_cur
  union all
  select 'tasting', t.id, null::uuid, t.customer_id, (t.scheduled_at at time zone (select timezone from tz))::date, t.price, t.price, 0::numeric, 0::numeric
    from public.tastings t
   where t.workspace_id = p_ws and t.status = 'done' and t.price > 0 and t.currency_code = p_cur;
$$;

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare t record;
begin
  for t in select * from (values
    ('ingredients', array['ingredients','menus']), ('recipes', array['ingredients','menus']), ('recipe_items', array['ingredients','menus']),
    ('menus', array['menus']), ('menu_items', array['menus']), ('menu_price_tiers', array['menus']),
    ('catering_orders', array['orders']), ('catering_order_choices', array['orders']), ('catering_order_restrictions', array['orders']),
    ('catering_purchases', array['orders']), ('tastings', array['tastings'])
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
alter table public.catering_settings enable row level security;
grant select, insert, update on public.catering_settings to authenticated;
create policy "miembros leen" on public.catering_settings for select to authenticated using (workspace_id in (select private.user_workspace_ids()));
create policy "admin crea" on public.catering_settings for insert to authenticated with check (private.can_write(workspace_id, array['owner','admin','manager']::public.member_role[]));
create policy "admin edita" on public.catering_settings for update to authenticated
  using (private.can_write(workspace_id, array['owner','admin','manager']::public.member_role[])) with check (private.can_write(workspace_id, array['owner','admin','manager']::public.member_role[]));
-- Proveedores creados al vuelo desde ingredientes y compras
create policy "crear proveedor desde catering" on public.suppliers for insert to authenticated with check (private.can_write_any(workspace_id, array['ingredients','orders']));

revoke all on public.ingredients, public.recipes, public.recipe_items, public.menus, public.menu_items, public.menu_price_tiers, public.catering_orders,
  public.catering_order_choices, public.catering_order_restrictions, public.catering_purchases, public.tastings, public.catering_settings from anon;
