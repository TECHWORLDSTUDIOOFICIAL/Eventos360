-- =====================================================================
-- Pruebas Etapa 8 · Reportes (se revierte)
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb'), ('00000000-0000-0000-0000-0000000000cc'), ('00000000-0000-0000-0000-0000000000dd');
insert into t_ctx select 'ca', code from private.create_access_code('signup','professional',(select id from public.plans where key='pro_mensual'),null,'{}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','professional',(select id from public.plans where key='pro_anual'),null,'{}',null,null,null,null,1,null);
insert into t_ctx select 'cc', code from private.create_access_code('signup','personal',(select id from public.plans where key='personal_mensual'),null,'{}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000aa','rep_a','Ana Planner',null,'Ana Eventos','{}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000bb','rep_b','Beto Planner',null,'Beto Eventos','{}'))->>'workspace_id';
insert into t_ctx select 'wc', (public.svc_complete_signup((select v from t_ctx where k='cc'),'ip:t','00000000-0000-0000-0000-0000000000cc','rep_c','Carla Novia',null,'Mi boda','{}'))->>'workspace_id';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);

do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); ca uuid; cb uuid; ev uuid; q uuid; q2 uuid; w uuid; s uuid; r jsonb; t jsonb; v_from date; v_to date;
begin
  if not exists (select 1 from public.workspace_modules_for(ws) where module_key = 'reports') then raise exception 'FALLO: Profesional sin Reportes'; end if;
  insert into public.customers(workspace_id, name, source) values (ws, 'Familia Ruiz', 'Instagram') returning id into ca;
  insert into public.customers(workspace_id, name, source) values (ws, 'Empresa Sol', 'Referido') returning id into cb;
  insert into public.events(workspace_id, customer_id, name, category, starts_at, currency_code) values (ws, ca, 'Boda Ruiz', 'boda', now() + interval '2 days', 'USD') returning id into ev;
  -- Venta: subtotal 1000, costo estimado 400, IVA 15 %
  insert into public.quotes(workspace_id, customer_id, event_id, title, tax_rate, currency_code) values (ws, ca, ev, 'Boda', 15, 'USD') returning id into q;
  insert into public.quote_items(workspace_id, quote_id, description, quantity, unit_price, unit_cost) values (ws, q, 'Decoración', 1, 700, 300), (ws, q, 'Coordinación', 1, 300, 100);
  update public.quotes set status = 'sent' where id = q;
  update public.quotes set status = 'accepted' where id = q;
  insert into public.quotes(workspace_id, customer_id, title, currency_code) values (ws, cb, 'Cena', 'USD') returning id into q2;
  insert into public.quote_items(workspace_id, quote_id, description, quantity, unit_price) values (ws, q2, 'Catering', 1, 500);
  update public.quotes set status = 'sent' where id = q2;
  insert into public.quotes(workspace_id, customer_id, title, currency_code) values (ws, cb, 'Borrador', 'USD');
  -- Costo real del evento: proveedor 500 + personal 100 = 600 (mayor que lo estimado 400)
  insert into public.event_expenses(workspace_id, event_id, category, concept, planned_amount, agreed_amount) values (ws, ev, 'flores', 'Flores', 450, 500);
  insert into public.workers(workspace_id, full_name, positions, pay_type, rate, currency_code) values (ws, 'Juan Mesero', '{Mesero}', 'shift', 100, 'USD') returning id into w;
  insert into public.shifts(workspace_id, event_id, position, starts_at, ends_at) values (ws, ev, 'Mesero', now() + interval '2 days', now() + interval '2 days 6 hours') returning id into s;
  insert into public.shift_assignments(workspace_id, shift_id, worker_id) values (ws, s, w);
  insert into public.business_expenses(workspace_id, category, description, amount, currency_code) values (ws, 'alquiler', 'Oficina', 100, 'USD');
  insert into public.customer_payments(workspace_id, customer_id, event_id, quote_id, kind, amount, currency_code, method, paid_at)
    values (ws, ca, ev, q, 'deposit', 300, 'USD', 'transferencia', current_date);

  v_from := (date_trunc('month', current_date))::date; v_to := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  -- el evento puede caer el mes siguiente: usar un período que cubra ambos
  v_to := v_to + 10;
  r := public.report_business(ws, v_from, v_to, 'USD');
  t := r->'totals';
  if (t->>'sales')::numeric <> 1000 or (t->>'tax')::numeric <> 150 or (t->>'cost')::numeric <> 600 or (t->>'overhead')::numeric <> 100
     or (t->>'result')::numeric <> 300 or (t->>'collected')::numeric <> 300 then raise exception 'FALLO: totales %', t; end if;
  if (r->'quotes'->>'total')::int <> 3 or (r->'quotes'->>'accepted')::int <> 1 or (r->'quotes'->>'sent')::int <> 1 or (r->'quotes'->>'draft')::int <> 1 then
    raise exception 'FALLO: embudo %', r->'quotes'; end if;
  if (r->'receivables'->>'total')::numeric <> 850 then raise exception 'FALLO: por cobrar %', r->'receivables'; end if;
  if (r->'top_customers'->0->>'name') <> 'Familia Ruiz' or (r->'by_category'->0->>'category') <> 'boda' then raise exception 'FALLO: clientes/categorías'; end if;
  if (r->'top_items'->0->>'label') <> 'Decoración' or (r->'top_items'->0->>'cost')::numeric <> 300 then raise exception 'FALLO: lo más vendido %', r->'top_items'; end if;
  if (r->'staff'->0->>'pay')::numeric <> 100 or (r->'staff'->0->>'shifts')::int <> 1 then raise exception 'FALLO: personal %', r->'staff'; end if;
  if jsonb_array_length(r->'new_customers') <> 2 or (r->'expenses_by_category'->0->>'amount')::numeric <> 100 then raise exception 'FALLO: clientes nuevos o gastos'; end if;
  if (r->>'advanced')::boolean or r->'previous' <> 'null'::jsonb then raise exception 'FALLO: plan mensual con reportes avanzados'; end if;
  -- En córdobas no hay nada
  if (public.report_business(ws, v_from, v_to, 'NIO')->'totals'->>'sales')::numeric <> 0 then raise exception 'FALLO: mezcla monedas'; end if;
  begin
    perform public.report_business(ws, v_to, v_from, 'USD');
    raise exception 'FALLO: aceptó período al revés';
  exception when sqlstate '22023' then null; end;
