-- =====================================================================
-- Pruebas Etapa 4 · Business alquiler (se revierte al final)
-- Disponibilidad sin sobreventa, entregas, devoluciones, daños,
-- depósitos, permisos por rol, equipo y aislamiento entre negocios.
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a8'), ('00000000-0000-0000-0000-0000000000b8'),
  ('00000000-0000-0000-0000-0000000000c8'), ('00000000-0000-0000-0000-0000000000d8');
insert into t_ctx select 'ca', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_profesional'),null,'{rental}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','business',(select id from public.plans where key='biz_inicial'),null,'{rental}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000a8','alq_a','Ana Alquileres',null,'Alquileres Ana','{rental}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000b8','alq_b','Beto Alquileres',null,'Alquileres Beto','{rental}'))->>'workspace_id';
-- Equipo: un operativo (staff) y una cuenta de solo lectura en A
select public.svc_team_add((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000c8', 'alq_staff', 'Carlos Bodega', null, 'staff');
select public.svc_team_add((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000d8', 'alq_ver', 'Diana Consulta', null, 'viewer');
do $$ begin
  -- Un operativo no puede crear cuentas
  if (public.svc_team_check((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000c8', null, 'staff')->>'ok')::boolean then
    raise exception 'FALLO: un operativo puede crear cuentas';
  end if;
  -- B (plan inicial: 2 usuarios) llena su cupo con 1 miembro más
  if not (public.svc_team_check((select v::uuid from t_ctx where k='wb'), '00000000-0000-0000-0000-0000000000b8', null, 'staff')->>'ok')::boolean then
    raise exception 'FALLO: B no puede agregar su primer miembro';
  end if;
  -- Nadie puede volverse propietario ni un admin nombrar admins
  if (public.svc_team_check((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000a8', null, 'owner')->>'ok')::boolean then
    raise exception 'FALLO: se puede crear otro propietario';
  end if;
  -- A no puede administrar cuentas de B
  if (public.svc_team_check((select v::uuid from t_ctx where k='wb'), '00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000b8', 'staff')->>'ok')::boolean then
    raise exception 'FALLO: A administra cuentas de B';
  end if;
  if (public.svc_team_check((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000c8', 'staff')->>'exclusive')::boolean is not true then
    raise exception 'FALLO: la cuenta del operativo debería ser exclusiva del negocio';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------- A: inventario y cliente
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', true);
insert into public.resources(workspace_id, name, category, total_qty, rent_price, replacement_cost, currency_code)
  values ((select v::uuid from t_ctx where k='wa'), 'Silla Tiffany dorada', 'Sillas', 100, 35, 900, 'NIO'),
         ((select v::uuid from t_ctx where k='wa'), 'Mesa redonda 10 pax', 'Mesas', 10, 150, 4000, 'NIO');
insert into t_ctx select 'silla', id from public.resources where name like 'Silla%';
insert into t_ctx select 'mesa', id from public.resources where name like 'Mesa%';
insert into public.customers(workspace_id, name, status) values ((select v::uuid from t_ctx where k='wa'), 'Hotel Las Palmas', 'active');
insert into t_ctx select 'cust', id from public.customers;

-- Función de ayuda: crea una reservación con N sillas
create function pg_temp.mk(p_title text, p_from timestamptz, p_to timestamptz, p_qty int, p_status text default 'draft') returns uuid
language plpgsql as $$
declare r_id uuid;
begin
  insert into public.rentals(workspace_id, customer_id, title, starts_at, ends_at, currency_code, tax_rate)
  values ((select c.v::uuid from t_ctx c where c.k='wa'), (select c.v::uuid from t_ctx c where c.k='cust'), p_title, p_from, p_to, 'NIO', 15)
  returning id into r_id;
  insert into public.rental_items(workspace_id, rental_id, resource_id, description, quantity, unit_price)
  values ((select c.v::uuid from t_ctx c where c.k='wa'), r_id, (select c.v::uuid from t_ctx c where c.k='silla'), 'Silla Tiffany dorada', p_qty, 35);
  if p_status <> 'draft' then update public.rentals set status = p_status where id = r_id; end if;
  return r_id;
end $$;

do $$
declare r1 uuid; r2 uuid; r4 uuid; rv record;
begin
  -- R1: 80 sillas el 10-11 feb (apartado)
  r1 := pg_temp.mk('Boda 1', '2027-02-10 16:00+00', '2027-02-11 16:00+00', 80, 'reserved');
  insert into t_ctx values ('r1', r1);
  select * into rv from public.rentals where id = r1;
  if rv.number <> 1 or rv.subtotal <> 2800 or rv.tax_amount <> 420 or rv.total <> 3220 then
    raise exception 'FALLO: totales/número de la reservación (%, %, %, %)', rv.number, rv.subtotal, rv.tax_amount, rv.total;
  end if;

  -- R2: 30 sillas cruzándose con R1 → en borrador sí (no aparta), al apartar NO
  r2 := pg_temp.mk('Cumple', '2027-02-11 08:00+00', '2027-02-12 08:00+00', 30);
  begin
    update public.rentals set status = 'reserved' where id = r2;
    raise exception 'FALLO: se sobrevendieron sillas (110 de 100)';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FALLO%' then raise; end if;
    if sqlerrm not like 'No hay suficientes "Silla Tiffany dorada"%disponibles 20%' then raise exception 'FALLO: mensaje inesperado: %', sqlerrm; end if;
  end;
  -- Con 20 sí cabe
  update public.rental_items set quantity = 20 where rental_id = r2;
  update public.rentals set status = 'reserved' where id = r2;
  -- Y subir a 21 ya no
  begin
    update public.rental_items set quantity = 21 where rental_id = r2;
    raise exception 'FALLO: se sobrevendió al editar la cantidad';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- Pico real: R4 (12-13 feb, 80) no se cruza con R1; R5 (10-13 feb) choca con el pico de 100 (R1+R2) → 0 disponibles
  r4 := pg_temp.mk('Boda 2', '2027-02-12 10:00+00', '2027-02-13 10:00+00', 80, 'reserved');
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), '2027-02-12 10:00+00', '2027-02-13 10:00+00')
      where resource_id = (select v::uuid from t_ctx where k='silla')) <> 20 then
    raise exception 'FALLO: disponibilidad 12-13 feb debería ser 20';
  end if;
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), '2027-02-10 00:00+00', '2027-02-14 00:00+00')
      where resource_id = (select v::uuid from t_ctx where k='silla')) <> 0 then
    raise exception 'FALLO: disponibilidad 10-14 feb debería ser 0 (pico de 100)';
  end if;
  -- Del 13 al 14 (después de todo) están las 100
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), '2027-02-13 10:00+00', '2027-02-14 10:00+00')
      where resource_id = (select v::uuid from t_ctx where k='silla')) <> 100 then
    raise exception 'FALLO: el 13 feb deberían estar las 100 sillas';
  end if;
  -- Por día (zona horaria de Managua)
  if (select count(*) from public.rental_availability_days((select v::uuid from t_ctx where k='wa'), '2027-02-09', 7)) <> 14 then
    raise exception 'FALLO: disponibilidad por día';
  end if;
  if (select available from public.rental_availability_days((select v::uuid from t_ctx where k='wa'), '2027-02-09', 7)
      where resource_id = (select v::uuid from t_ctx where k='silla') and day = '2027-02-09') <> 100 then
    raise exception 'FALLO: el 9 feb deberían estar las 100';
  end if;

  -- Mover R4 encima de R1 falla
  begin
    update public.rentals set starts_at = '2027-02-11 00:00+00' where id = r4;
    raise exception 'FALLO: mover fechas permitió sobreventa';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- Servicio sin inventario (transporte) no afecta disponibilidad
  insert into public.rental_items(workspace_id, rental_id, description, quantity, unit_price)
    values ((select v::uuid from t_ctx where k='wa'), r1, 'Transporte y montaje', 1, 500);
  if (select total from public.rentals where id = r1) <> 3795 then raise exception 'FALLO: total con transporte'; end if;

  -- El cliente no puede fijar número ni totales
  update public.rentals set number = 99, total = 1 where id = r1;
  if (select number from public.rentals where id = r1) <> 1 or (select total from public.rentals where id = r1) <> 3795 then
    raise exception 'FALLO: se alteraron número o total';
  end if;

  -- Transiciones inválidas
  begin update public.rentals set status = 'returned' where id = r1; raise exception 'FALLO: cerrar sin devolución';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;

  -- Depósito: no se puede devolver + retener más de lo recibido
  update public.rentals set deposit_amount = 2000, deposit_received = 2000 where id = r1;
  begin update public.rentals set deposit_refunded = 1500, deposit_retained = 600 where id = r1; raise exception 'FALLO: depósito inconsistente';
  exception when sqlstate 'P0001' or check_violation then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;

-- ---------------------------------------------------------------- Mantenimiento
do $$
declare m uuid;
begin
  -- 10 mesas: 3 dañadas → 7 disponibles
  insert into public.maintenance_records(workspace_id, resource_id, kind, quantity, description)
    values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='mesa'), 'damaged', 3, 'Patas flojas') returning id into m;
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), '2027-03-01', '2027-03-02')
      where resource_id = (select v::uuid from t_ctx where k='mesa')) <> 7 then raise exception 'FALLO: mesas en reparación siguen disponibles'; end if;
  begin
    insert into public.maintenance_records(workspace_id, resource_id, kind, quantity) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='mesa'), 'repair', 8);
    raise exception 'FALLO: más unidades en mantenimiento que existentes';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Baja definitiva de 1, la reparación de las otras 2 se resuelve
  update public.maintenance_records set quantity = 1, status = 'written_off' where id = m;
  if (select total_qty from public.resources where id = (select v::uuid from t_ctx where k='mesa')) <> 9 then raise exception 'FALLO: la baja no descontó inventario'; end if;
  -- Las otras 2 siguen fuera de servicio → 9 - 2 = 7 disponibles
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), '2027-03-01', '2027-03-02')
      where resource_id = (select v::uuid from t_ctx where k='mesa')) <> 7 then raise exception 'FALLO: resolución parcial'; end if;
  update public.maintenance_records set status = 'resolved' where resource_id = (select v::uuid from t_ctx where k='mesa') and status = 'open';
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), '2027-03-01', '2027-03-02')
      where resource_id = (select v::uuid from t_ctx where k='mesa')) <> 9 then raise exception 'FALLO: reparadas no volvieron'; end if;
  begin update public.maintenance_records set status = 'open' where id = m; raise exception 'FALLO: se reabrió un registro cerrado';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin delete from public.maintenance_records where id = m; raise exception 'FALLO: se borró un registro cerrado';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;

