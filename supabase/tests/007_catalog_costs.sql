-- =====================================================================
-- Pruebas Etapa 6 · Catálogo, paquetes, costos y gastos (se revierte)
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb'), ('00000000-0000-0000-0000-0000000000cc');
insert into t_ctx select 'ca', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_profesional'),null,'{decoration}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','professional',(select id from public.plans where key='pro_mensual'),null,'{}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000aa','deco_a','Diana Deco',null,'Deco Diana','{decoration}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000bb','plan_b','Pablo Planner',null,'Pablo Eventos','{}'))->>'workspace_id';
select public.svc_team_add((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000cc', 'deco_staff', 'Operativo Deco', null, 'staff');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);

do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); arco uuid; centro uuid; paq uuid; sup uuid; q uuid; cust uuid;
begin
  -- Proveedor creado "al vuelo" (decoración no tiene el módulo Proveedores)
  insert into public.suppliers(workspace_id, name, service_type) values (ws, 'Flores del Valle', 'Floristería') returning id into sup;

  -- Servicio con costos desglosados
  insert into public.catalog_items(workspace_id, name, category, price, currency_code, cost_total) values (ws, 'Arco floral 2.5 m', 'Decoración', 450, 'USD', 999) returning id into arco;
  if (select cost_total from public.catalog_items where id = arco) <> 0 then raise exception 'FALLO: el costo no lo escribe el cliente'; end if;
  insert into public.catalog_costs(workspace_id, item_id, kind, description, amount, supplier_id) values
    (ws, arco, 'supplier', 'Flores (rosas y peonías)', 150, sup), (ws, arco, 'material', 'Estructura y espuma', 40, null), (ws, arco, 'labor', 'Montaje 2 personas', 30, null);
  if (select cost_total from public.catalog_items where id = arco) <> 220 then raise exception 'FALLO: costo del servicio %', (select cost_total from public.catalog_items where id = arco); end if;
  insert into public.catalog_items(workspace_id, name, price, currency_code) values (ws, 'Centro de mesa', 35, 'USD') returning id into centro;
  insert into public.catalog_costs(workspace_id, item_id, kind, description, amount) values (ws, centro, 'material', 'Flores y base', 15);

  -- Paquete: 1 arco + 10 centros + transporte propio
  insert into public.packages(workspace_id, name, price, currency_code) values (ws, 'Boda Clásica', 750, 'USD') returning id into paq;
  insert into t_ctx values ('paq', paq);
  insert into public.package_items(workspace_id, package_id, item_id, quantity) values (ws, paq, arco, 1), (ws, paq, centro, 10);
  insert into public.catalog_costs(workspace_id, package_id, kind, description, amount) values (ws, paq, 'transport', 'Camión ida y vuelta', 60);
  if (select cost_total from public.packages where id = paq) <> 430 or (select items_value from public.packages where id = paq) <> 800 then
    raise exception 'FALLO: paquete costo % / valor %', (select cost_total from public.packages where id = paq), (select items_value from public.packages where id = paq);
  end if;
  -- Si sube el costo de las flores, sube el costo del servicio y del paquete
  update public.catalog_costs set amount = 180 where item_id = arco and kind = 'supplier';
  if (select cost_total from public.packages where id = paq) <> 460 then raise exception 'FALLO: el paquete no se actualizó'; end if;
  update public.packages set cost_total = 1 where id = paq;
  if (select cost_total from public.packages where id = paq) <> 460 then raise exception 'FALLO: costo del paquete editable'; end if;

  -- Cotización con costo interno: ganancia sin IVA
  insert into public.customers(workspace_id, name) values (ws, 'Familia Ruiz') returning id into cust;
  insert into public.quotes(workspace_id, customer_id, title, tax_rate, currency_code) values (ws, cust, 'Boda Ruiz', 15, 'USD') returning id into q;
  insert into t_ctx values ('q', q);
  insert into public.quote_items(workspace_id, quote_id, description, quantity, unit_price, unit_cost, package_id) values (ws, q, 'Boda Clásica', 1, 750, 460, paq);
  insert into public.quote_items(workspace_id, quote_id, description, quantity, unit_price, unit_cost, supplier_id) values (ws, q, 'Fotografía (subcontratada)', 1, 300, 220, sup);
  begin update public.quotes set cost_total = 0 where id = q; raise exception 'FALLO: costo de cotización editable';
  exception when insufficient_privilege then null; end;
  if (select cost_total from public.quotes where id = q) <> 680 or (select subtotal from public.quotes where id = q) <> 1050 or (select total from public.quotes where id = q) <> 1207.5 then
    raise exception 'FALLO: totales de cotización % % %', (select cost_total from public.quotes where id = q), (select subtotal from public.quotes where id = q), (select total from public.quotes where id = q);
  end if;

  -- Gasto del negocio
  insert into public.business_expenses(workspace_id, category, description, amount, currency_code) values (ws, 'alquiler', 'Bodega de noviembre', 300, 'USD');
end $$;

-- La cotización pública no expone costos ni proveedores
reset role;
do $$ declare d text; begin
  d := public.public_quote((select public_token from public.quotes where id = (select v::uuid from t_ctx where k='q')))::text;
  if d like '%unit_cost%' or d like '%Flores del Valle%' or d like '%cost_total%' then raise exception 'FALLO: la cotización pública muestra costos'; end if;
end $$;

-- El operativo no ve los gastos del negocio
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', true);
do $$ begin
  if (select count(*) from public.business_expenses) <> 0 then raise exception 'FALLO: el operativo ve gastos del negocio'; end if;
  begin
    insert into public.business_expenses(workspace_id, description, amount) values ((select v::uuid from t_ctx where k='wa'), 'x', 1);
    raise exception 'FALLO: el operativo registró gastos';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.catalog_items) <> 2 then raise exception 'FALLO: el operativo no ve el catálogo'; end if;
end $$;

-- Profesional también tiene catálogo y paquetes; y no ve datos de otro negocio
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
do $$ begin
  if not exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wb')) where module_key = 'catalog')
     or not exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wb')) where module_key = 'packages') then
    raise exception 'FALLO: Profesional sin catálogo/paquetes';
  end if;
  if (select count(*) from public.catalog_items) + (select count(*) from public.packages) + (select count(*) from public.catalog_costs)
     + (select count(*) from public.business_expenses) + (select count(*) from public.suppliers) <> 0 then raise exception 'FALLO: B ve datos de A'; end if;
  begin
    insert into public.package_items(workspace_id, package_id, item_id) values ((select v::uuid from t_ctx where k='wb'), (select v::uuid from t_ctx where k='paq'), gen_random_uuid());
    raise exception 'FALLO: B usó un paquete de A';
  exception when foreign_key_violation or insufficient_privilege then null; end;
  insert into public.suppliers(workspace_id, name) values ((select v::uuid from t_ctx where k='wb'), 'Proveedor propio de B');
end $$;
reset role;
delete from public.workspaces where id in ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='wb'));
select 'TODAS LAS PRUEBAS DE LA ETAPA 6 PASARON' as resultado;
rollback;
