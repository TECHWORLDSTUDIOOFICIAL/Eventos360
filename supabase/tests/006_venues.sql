-- =====================================================================
-- Pruebas Etapa 5 · Business salones y locales (se revierte al final)
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a9'), ('00000000-0000-0000-0000-0000000000b9');
insert into t_ctx select 'ca', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_profesional'),null,'{venue}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_profesional'),null,'{venue}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000a9','sal_a','Sara Salones',null,'Hacienda Santa Elena','{venue}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000b9','sal_b','Beto Salones',null,'Salones Beto','{venue}'))->>'workspace_id';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);

do $$ begin
  if not exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wa')) where module_key = 'bookings')
     or not exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wa')) where module_key = 'venue_calendar')
     or exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wa')) where module_key in ('reservations','availability')) then
    raise exception 'FALLO: módulos de la especialidad locales';
  end if;
end $$;

-- Espacios: Salón A, Salón B y "Gran salón" = A + B; Jardín independiente
insert into public.venues(workspace_id, name, cap_banquet, setup_minutes, teardown_minutes) values
  ((select v::uuid from t_ctx where k='wa'), 'Salón A', 120, 120, 60),
  ((select v::uuid from t_ctx where k='wa'), 'Salón B', 100, 120, 60),
  ((select v::uuid from t_ctx where k='wa'), 'Gran salón', 220, 180, 60),
  ((select v::uuid from t_ctx where k='wa'), 'Jardín', 300, 120, 60);
insert into t_ctx select 'A', id from public.venues where name = 'Salón A';
insert into t_ctx select 'B', id from public.venues where name = 'Salón B';
insert into t_ctx select 'G', id from public.venues where name = 'Gran salón';
insert into t_ctx select 'J', id from public.venues where name = 'Jardín';
insert into public.venue_parts(workspace_id, venue_id, part_id) values
  ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='G'), (select v::uuid from t_ctx where k='A')),
  ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='G'), (select v::uuid from t_ctx where k='B'));
do $$ begin
  begin
    insert into public.venue_parts(workspace_id, venue_id, part_id) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='J'), (select v::uuid from t_ctx where k='G'));
    raise exception 'FALLO: combinado dentro de combinado';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;

-- Tarifas: general, fin de semana y temporada de diciembre
insert into public.venue_rates(workspace_id, venue_id, name, weekdays, base_hours, base_price, extra_hour_price, deposit_amount, currency_code) values
  ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='J'), 'Entre semana', '{}', 5, 1000, 150, 300, 'USD'),
  ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='J'), 'Fin de semana', '{5,6}', 5, 1500, 200, 500, 'USD');
insert into public.venue_rates(workspace_id, venue_id, name, weekdays, season_from, season_to, base_hours, base_price, extra_hour_price, currency_code) values
  ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='J'), 'Temporada alta', '{}', '12-01', '01-15', 6, 2000, 250, 'USD');
insert into public.customers(workspace_id, name, status) values ((select v::uuid from t_ctx where k='wa'), 'Familia Castillo', 'active');
insert into t_ctx select 'cust', id from public.customers;

do $$
declare p jsonb; ws uuid := (select v::uuid from t_ctx where k='wa'); j uuid := (select v::uuid from t_ctx where k='J');
begin
  -- Miércoles 10 mar 2027, 6 h → "Entre semana", 1 hora extra
  p := public.venue_price(ws, j, '2027-03-10 18:00-06', '2027-03-11 00:00-06');
  if p->>'rate_name' <> 'Entre semana' or (p->>'extra_hours')::numeric <> 1 or (p->>'total')::numeric <> 1150 then raise exception 'FALLO: tarifa entre semana %', p; end if;
  -- Sábado 13 mar 2027 → "Fin de semana"
  p := public.venue_price(ws, j, '2027-03-13 18:00-06', '2027-03-13 23:00-06');
  if p->>'rate_name' <> 'Fin de semana' or (p->>'total')::numeric <> 1500 then raise exception 'FALLO: tarifa fin de semana %', p; end if;
  -- 5 ene 2027 (temporada que cruza el año) gana sobre las demás
  p := public.venue_price(ws, j, '2027-01-05 18:00-06', '2027-01-05 23:00-06');
  if p->>'rate_name' <> 'Temporada alta' then raise exception 'FALLO: temporada que cruza el año %', p; end if;
