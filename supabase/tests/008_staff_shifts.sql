-- =====================================================================
-- Pruebas Etapa 7 · Personal y turnos (se revierte)
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb'), ('00000000-0000-0000-0000-0000000000cc');
insert into t_ctx select 'ca', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_profesional'),null,'{rental,decoration}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','professional',(select id from public.plans where key='pro_mensual'),null,'{}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000aa','alq_a','Ana Alquiler',null,'Alquileres Ana','{rental,decoration}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000bb','plan_b','Pablo Planner',null,'Pablo Eventos','{}'))->>'workspace_id';
select public.svc_team_add((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000cc', 'alq_staff', 'Operativo', null, 'staff');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);

do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); juan uuid; maria uuid; pedro uuid; ev uuid; s1 uuid; s2 uuid; s3 uuid; sp uuid; sf uuid;
  a_juan uuid; a_maria uuid; a_past uuid; ok boolean; c record; tok text;
begin
  if not exists (select 1 from public.workspace_modules_for(ws) where module_key = 'shifts') then raise exception 'FALLO: alquiler sin Turnos'; end if;

  insert into public.workers(workspace_id, full_name, phone, positions, pay_type, rate, currency_code, portal_token)
    values (ws, 'Juan Pérez', '8888 1111', array['Mesero',' Bartender ','  '], 'shift', 600, 'NIO', 'TOKEN-INVENTADO-123') returning id into juan;
  if (select portal_token from public.workers where id = juan) is not null then raise exception 'FALLO: el navegador puso el enlace personal'; end if;
  if (select positions from public.workers where id = juan) <> '{Bartender,Mesero}' and (select positions from public.workers where id = juan) <> '{Mesero,Bartender}' then
    raise exception 'FALLO: puestos %', (select positions from public.workers where id = juan);
  end if;
  insert into public.workers(workspace_id, full_name, positions, pay_type, rate, currency_code) values (ws, 'María López', '{Mesero}', 'hour', 80, 'NIO') returning id into maria;
  insert into public.workers(workspace_id, full_name, positions, pay_type, rate, currency_code) values (ws, 'Pedro Ruiz', '{Montaje}', 'day', 900, 'NIO') returning id into pedro;
  insert into t_ctx values ('juan', juan), ('maria', maria);

  insert into public.events(workspace_id, name, starts_at) values (ws, 'Boda Castillo', now() + interval '10 days') returning id into ev;
  insert into t_ctx values ('ev', ev);
  -- Turno 1: 2 meseros de 5 pm a 11 pm (6 h)
  insert into public.shifts(workspace_id, event_id, position, starts_at, ends_at, needed, instructions)
    values (ws, ev, 'Mesero', date_trunc('day', now()) + interval '10 days 17 hours', date_trunc('day', now()) + interval '10 days 23 hours', 2, 'Camisa blanca, pantalón negro')
    returning id into s1;
  insert into t_ctx values ('s1', s1);
  insert into public.shift_assignments(workspace_id, shift_id, worker_id, pay_amount, rate) values (ws, s1, juan, 99999, 1) returning id into a_juan;
  insert into public.shift_assignments(workspace_id, shift_id, worker_id) values (ws, s1, maria) returning id into a_maria;
  insert into t_ctx values ('a_juan', a_juan);
  if (select pay_amount from public.shift_assignments where id = a_juan) <> 600 then raise exception 'FALLO: pago por turno %', (select pay_amount from public.shift_assignments where id = a_juan); end if;
  if (select pay_amount from public.shift_assignments where id = a_maria) <> 480 then raise exception 'FALLO: pago por hora %', (select pay_amount from public.shift_assignments where id = a_maria); end if;

  -- No más personas de las que pide el turno
  begin
    insert into public.shift_assignments(workspace_id, shift_id, worker_id) values (ws, s1, pedro);
    raise exception 'FALLO: se pasó de la cantidad';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- Choque: Juan no puede estar en otro turno a la misma hora
  insert into public.shifts(workspace_id, position, starts_at, ends_at) values (ws, 'Bartender', date_trunc('day', now()) + interval '10 days 20 hours', date_trunc('day', now()) + interval '11 days 2 hours') returning id into s2;
  begin
    insert into public.shift_assignments(workspace_id, shift_id, worker_id) values (ws, s2, juan);
    raise exception 'FALLO: doble turno';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' or sqlerrm not like '%otro turno%' then raise; end if; end;
  select * into c from public.shift_candidates(s2) where worker_id = juan;
  if c.conflict is null or not c.matches then raise exception 'FALLO: candidatos no muestra el choque o el puesto'; end if;

  -- No disponible
  insert into public.worker_unavailability(workspace_id, worker_id, starts_on, ends_on, reason) values (ws, pedro, (now() + interval '12 days')::date, (now() + interval '13 days')::date, 'Viaje');
  insert into public.shifts(workspace_id, position, starts_at, ends_at) values (ws, 'Montaje', date_trunc('day', now()) + interval '12 days 8 hours', date_trunc('day', now()) + interval '12 days 18 hours') returning id into s3;
  begin
    insert into public.shift_assignments(workspace_id, shift_id, worker_id) values (ws, s3, pedro);
    raise exception 'FALLO: asignó a alguien no disponible';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' or sqlerrm not like '%Viaje%' then raise; end if; end;

  -- Asistencia: María por hora trabaja 7 h + C$100 de transporte
  update public.shift_assignments set status = 'attended', check_in = date_trunc('day', now()) + interval '10 days 17 hours',
    check_out = date_trunc('day', now()) + interval '11 days', extras = 100, pay_amount = 1 where id = a_maria;
  if (select pay_amount from public.shift_assignments where id = a_maria) <> 660 then raise exception 'FALLO: pago con horas reales %', (select pay_amount from public.shift_assignments where id = a_maria); end if;
  -- Si el turno cambia de tarifa, se recalcula
  update public.shifts set rate = 100, pay_type = 'hour' where id = s1;
  if (select pay_amount from public.shift_assignments where id = a_juan) <> 600 then raise exception 'FALLO: tarifa de turno %', (select pay_amount from public.shift_assignments where id = a_juan); end if;
  -- (600 = 6 h × 100)
  -- Ausente: no se paga
  update public.shift_assignments set status = 'absent' where id = a_maria;
  if (select pay_amount from public.shift_assignments where id = a_maria) <> 0 then raise exception 'FALLO: ausente cobra'; end if;
  -- Mover el turno 1 sobre el turno de bartender no se puede si Juan quedaría en dos lugares
  insert into public.shift_assignments(workspace_id, shift_id, worker_id) values (ws, s3, juan);
  begin
    update public.shifts set starts_at = date_trunc('day', now()) + interval '12 days 9 hours', ends_at = date_trunc('day', now()) + interval '12 days 12 hours' where id = s1;
    raise exception 'FALLO: movió un turno creando choque';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- Turno pasado para pagar
  insert into public.shifts(workspace_id, position, starts_at, ends_at) values (ws, 'Mesero', now() - interval '3 days', now() - interval '3 days' + interval '5 hours') returning id into sp;
  insert into public.shift_assignments(workspace_id, shift_id, worker_id) values (ws, sp, pedro) returning id into a_past;
  insert into t_ctx values ('a_past', a_past), ('pedro', pedro);
  if (select pay_amount from public.shift_assignments where id = a_past) <> 900 then raise exception 'FALLO: pago por día'; end if;

  tok := public.worker_portal_link(juan);
  insert into t_ctx values ('tok', tok);
  update public.workers set portal_token = 'cambiado-por-navegador' where id = juan;
  if (select portal_token from public.workers where id = juan) <> tok then raise exception 'FALLO: el navegador cambió el enlace'; end if;
end $$;

-- El operativo ve y coordina turnos, pero no paga ni ve pagos
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', true);
do $$ begin
  if (select count(*) from public.shifts) < 3 then raise exception 'FALLO: el operativo no ve turnos'; end if;
  begin
    perform public.staff_pay((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='pedro'), array[(select v::uuid from t_ctx where k='a_past')], null, 'efectivo', null, null);
    raise exception 'FALLO: el operativo pagó';
  exception when insufficient_privilege then null; end;
end $$;

-- El dueño paga
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
do $$
declare ws uuid := (select v::uuid from t_ctx where k='wa'); a uuid := (select v::uuid from t_ctx where k='a_past'); p uuid; p2 uuid;
begin
  -- no se puede pagar un turno futuro
  begin
    perform public.staff_pay(ws, (select v::uuid from t_ctx where k='juan'), array[(select v::uuid from t_ctx where k='a_juan')], null, 'efectivo', null, null);
    raise exception 'FALLO: pagó un turno futuro';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  p := public.staff_pay(ws, (select v::uuid from t_ctx where k='pedro'), array[a], current_date, 'efectivo', null, null);
  if (select amount from public.staff_payouts where id = p) <> 900 or (select payout_id from public.shift_assignments where id = a) <> p
     or (select status from public.shift_assignments where id = a) <> 'attended' then raise exception 'FALLO: pago al personal'; end if;
  -- doble pago
  begin
    perform public.staff_pay(ws, (select v::uuid from t_ctx where k='pedro'), array[a], current_date, 'efectivo', null, null);
    raise exception 'FALLO: pagó dos veces';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- lo pagado no se cambia
  begin
    update public.shift_assignments set extras = 500 where id = a;
    raise exception 'FALLO: modificó un turno pagado';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- el navegador no puede marcar otro turno como pagado
  update public.shift_assignments set payout_id = p where id = (select v::uuid from t_ctx where k='a_juan');
  if (select payout_id from public.shift_assignments where id = (select v::uuid from t_ctx where k='a_juan')) is not null then raise exception 'FALLO: marcó pagado a mano'; end if;
  -- anular el pago deja el turno pendiente
  delete from public.staff_payouts where id = p;
  if (select payout_id from public.shift_assignments where id = a) is not null then raise exception 'FALLO: anular pago'; end if;
end $$;

-- Página del trabajador (sin cuenta)
reset role;
set local role anon;
do $$ declare d jsonb; a uuid := (select v::uuid from t_ctx where k='a_juan'); r jsonb; begin
  d := public.public_worker((select v from t_ctx where k='tok'));
  if d is null or jsonb_array_length(d->'shifts') <> 2 then raise exception 'FALLO: portal del trabajador %', d; end if;
  if d::text like '%María%' or d::text like '%Pedro%' or d::text like '%8888%' then raise exception 'FALLO: el portal muestra datos de otros'; end if;
  if public.public_worker('no-existe-este-token') is not null then raise exception 'FALLO: token falso'; end if;
  r := public.public_worker_respond((select v from t_ctx where k='tok'), a, true);
  if not (r->>'ok')::boolean then raise exception 'FALLO: confirmar %', r; end if;
  r := public.public_worker_respond((select v from t_ctx where k='tok'), (select v::uuid from t_ctx where k='a_past'), true);
  if (r->>'ok')::boolean then raise exception 'FALLO: confirmó un turno de otra persona'; end if;
  begin perform 1 from public.workers; raise exception 'FALLO: anon lee trabajadores';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select status from public.shift_assignments where id = (select v::uuid from t_ctx where k='a_juan')) <> 'confirmed' then raise exception 'FALLO: no quedó confirmado'; end if;
end $$;

-- Profesional también tiene Personal y Turnos, y no ve datos de otro negocio
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
do $$ begin
  if not exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wb')) where module_key = 'workforce') then raise exception 'FALLO: Profesional sin Personal'; end if;
  if (select count(*) from public.workers) + (select count(*) from public.shifts) + (select count(*) from public.shift_assignments) + (select count(*) from public.staff_payouts) <> 0 then
    raise exception 'FALLO: B ve datos de A';
  end if;
  begin
    perform * from public.shift_candidates((select v::uuid from t_ctx where k='s1'));
    raise exception 'FALLO: B vio candidatos de A';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_portal_link((select v::uuid from t_ctx where k='juan'));
    raise exception 'FALLO: B creó enlace de A';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.workspaces where id in ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='wb'));
select 'TODAS LAS PRUEBAS DE LA ETAPA 7 PASARON' as resultado;
rollback;