-- ---------------------------------------------------------------- Entrega y devolución
do $$
declare r1 uuid := (select c.v::uuid from t_ctx c where c.k='r1'); it uuid; rv record;
begin
  -- Varios artículos: la devolución no debe fallar porque los daños de uno reduzcan la existencia (pico de sillas = 100).
  insert into public.rental_items(workspace_id, rental_id, resource_id, description, quantity, unit_price, sort)
    values ((select c.v::uuid from t_ctx c where c.k='wa'), r1, (select c.v::uuid from t_ctx c where c.k='mesa'), 'Mesa redonda 10 pax', 2, 150, 9);
  update public.rentals set status = 'out', out_received_by = 'Gerente del hotel' where id = r1;
  if (select out_at from public.rentals where id = r1) is null then raise exception 'FALLO: no se registró la entrega'; end if;
  begin update public.rental_items set quantity = 10 where rental_id = r1 and resource_id is not null; raise exception 'FALLO: cambió cantidades después de entregar';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin delete from public.rental_items where rental_id = r1; raise exception 'FALLO: quitó artículos después de entregar';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Los datos de revisión no se escriben a mano
  update public.rental_items set damaged_qty = 50 where rental_id = r1 and resource_id = (select c.v::uuid from t_ctx c where c.k='silla');
  if (select damaged_qty from public.rental_items where rental_id = r1 and resource_id = (select c.v::uuid from t_ctx c where c.k='silla')) <> 0 then raise exception 'FALLO: revisión escrita a mano'; end if;
  begin
    perform public.rental_register_return(r1, jsonb_build_array(jsonb_build_object('id', (select id from public.rental_items where rental_id = r1 and resource_id = (select c.v::uuid from t_ctx c where c.k='silla')), 'damaged', 70, 'lost', 20)), null);
    raise exception 'FALLO: dañados + perdidos > entregados';
  exception when sqlstate 'P0001' or check_violation then if sqlerrm like 'FALLO%' then raise; end if; end;
  select id into it from public.rental_items where rental_id = r1 and resource_id = (select c.v::uuid from t_ctx c where c.k='silla');
  perform public.rental_register_return(r1, jsonb_build_array(jsonb_build_object('id', it, 'damaged', 5, 'lost', 2, 'charge', 1950, 'notes', 'Respaldos quebrados')), 'Revisado con el cliente');
  select * into rv from public.rentals where id = r1;
  if rv.status <> 'returned' or rv.returned_at is null or rv.damage_total <> 1950 then raise exception 'FALLO: cierre de devolución (% %)', rv.status, rv.damage_total; end if;
  if (select returned_ok from public.rental_items where id = it) <> 73 then raise exception 'FALLO: unidades en buen estado'; end if;
  if (select coalesce(sum(quantity), 0) from public.maintenance_records where rental_id = r1 and status = 'open') <> 7 then raise exception 'FALLO: daños no pasaron a mantenimiento'; end if;
  -- Ahora en marzo hay 93 sillas disponibles (7 fuera de servicio)
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), '2027-03-01', '2027-03-02')
      where resource_id = (select v::uuid from t_ctx where k='silla')) <> 93 then raise exception 'FALLO: sillas dañadas siguen disponibles'; end if;
  -- Devolver el depósito y retener daños
  update public.rentals set deposit_refunded = 50, deposit_retained = 1950 where id = r1;
  -- Cerrada: no cambia fechas
  begin update public.rentals set ends_at = '2027-02-20 00:00+00' where id = r1; raise exception 'FALLO: cambió fechas de una reservación cerrada';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- Entregada/cerrada no se borra (la política no la ve)
  delete from public.rentals where id = r1;
  if not exists (select 1 from public.rentals where id = r1) then raise exception 'FALLO: se borró una reservación cerrada'; end if;
