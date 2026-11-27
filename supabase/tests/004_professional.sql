-- =====================================================================
-- Pruebas Etapa 3 · Profesional (se revierte al final)
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a7'), ('00000000-0000-0000-0000-0000000000b7');
insert into t_ctx select 'ca', code from private.create_access_code('signup','professional',(select id from public.plans where key='pro_mensual'),null,'{}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','professional',(select id from public.plans where key='pro_mensual'),null,'{}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000a7','pro_a','Laura Planner',null,'Laura Wedding Planner','{}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000b7','pro_b','Mario Eventos',null,'Mario Eventos','{}'))->>'workspace_id';
reset role;

-- ---------------------------------------------------------------- A: cliente, evento, cotización
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', true);
insert into public.customers(workspace_id, name, phone, status) values ((select v::uuid from t_ctx where k='wa'), 'Familia Rodríguez', '88880000', 'active');
insert into t_ctx select 'cust', id from public.customers;
insert into public.customer_activities(workspace_id, customer_id, kind, body, follow_up_on)
  values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='cust'), 'call', 'Llamar para confirmar fecha', current_date);
insert into public.events(workspace_id, name, customer_id, starts_at, ends_at)
  values ((select v::uuid from t_ctx where k='wa'), 'Boda Rodríguez', (select v::uuid from t_ctx where k='cust'), '2027-02-14 23:00+00', '2027-02-15 05:00+00');
insert into t_ctx select 'ev', id from public.events;

insert into public.quotes(workspace_id, customer_id, event_id, title, tax_rate, discount_amount, currency_code, status)
  values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='cust'), (select v::uuid from t_ctx where k='ev'), 'Coordinación integral', 15, 50, 'USD', 'draft');
insert into t_ctx select 'q', id from public.quotes;
insert into public.quote_items(workspace_id, quote_id, description, quantity, unit_price, discount_pct, sort) values
  ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='q'), 'Coordinación del día', 2, 1000, 0, 1),
  ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='q'), 'Decoración básica', 1, 500, 10, 2);
insert into public.quotes(workspace_id, customer_id, title) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='cust'), 'Segunda cotización');
do $$ begin
  -- 2×1000 + 500×0.9 = 2450; −50 = 2400; IVA 15% = 360; total 2760
  if (select subtotal from public.quotes where id = (select v::uuid from t_ctx where k='q')) <> 2450
     or (select tax_amount from public.quotes where id = (select v::uuid from t_ctx where k='q')) <> 360
     or (select total from public.quotes where id = (select v::uuid from t_ctx where k='q')) <> 2760 then
    raise exception 'FALLO: totales de cotización %', (select row(subtotal, tax_amount, total) from public.quotes where id = (select v::uuid from t_ctx where k='q'));
  end if;
  if (select array_agg(number order by number) from public.quotes) <> array[1,2] then raise exception 'FALLO: numeración correlativa'; end if;
  begin update public.quotes set total = 1 where id = (select v::uuid from t_ctx where k='q'); raise exception 'FALLO: el cliente cambió el total';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.event_conflicts((select v::uuid from t_ctx where k='wa'), '2027-02-15 01:00+00', '2027-02-15 03:00+00')) <> 1 then
    raise exception 'FALLO: no detectó conflicto de fecha';
  end if;
  if (select count(*) from public.event_conflicts((select v::uuid from t_ctx where k='wa'), '2027-02-16 01:00+00', null)) <> 0 then
    raise exception 'FALLO: conflicto falso';
  end if;
end $$;

-- ---------------------------------------------------------------- Cotización pública
reset role;
insert into t_ctx select 'qtok', public_token from public.quotes where id = (select v::uuid from t_ctx where k='q');
set local role anon;
do $$ begin
  if public.public_quote((select v from t_ctx where k='qtok')) is not null then raise exception 'FALLO: borrador visible'; end if;
  begin perform count(*) from public.quotes; raise exception 'FALLO: anon lee cotizaciones';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', true);
update public.quotes set status = 'sent' where id = (select v::uuid from t_ctx where k='q');
reset role; set local role anon;
do $$
declare r jsonb;
begin
  r := public.public_quote((select v from t_ctx where k='qtok'));
  if r is null or (r->'quote'->>'total')::numeric <> 2760 or jsonb_array_length(r->'items') <> 2 then raise exception 'FALLO: cotización pública %', r; end if;
  begin perform public.public_respond_quote((select v from t_ctx where k='qtok'), true, 'x'); raise exception 'FALLO: aceptó sin nombre';
  exception when sqlstate 'P0001' then null; end;
  r := public.public_respond_quote((select v from t_ctx where k='qtok'), true, 'Carlos Rodríguez');
  begin perform public.public_respond_quote((select v from t_ctx where k='qtok'), false, null); raise exception 'FALLO: respondió dos veces';
  exception when sqlstate 'P0001' then null; end;
