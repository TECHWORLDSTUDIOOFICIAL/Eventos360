-- =====================================================================
-- Pruebas Etapa 9 · Catering (se revierte)
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb'), ('00000000-0000-0000-0000-0000000000cc');
insert into t_ctx select 'ca', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_profesional'),null,'{catering}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_inicial'),null,'{rental}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000aa','chef_a','Carmen Chef',null,'Sabor Nica','{catering}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000bb','alq_b','Beto Alquiler',null,'Sillas Beto','{rental}'))->>'workspace_id';
select public.svc_team_add((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000cc', 'chef_staff', 'Ayudante', null, 'staff');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);

do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); pollo uuid; arroz uuid; huevos uuid; aceite uuid; r1 uuid; r2 uuid; r3 uuid; m uuid;
  mi_pollo uuid; mi_res uuid; cust uuid; o uuid; q uuid; d jsonb; x record;
begin
  -- Módulos de catering
  if not exists (select 1 from public.workspace_modules_for(ws) where module_key = 'menus')
     or not exists (select 1 from public.workspace_modules_for(ws) where module_key = 'orders')
     or not exists (select 1 from public.workspace_modules_for(ws) where module_key = 'ingredients') then raise exception 'FALLO: catering sin módulos'; end if;
  if exists (select 1 from public.workspace_modules_for(ws) where module_key = 'tastings') then raise exception 'FALLO: degustaciones debería estar apagado'; end if;
  perform public.workspace_set_module(ws, 'tastings', true);
  if not exists (select 1 from public.workspace_modules_for(ws) where module_key = 'tastings') then raise exception 'FALLO: no se activó degustaciones'; end if;
  begin perform public.workspace_set_module(ws, 'finance', false); raise exception 'FALLO: apagó un módulo no opcional';
  exception when sqlstate '22023' then null; end;

  -- Ingredientes: pollo C$70/lb con 75 % de aprovechamiento; arroz saco de 50 lb a C$1,500; huevos cajilla C$150; aceite galón C$400
  insert into public.ingredients(workspace_id, name, purchase_unit, price, yield_pct, cost_base) values (ws, 'Pechuga de pollo', 'lb', 70, 75, 999) returning id into pollo;
  insert into public.ingredients(workspace_id, name, purchase_unit, pack_name, pack_size, pack_unit, price) values (ws, 'Arroz', 'paquete', 'saco', 50, 'lb', 1500) returning id into arroz;
  insert into public.ingredients(workspace_id, name, purchase_unit, price) values (ws, 'Huevos', 'cajilla', 150) returning id into huevos;
  insert into public.ingredients(workspace_id, name, purchase_unit, price) values (ws, 'Aceite', 'gal', 400) returning id into aceite;
  if abs((select cost_base from public.ingredients where id = pollo) - 70 / 453.592 / 0.75) > 0.000001 then raise exception 'FALLO: costo base pollo'; end if;

  -- Receta: pollo a la plancha, rinde 10: 4 lb de pollo + 1 taza de aceite
  insert into public.recipes(workspace_id, name, course, portions, cost_total) values (ws, 'Pollo a la plancha', 'fuerte', 10, 12345) returning id into r1;
  insert into public.recipe_items(workspace_id, recipe_id, ingredient_id, quantity, unit) values (ws, r1, pollo, 4, 'lb'), (ws, r1, aceite, 1, 'taza');
  -- 4 lb × 70 / 0.75 = 373.33 ; 240 ml × 400/3785.41 = 25.36 → 398.69 → 39.87 por porción
  if abs((select cost_total from public.recipes where id = r1) - 398.69) > 0.02 then raise exception 'FALLO: costo receta %', (select cost_total from public.recipes where id = r1); end if;
  begin
    insert into public.recipe_items(workspace_id, recipe_id, ingredient_id, quantity, unit) values (ws, r1, huevos, 2, 'lb');
    raise exception 'FALLO: aceptó huevos en libras';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  insert into public.recipes(workspace_id, name, course, portions) values (ws, 'Arroz blanco', 'acompanamiento', 20) returning id into r2;
  insert into public.recipe_items(workspace_id, recipe_id, ingredient_id, quantity, unit) values (ws, r2, arroz, 5, 'lb');           -- 150 → 7.5 por porción
  insert into public.recipes(workspace_id, name, course, portions) values (ws, 'Res en salsa', 'fuerte', 10) returning id into r3;
  insert into public.recipe_items(workspace_id, recipe_id, ingredient_id, quantity, unit) values (ws, r3, huevos, 1, 'docena');        -- 60 → 6 por porción (de prueba)

  -- Menú: plato fuerte a elegir (pollo o res) + arroz. Costo por persona = max(39.87, 6) + 7.5 = 47.37
  insert into public.menus(workspace_id, name, price_per_person, min_guests, cost_per_person) values (ws, 'Menú Clásico', 250, 50, 1) returning id into m;
  insert into public.menu_items(workspace_id, menu_id, recipe_id, option_group) values (ws, m, r1, 'Plato fuerte') returning id into mi_pollo;
  insert into public.menu_items(workspace_id, menu_id, recipe_id, option_group) values (ws, m, r3, 'Plato fuerte') returning id into mi_res;
  insert into public.menu_items(workspace_id, menu_id, recipe_id) values (ws, m, r2);
  if abs((select cost_per_person from public.menus where id = m) - 47.37) > 0.02 then raise exception 'FALLO: costo menú %', (select cost_per_person from public.menus where id = m); end if;
  insert into public.menu_price_tiers(workspace_id, menu_id, min_guests, price_per_person) values (ws, m, 100, 230), (ws, m, 200, 210);
  if public.menu_price(m, 80) <> 250 or public.menu_price(m, 150) <> 230 or public.menu_price(m, 300) <> 210 then raise exception 'FALLO: precios por volumen'; end if;

  -- Si sube el pollo, sube el menú
  update public.ingredients set price = 80 where id = pollo;
  if (select cost_per_person from public.menus where id = m) <= 47.37 then raise exception 'FALLO: el menú no se actualizó con el precio del pollo'; end if;
  update public.ingredients set price = 70 where id = pollo;

  -- Pedido sin cotización: 100 adultos + 20 niños (media porción)
  insert into public.customers(workspace_id, name) values (ws, 'Colegio San José') returning id into cust;
  insert into public.catering_orders(workspace_id, customer_id, title, service_at, menu_id, adults, kids, price_per_person, kids_price, tax_rate, total, cost_actual)
    values (ws, cust, 'Graduación', now() + interval '20 days', m, 100, 20, 230, 120, 15, 1, 999999) returning id into o;
  insert into t_ctx values ('o', o);
  -- subtotal 100×230 + 20×120 = 25,400 ; IVA 3,810 ; costo estimado 47.37 × 110 = 5,210.70
  if (select subtotal from public.catering_orders where id = o) <> 25400 or (select total from public.catering_orders where id = o) <> 29210
     or abs((select cost_estimated from public.catering_orders where id = o) - 5210.7) > 2 or (select cost_actual from public.catering_orders where id = o) <> 0 then
    raise exception 'FALLO: totales del pedido % % %', (select subtotal from public.catering_orders where id = o), (select total from public.catering_orders where id = o), (select cost_estimated from public.catering_orders where id = o);
  end if;
  -- Elección: 70 pollo y 50 res
  insert into public.catering_order_choices(workspace_id, order_id, menu_item_id, plates) values (ws, o, mi_pollo, 70), (ws, o, mi_res, 50);
  insert into public.catering_order_restrictions(workspace_id, order_id, label, people) values (ws, o, 'Vegetariano', 5);
  d := public.catering_sheet(o);
  -- porciones equivalentes = 110; pollo 70 de 120 platos → 64.17 ; arroz 110
  if jsonb_array_length(d->'dishes') <> 3 then raise exception 'FALLO: hoja de producción %', d; end if;
  if abs((select (dd->>'portions')::numeric from jsonb_array_elements(d->'dishes') dd where dd->>'name' = 'Pollo a la plancha') - 64.17) > 0.02 then raise exception 'FALLO: porciones de pollo %', d; end if;
  -- Lista de compras: pollo = 64.17/10 × 4 lb = 25.67 lb aprovechables → 34.22 lb a comprar (merma 25 %)
  select * into x from public.catering_shopping(ws, current_date, current_date + 30) where name = 'Pechuga de pollo';
  if abs(x.purchase_qty - 34.22) > 0.05 then raise exception 'FALLO: lista de compras pollo %', x.purchase_qty; end if;
  select * into x from public.catering_shopping(ws, current_date, current_date + 30) where name = 'Arroz';
  if abs(x.purchase_qty - 0.55) > 0.01 then raise exception 'FALLO: sacos de arroz %', x.purchase_qty; end if;   -- 110/20×5 = 27.5 lb = 0.55 sacos
  -- Compras reales
  insert into public.catering_purchases(workspace_id, order_id, description, amount) values (ws, o, 'Mercado Oriental', 4000), (ws, o, 'Pollo Tip-Top', 2500);
  if (select cost_actual from public.catering_orders where id = o) <> 6500 then raise exception 'FALLO: costo real'; end if;

  -- Antes del cierre se puede bajar el número de invitados
  update public.catering_orders set adults = 90 where id = o;
  -- Pedido dentro del cierre (en 3 días, cierre 7): no se puede bajar, sí subir
  insert into public.catering_orders(workspace_id, customer_id, title, service_at, menu_id, adults, price_per_person) values (ws, cust, 'Cena', now() + interval '3 days', m, 60, 250) returning id into q;
  begin
    update public.catering_orders set adults = 50 where id = q;
    raise exception 'FALLO: bajó invitados después del cierre';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' or sqlerrm not like '%cierre%' then raise; end if; end;
  update public.catering_orders set adults = 70 where id = q;
  -- Con cierre de 2 días para este evento, sí se puede bajar
  update public.catering_orders set cutoff_days = 2 where id = q;
  update public.catering_orders set adults = 55 where id = q;
  -- Cierre del negocio editable
  insert into public.catering_settings(workspace_id, cutoff_days) values (ws, 1);
  if (private.catering_setting(ws)).cutoff_days <> 1 then raise exception 'FALLO: ajuste del negocio'; end if;

  -- Degustación cobrada y hecha
  insert into public.tastings(workspace_id, customer_id, menu_id, scheduled_at, people, price, status) values (ws, cust, m, now() - interval '1 day', 2, 500, 'done');
end $$;

-- En Finanzas / Reportes: pedido sin cotización + degustación cuentan como venta; costo = mayor entre estimado y real
do $$ declare r jsonb; begin
  r := public.report_business((select v::uuid from t_ctx where k='wa'), current_date - 5, current_date + 30, 'NIO');
  -- ventas: 90×230 + 20×120 = 23,100 (pedido) + 55×250 = 13,750 (cena) + 500 (degustación) = 37,350
  if (r->'totals'->>'sales')::numeric <> 37350 then raise exception 'FALLO: ventas de catering %', r->'totals'; end if;
end $$;

-- El operativo puede ver y producir, pero no cambia ajustes del negocio ni módulos
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', true);
do $$ begin
  if (select count(*) from public.recipes) <> 3 then raise exception 'FALLO: el operativo no ve recetas'; end if;
  perform public.catering_sheet((select v::uuid from t_ctx where k='o'));
  begin
    perform public.workspace_set_module((select v::uuid from t_ctx where k='wa'), 'tastings', false);
    raise exception 'FALLO: el operativo apagó un módulo';
  exception when insufficient_privilege then null; end;
  update public.catering_settings set cutoff_days = 30;
  if (select cutoff_days from public.catering_settings) <> 1 then raise exception 'FALLO: el operativo cambió el cierre'; end if;
end $$;

-- Otro negocio no ve nada ni puede leer la hoja
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
do $$ begin
  if (select count(*) from public.ingredients) + (select count(*) from public.recipes) + (select count(*) from public.menus) + (select count(*) from public.catering_orders) + (select count(*) from public.tastings) <> 0 then
    raise exception 'FALLO: B ve datos de A';
  end if;
  begin perform public.catering_sheet((select v::uuid from t_ctx where k='o')); raise exception 'FALLO: B vio la hoja de A';
  exception when insufficient_privilege then null; end;
  begin perform * from public.catering_shopping((select v::uuid from t_ctx where k='wa'), current_date, current_date + 30); raise exception 'FALLO: B vio compras de A';
  exception when insufficient_privilege then null; end;
  -- Alquiler no tiene degustaciones disponibles para activar
  begin perform public.workspace_set_module((select v::uuid from t_ctx where k='wb'), 'menus', true); raise exception 'FALLO: activó un módulo no opcional';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
delete from public.workspaces where id in ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='wb'));
select 'TODAS LAS PRUEBAS DE LA ETAPA 9 PASARON' as resultado;
rollback;