end $$;

-- ---------------------------------------------------------------- Atrasos
do $$
declare r7 uuid;
begin
  -- Entregada hace 3 días, debía volver ayer y no ha vuelto: bloquea indefinidamente
  r7 := pg_temp.mk('Atrasada', now() - interval '3 days', now() - interval '1 day', 50, 'reserved');
  update public.rentals set status = 'out' where id = r7;
  if (select available from public.rental_availability((select v::uuid from t_ctx where k='wa'), now() + interval '300 days', now() + interval '301 days')
      where resource_id = (select v::uuid from t_ctx where k='silla')) <> 43 then
    raise exception 'FALLO: una entrega atrasada no bloquea el futuro';
  end if;
  if (public.rental_dashboard((select v::uuid from t_ctx where k='wa'))->>'returns_overdue')::int <> 1 then raise exception 'FALLO: panel no ve el atraso'; end if;
  begin
    perform pg_temp.mk('Futura grande', now() + interval '300 days', now() + interval '301 days', 44, 'reserved');
    raise exception 'FALLO: reservó unidades que siguen fuera';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;

-- Pago de A (lo usa la prueba de permisos)
insert into public.customer_payments(workspace_id, customer_id, rental_id, amount, currency_code)
  values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='cust'), (select v::uuid from t_ctx where k='r1'), 1000, 'NIO');