end $$;

-- ---------------------------------------------------------------- doble reserva
do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); b1 uuid; b2 uuid; c int;
begin
  -- B1: Salón A confirmado el sábado 20 mar 18:00-23:00 (montaje 2 h, desmontaje 1 h)
  insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at, setup_minutes, teardown_minutes, guests)
  values (ws, (select v::uuid from t_ctx where k='A'), (select v::uuid from t_ctx where k='cust'), 'Boda Castillo', 'confirmed', '2027-03-20 18:00-06', '2027-03-20 23:00-06', 120, 60, 110)
  returning id into b1;
  insert into t_ctx values ('b1', b1);
  if (select number from public.bookings where id = b1) <> 1 or (select confirmed_at from public.bookings where id = b1) is null then raise exception 'FALLO: número/confirmación'; end if;

  -- Mismo salón, termina 16:30 → choca con el montaje (16:00)
  begin
    insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
    values (ws, (select v::uuid from t_ctx where k='A'), (select v::uuid from t_ctx where k='cust'), 'Almuerzo', 'confirmed', '2027-03-20 12:00-06', '2027-03-20 16:30-06');
    raise exception 'FALLO: no respetó el tiempo de montaje';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALLO%' then raise; end if;
    if sqlerrm not like '"Salón A" ya está ocupado ese día por RSV-0001%' then raise exception 'FALLO: mensaje: %', sqlerrm; end if;
  end;
  -- Termina 15:30 → libre
  insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
  values (ws, (select v::uuid from t_ctx where k='A'), (select v::uuid from t_ctx where k='cust'), 'Almuerzo', 'confirmed', '2027-03-20 11:00-06', '2027-03-20 15:30-06');

  -- El Gran salón (A+B) ese día choca con A
  begin
    insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
    values (ws, (select v::uuid from t_ctx where k='G'), (select v::uuid from t_ctx where k='cust'), 'Graduación', 'hold', '2027-03-20 19:00-06', '2027-03-20 23:00-06');
    raise exception 'FALLO: el combinado ignoró su parte ocupada';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Salón B solo ese día sí está libre
  insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
  values (ws, (select v::uuid from t_ctx where k='B'), (select v::uuid from t_ctx where k='cust'), 'Cumpleaños', 'hold', '2027-03-20 19:00-06', '2027-03-20 23:00-06');

  -- Consulta (lista de espera) sí se guarda aunque esté ocupado
  insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
  values (ws, (select v::uuid from t_ctx where k='A'), (select v::uuid from t_ctx where k='cust'), 'Consulta', 'inquiry', '2027-03-20 18:00-06', '2027-03-20 23:00-06')
  returning id into b2;
  begin update public.bookings set status = 'confirmed' where id = b2; raise exception 'FALLO: confirmó una fecha ocupada';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Si se cancela la boda, la consulta ya puede confirmarse
  update public.bookings set status = 'canceled' where id = b1;
  update public.bookings set status = 'confirmed' where id = b2;

  select count(*) into c from public.venue_check(ws, (select v::uuid from t_ctx where k='G'), '2027-03-20 00:00-06', '2027-03-21 00:00-06');
  if c <> 3 then raise exception 'FALLO: venue_check del combinado debería ver 3 reservas (almuerzo, consulta confirmada, cumpleaños): %', c; end if;
end $$;