end $$;

-- Plan anual: comparación y tendencia de 12 meses
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
do $$ declare r jsonb; begin
  r := public.report_business((select v::uuid from t_ctx where k='wb'), current_date - 30, current_date, 'NIO');
  if not (r->>'advanced')::boolean or jsonb_array_length(r->'monthly') <> 12 or r->'previous' is null then raise exception 'FALLO: reportes avanzados %', r->'advanced'; end if;
  -- B no puede ver los reportes de A
  begin
    perform public.report_business((select v::uuid from t_ctx where k='wa'), current_date - 30, current_date, 'USD');
    raise exception 'FALLO: B vio reportes de A';
  exception when insufficient_privilege then null; end;
end $$;

-- Personal: tiene Reportes (de su evento), pero no el del negocio
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', true);
do $$ begin
  if not exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wc')) where module_key = 'reports') then raise exception 'FALLO: Personal sin Reportes'; end if;
  begin
    perform public.report_business((select v::uuid from t_ctx where k='wc'), current_date - 30, current_date, 'NIO');
    raise exception 'FALLO: Personal usó el reporte de negocio';
  exception when sqlstate '22023' then null; end;
end $$;

-- Las funciones internas no se pueden llamar directamente
do $$ begin
  begin
    perform private.report_totals((select v::uuid from t_ctx where k='wa'), current_date - 30, current_date, 'USD');
    raise exception 'FALLO: función interna expuesta';
  exception when insufficient_privilege then null; end;
end $$;
-- Sin sesión, nada
reset role;
set local role anon;
do $$ begin
  begin
    perform public.report_business((select v::uuid from t_ctx where k='wa'), current_date - 30, current_date, 'USD');
    raise exception 'FALLO: anon vio reportes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.workspaces where id in ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='wb'), (select v::uuid from t_ctx where k='wc'));
select 'TODAS LAS PRUEBAS DE LA ETAPA 8 PASARON' as resultado;
rollback;