-- ---------------------------------------------------------------- Roles dentro de A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c8', true);
do $$
declare r uuid;
begin
  -- El operativo trabaja reservaciones e inventario…
  r := pg_temp.mk('Reserva del operativo', '2027-05-01', '2027-05-02', 5, 'reserved');
  update public.resources set notes = 'Revisadas' where id = (select v::uuid from t_ctx where k='silla');
  -- …pero no ve cobros ni finanzas ni el equipo
  if (select count(*) from public.customer_payments) <> 0 then raise exception 'FALLO: el operativo ve los cobros'; end if;
  if exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k='wa')) where module_key in ('finance','team','reports')) then
    raise exception 'FALLO: el operativo ve finanzas/equipo en su menú';
  end if;
  begin
    insert into public.customer_payments(workspace_id, customer_id, amount) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='cust'), 5);
    raise exception 'FALLO: el operativo registró un cobro';
  exception when insufficient_privilege then null; end;
  begin perform public.team_set_role((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000d8', 'staff'); raise exception 'FALLO: operativo cambia roles';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d8', true);
do $$ begin
  if (select count(*) from public.resources) <> 2 then raise exception 'FALLO: solo lectura no ve inventario'; end if;
  begin
    insert into public.resources(workspace_id, name, total_qty) values ((select v::uuid from t_ctx where k='wa'), 'Carpa', 1);
    raise exception 'FALLO: solo lectura creó inventario';
  exception when insufficient_privilege then null; end;
  update public.rentals set notes = 'hack';
  if exists (select 1 from public.rentals where notes = 'hack') then raise exception 'FALLO: solo lectura editó reservaciones'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', true);
do $$ begin
  if (select count(*) from public.customer_payments) <> 1 then raise exception 'FALLO: el propietario no ve sus cobros'; end if;
  perform public.team_set_role((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000d8', 'manager');
  if (select role from public.team_members((select v::uuid from t_ctx where k='wa')) where username = 'alq_ver') <> 'manager' then raise exception 'FALLO: cambio de rol'; end if;
  begin perform public.team_set_role((select v::uuid from t_ctx where k='wa'), '00000000-0000-0000-0000-0000000000a8', 'staff'); raise exception 'FALLO: el propietario se degradó';
  exception when sqlstate 'P0001' then if sqlerrm like 'FALLO%' then raise; end if; end;
  if (select count(*) from public.team_members((select v::uuid from t_ctx where k='wa'))) <> 3 then raise exception 'FALLO: lista del equipo'; end if;
end $$;

-- ---------------------------------------------------------------- Aislamiento: B
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b8', true);
do $$ begin
  if (select count(*) from public.resources) + (select count(*) from public.rentals) + (select count(*) from public.rental_items)
     + (select count(*) from public.maintenance_records) <> 0 then
    raise exception 'FALLO: B ve datos de A';
  end if;
  insert into public.customers(workspace_id, name) values ((select v::uuid from t_ctx where k='wb'), 'Cliente de B');
  insert into public.rentals(workspace_id, customer_id, title, starts_at, ends_at)
    values ((select v::uuid from t_ctx where k='wb'), (select id from public.customers where workspace_id = (select v::uuid from t_ctx where k='wb')), 'Reserva B', '2027-02-10', '2027-02-11');
  begin
    insert into public.rental_items(workspace_id, rental_id, resource_id, description, quantity)
      values ((select v::uuid from t_ctx where k='wb'), (select id from public.rentals where workspace_id = (select v::uuid from t_ctx where k='wb')), (select v::uuid from t_ctx where k='silla'), 'Silla robada', 1);
    raise exception 'FALLO: B usó inventario de A';
  exception when foreign_key_violation then null; end;
  begin perform public.rental_availability((select v::uuid from t_ctx where k='wa'), now(), now() + interval '1 day'); raise exception 'FALLO: B consulta disponibilidad de A';
  exception when insufficient_privilege then null; end;
  begin perform public.rental_dashboard((select v::uuid from t_ctx where k='wa')); raise exception 'FALLO: B ve el panel de A';
  exception when insufficient_privilege then null; end;
  begin perform public.rental_register_return((select v::uuid from t_ctx where k='r1'), '[]', null); raise exception 'FALLO: B registra devoluciones de A';
  exception when insufficient_privilege then null; end;
  begin perform public.team_members((select v::uuid from t_ctx where k='wa')); raise exception 'FALLO: B ve el equipo de A';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- El espacio completo se puede eliminar (cascada) aunque tenga reservaciones entregadas y bajas.
delete from public.workspaces where id = (select v::uuid from t_ctx where k='wa');
do $$ begin
  if exists (select 1 from public.rentals where workspace_id = (select v::uuid from t_ctx where k='wa')) then raise exception 'FALLO: cascada'; end if;
end $$;

select 'TODAS LAS PRUEBAS DE LA ETAPA 4 PASARON' as resultado;
rollback;