-- ---------------------------------------------------------------- apartados que vencen
do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); h uuid;
begin
  insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
  values (ws, (select v::uuid from t_ctx where k='J'), (select v::uuid from t_ctx where k='cust'), 'Apartado', 'hold', '2027-04-10 18:00-06', '2027-04-10 23:00-06')
  returning id into h;
  if (select hold_until from public.bookings where id = h) < now() + interval '6 days' then raise exception 'FALLO: vencimiento por defecto de 7 días'; end if;
  -- Otro apartado igual choca
  begin
    insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
    values (ws, (select v::uuid from t_ctx where k='J'), (select v::uuid from t_ctx where k='cust'), 'Otro', 'hold', '2027-04-10 18:00-06', '2027-04-10 23:00-06');
    raise exception 'FALLO: dos apartados el mismo día';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Simula que venció: ya no aparta y el proceso horario lo regresa a consulta
  reset role;
  alter table public.bookings disable trigger bookings_before;
  update public.bookings set hold_until = now() - interval '1 minute' where id = h;
  alter table public.bookings enable trigger bookings_before;
  if private.expire_venue_holds() <> 1 then raise exception 'FALLO: no venció el apartado'; end if;
  set local role authenticated;
  if (select status from public.bookings where id = h) <> 'inquiry' or (select hold_expired_at from public.bookings where id = h) is null then raise exception 'FALLO: estado tras vencer'; end if;
  insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
  values (ws, (select v::uuid from t_ctx where k='J'), (select v::uuid from t_ctx where k='cust'), 'Otro', 'confirmed', '2027-04-10 18:00-06', '2027-04-10 23:00-06');
end $$;

-- ---------------------------------------------------------------- bloqueos, totales, garantía
do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); b uuid;
begin
  -- Bloqueo interno (sin cliente) aparta el Jardín
  insert into public.bookings(workspace_id, kind, venue_id, title, status, starts_at, ends_at)
  values (ws, 'block', (select v::uuid from t_ctx where k='J'), 'Pintura y mantenimiento', 'inquiry', '2027-05-01 00:00-06', '2027-05-04 00:00-06') returning id into b;
  if (select status from public.bookings where id = b) <> 'confirmed' then raise exception 'FALLO: un bloqueo debe apartar'; end if;
  begin
    insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at)
    values (ws, (select v::uuid from t_ctx where k='J'), (select v::uuid from t_ctx where k='cust'), 'Fiesta', 'confirmed', '2027-05-02 18:00-06', '2027-05-02 23:00-06');
    raise exception 'FALLO: reservó encima de un bloqueo';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Sin cliente no hay reserva de evento
  begin
    insert into public.bookings(workspace_id, venue_id, title, starts_at, ends_at) values (ws, (select v::uuid from t_ctx where k='J'), 'Sin cliente', '2027-06-01 18:00-06', '2027-06-01 20:00-06');
    raise exception 'FALLO: evento sin cliente';
  exception when check_violation then null; end;
  -- Totales calculados en el servidor
  insert into public.bookings(workspace_id, venue_id, customer_id, title, status, starts_at, ends_at, tax_rate, currency_code)
  values (ws, (select v::uuid from t_ctx where k='J'), (select v::uuid from t_ctx where k='cust'), 'Quince', 'inquiry', '2027-06-05 18:00-06', '2027-06-06 00:00-06', 15, 'USD') returning id into b;
  insert into t_ctx values ('q', b);
  insert into public.booking_items(workspace_id, booking_id, description, quantity, unit_price) values
    (ws, b, 'Alquiler del Jardín – bloque de 5 h', 1, 1500), (ws, b, 'Hora adicional', 1, 200);
  update public.bookings set total = 1, number = 77 where id = b;
  if (select total from public.bookings where id = b) <> 1955 or (select number from public.bookings where id = b) = 77 then raise exception 'FALLO: totales/número'; end if;
  update public.bookings set deposit_amount = 500, deposit_received = 500 where id = b;
  begin update public.bookings set deposit_refunded = 400, deposit_retained = 200 where id = b; raise exception 'FALLO: garantía inconsistente';
  exception when sqlstate 'P0001' or check_violation then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Transición inválida
  begin update public.bookings set status = 'done' where id = b; raise exception 'FALLO: de consulta a realizada';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Una confirmada no se borra (la política no la ve)
  update public.bookings set status = 'confirmed' where id = b;
  delete from public.bookings where id = b;
  if not exists (select 1 from public.bookings where id = b) then raise exception 'FALLO: se borró una reserva confirmada'; end if;
  if ((public.venue_dashboard(ws)->>'venues')::int) <> 4 then raise exception 'FALLO: panel'; end if;
  if (select count(*) from public.venue_month(ws, '2027-03-01', 42)) < 4 then raise exception 'FALLO: calendario del mes'; end if;