end $$;
reset role;
do $$ begin
  if (select status from public.quotes where id = (select v::uuid from t_ctx where k='q')) <> 'accepted'
     or (select accepted_at from public.quotes where id = (select v::uuid from t_ctx where k='q')) is null then raise exception 'FALLO: aceptación'; end if;
end $$;

-- ---------------------------------------------------------------- Contrato con aceptación
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', true);
insert into public.contracts(workspace_id, customer_id, event_id, quote_id, title, body, amount, currency_code, status)
  values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='cust'), (select v::uuid from t_ctx where k='ev'),
          (select v::uuid from t_ctx where k='q'), 'Contrato de servicios', 'Cláusula primera: el organizador coordinará el evento.', 2760, 'USD', 'accepted');
insert into t_ctx select 'k', id from public.contracts;
do $$ begin
  if (select status from public.contracts) <> 'draft' then raise exception 'FALLO: se creó un contrato ya aceptado'; end if;
  begin update public.contracts set status = 'accepted'; raise exception 'FALLO: marcó aceptado sin el cliente';
  exception when sqlstate 'P0001' then null; end;
  update public.contracts set status = 'sent';
end $$;
reset role;
insert into t_ctx select 'ktok', public_token from public.contracts;
set local role anon;
select public.public_accept_contract((select v from t_ctx where k='ktok'), 'Carlos Rodríguez Pérez', '001-010190-0001A');
reset role;
do $$ begin
  if (select status from public.contracts) <> 'accepted' or (select accepted_hash from public.contracts) <> encode(extensions.digest((select body from public.contracts), 'sha256'), 'hex') then
    raise exception 'FALLO: evidencia de aceptación';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', true);
do $$ begin
  begin update public.contracts set body = 'Texto cambiado después de firmar'; raise exception 'FALLO: modificó un contrato aceptado';
  exception when sqlstate 'P0001' then null; end;
  delete from public.contracts;
  if (select count(*) from public.contracts) <> 1 then raise exception 'FALLO: borró un contrato aceptado'; end if;
  update public.contracts set status = 'canceled';  -- cancelar sí se permite
end $$;

-- ---------------------------------------------------------------- Pagos y panel
insert into public.customer_payments(workspace_id, customer_id, event_id, quote_id, kind, amount, currency_code, paid_at)
  values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='cust'), (select v::uuid from t_ctx where k='ev'), (select v::uuid from t_ctx where k='q'), 'deposit', 1000, 'USD', current_date);
do $$
declare d jsonb;
begin
  d := public.pro_dashboard((select v::uuid from t_ctx where k='wa'), current_date - 30, current_date);
  if (d->>'customers_active')::int <> 1 or (d->>'income_period')::numeric <> 1000 or (d->>'contracted_total')::numeric <> 2760 or (d->>'followups_due')::int <> 1 then
    raise exception 'FALLO: panel %', d;
  end if;
end $$;

-- ---------------------------------------------------------------- Aislamiento: B
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b7', true);
do $$ begin
  if (select count(*) from public.customers) + (select count(*) from public.quotes) + (select count(*) from public.contracts)
     + (select count(*) from public.customer_payments) + (select count(*) from public.customer_activities) + (select count(*) from public.quote_items) <> 0 then
    raise exception 'FALLO: B ve datos de A';
  end if;
  begin
    insert into public.quotes(workspace_id, customer_id, title) values ((select v::uuid from t_ctx where k='wb'), (select v::uuid from t_ctx where k='cust'), 'Robo de cliente');
    raise exception 'FALLO: B cotizó a un cliente de A';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.quote_items(workspace_id, quote_id, description) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='q'), 'x');
    raise exception 'FALLO: B agregó líneas a la cotización de A';
  exception when insufficient_privilege then null; end;
  if (public.pro_dashboard((select v::uuid from t_ctx where k='wa'), current_date - 30, current_date)->>'income_period')::numeric <> 0 then
    raise exception 'FALLO: B ve el panel de A';
  end if;
end $$;

-- Personal no puede usar módulos profesionales
reset role;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000c7');
insert into t_ctx select 'cp', code from private.create_access_code('signup','personal',(select id from public.plans where key='personal_mensual'),null,'{}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wp', (public.svc_complete_signup((select v from t_ctx where k='cp'),'ip:t','00000000-0000-0000-0000-0000000000c7','pers_c','Persona C',null,'Mi fiesta','{}'))->>'workspace_id';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c7', true);
do $$ begin
  begin insert into public.customers(workspace_id, name) values ((select v::uuid from t_ctx where k='wp'), 'Cliente X'); raise exception 'FALLO: Personal creó clientes';
  exception when insufficient_privilege or sqlstate 'P0001' then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;
reset role;
select 'TODAS LAS PRUEBAS DE LA ETAPA 3 PASARON' as resultado;
rollback;