end $$;

-- ---------------------------------------------------------------- página pública
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);
insert into t_ctx select 'tok', public.venue_public_link((select v::uuid from t_ctx where k='wa'), true);
reset role;
set local role anon;
select set_config('request.headers', '{"x-forwarded-for": "10.1.2.3"}', true);
do $$
declare d jsonb; r jsonb; i int;
begin
  d := public.public_venues((select v from t_ctx where k='tok'));
  if jsonb_array_length(d->'venues') <> 4 then raise exception 'FALLO: espacios públicos'; end if;
  if not (select (x->'busy') ? '2027-03-20' from jsonb_array_elements(d->'venues') x where x->>'name' = 'Gran salón') then raise exception 'FALLO: día ocupado del combinado'; end if;
  if d::text like '%Familia Castillo%' or d::text like '%Boda%' then raise exception 'FALLO: la página pública muestra datos de clientes'; end if;
  if public.public_venues('token-falso') is not null then raise exception 'FALLO: token falso'; end if;
  r := public.public_venue_inquiry((select v from t_ctx where k='tok'), (select v::uuid from t_ctx where k='J'), '2027-08-14', 'noche', 150, 'Ana Torres', '+505 8888 1234', 'Boda civil');
  if not (r->>'ok')::boolean then raise exception 'FALLO: consulta pública %', r; end if;
  r := public.public_venue_inquiry((select v from t_ctx where k='tok'), (select v::uuid from t_ctx where k='J'), '2020-01-01', 'noche', 10, 'Ana Torres', '88881234', null);
  if (r->>'ok')::boolean then raise exception 'FALLO: aceptó fecha pasada'; end if;
  for i in 1..4 loop perform public.public_venue_inquiry((select v from t_ctx where k='tok'), (select v::uuid from t_ctx where k='J'), '2027-08-15', 'tarde', 10, 'Spam Spam', '88880000', null); end loop;
  r := public.public_venue_inquiry((select v from t_ctx where k='tok'), (select v::uuid from t_ctx where k='J'), '2027-08-16', 'tarde', 10, 'Spam Spam', '88880000', null);
  if (r->>'ok')::boolean then raise exception 'FALLO: sin límite por hora'; end if;
  begin perform 1 from public.bookings; raise exception 'FALLO: anon lee reservas'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.bookings where source = 'web' and status = 'inquiry') <> 5 then raise exception 'FALLO: consultas web registradas'; end if;
  if (select count(*) from public.customers where source = 'Página de consultas') <> 2 then raise exception 'FALLO: clientes de la web (uno por teléfono)'; end if;
end $$;

-- ---------------------------------------------------------------- aislamiento
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', true);
do $$ begin
  if (select count(*) from public.venues) + (select count(*) from public.bookings) + (select count(*) from public.venue_rates) + (select count(*) from public.booking_items) <> 0 then
    raise exception 'FALLO: B ve datos de A';
  end if;
  insert into public.customers(workspace_id, name) values ((select v::uuid from t_ctx where k='wb'), 'Cliente B');
  begin
    insert into public.bookings(workspace_id, venue_id, customer_id, title, starts_at, ends_at)
    values ((select v::uuid from t_ctx where k='wb'), (select v::uuid from t_ctx where k='J'), (select id from public.customers where name = 'Cliente B'), 'Robo', '2027-09-01', '2027-09-02');
    raise exception 'FALLO: B reservó un espacio de A';
  exception when foreign_key_violation then null; end;
  begin perform public.venue_check((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='J'), now(), now() + interval '1 day'); raise exception 'FALLO: B consulta A';
  exception when insufficient_privilege then null; end;
  begin perform public.venue_public_link((select v::uuid from t_ctx where k='wa'), false); raise exception 'FALLO: B cambia el enlace de A';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.workspaces where id = (select v::uuid from t_ctx where k='wa');
select 'TODAS LAS PRUEBAS DE LA ETAPA 5 PASARON' as resultado;
rollback;
