-- =====================================================================
-- Pruebas Etapa 2 · Eventos360 Personal (se revierte al final)
-- =====================================================================
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-0000000000e1'),  -- Personal A
  ('00000000-0000-0000-0000-0000000000e2');  -- Personal B

-- Dos cuentas Personal (plan mensual: 1 evento, 300 invitados)
insert into t_ctx select 'code_a', code from private.create_access_code('signup','personal',(select id from public.plans where key='personal_mensual'),null,'{}',null,null,null,null,1,null);
insert into t_ctx select 'code_b', code from private.create_access_code('signup','personal',(select id from public.plans where key='personal_mensual'),null,'{}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'ws_a', (public.svc_complete_signup((select v from t_ctx where k='code_a'),'ip:t','00000000-0000-0000-0000-0000000000e1','pers_a','María López',null,'Boda de María','{}'))->>'workspace_id';
insert into t_ctx select 'ws_b', (public.svc_complete_signup((select v from t_ctx where k='code_b'),'ip:t','00000000-0000-0000-0000-0000000000e2','pers_b','Carlos Ruiz',null,'XV de Sofía','{}'))->>'workspace_id';
reset role;

-- ---------------------------------------------------------------- A crea su evento
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
insert into public.events(workspace_id, name, category, starts_at, budget, currency_code)
  values ((select v::uuid from t_ctx where k='ws_a'), 'Boda María & José', 'boda', now() + interval '90 days', 150000, 'NIO');
insert into t_ctx select 'ev_a', id from public.events;
do $$ begin
  -- Límite del plan: 1 evento
  begin
    insert into public.events(workspace_id, name) values ((select v::uuid from t_ctx where k='ws_a'), 'Segundo evento');
    raise exception 'FALLO: se superó el límite de eventos';
  exception when sqlstate 'P0001' then if sqlerrm not like '%límite%' then raise; end if; end;
end $$;

insert into public.guest_groups(workspace_id, event_id, name) values ((select v::uuid from t_ctx where k='ws_a'), (select v::uuid from t_ctx where k='ev_a'), 'Familia novia');
insert into public.event_tables(workspace_id, event_id, name, capacity) values ((select v::uuid from t_ctx where k='ws_a'), (select v::uuid from t_ctx where k='ev_a'), 'Mesa 1', 4);
insert into public.guests(workspace_id, event_id, first_name, last_name, max_companions, group_id)
  values ((select v::uuid from t_ctx where k='ws_a'), (select v::uuid from t_ctx where k='ev_a'), 'Ana', 'Pérez', 2, (select id from public.guest_groups limit 1)),
         ((select v::uuid from t_ctx where k='ws_a'), (select v::uuid from t_ctx where k='ev_a'), 'Luis', 'Gómez', 1, null);
insert into t_ctx select 'tok_ana', invite_token from public.guests where first_name = 'Ana';
insert into t_ctx select 'guest_luis', id from public.guests where first_name = 'Luis';

do $$ begin
  -- El token no se puede modificar desde el cliente
  begin
    update public.guests set invite_token = 'x' where first_name = 'Ana';
    raise exception 'FALLO: se modificó invite_token';
  exception when insufficient_privilege then null; end;
  -- Más personas que acompañantes permitidos
  begin
    update public.guests set adults = 3, children = 1 where first_name = 'Ana';
    raise exception 'FALLO: se aceptaron más personas que las permitidas';
  exception when check_violation then null; end;
end $$;

-- ---------------------------------------------------------------- Mesas: capacidad 4
update public.guests set adults = 3, table_id = (select id from public.event_tables limit 1) where first_name = 'Ana';
do $$ begin
  begin
    update public.guests set adults = 2, table_id = (select id from public.event_tables limit 1) where first_name = 'Luis';
    raise exception 'FALLO: se superó la capacidad de la mesa';
  exception when sqlstate 'P0001' then if sqlerrm not like '%espacio%' then raise; end if; end;
end $$;
update public.guests set status = 'confirmed', adults = 1, table_id = (select id from public.event_tables limit 1) where first_name = 'Luis';  -- 3 + 1 = 4: cabe (pendiente reservaría 2)

-- ---------------------------------------------------------------- Aislamiento: B no ve ni toca datos de A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$ begin
  if (select count(*) from public.events) + (select count(*) from public.guests) + (select count(*) from public.event_tables)
     + (select count(*) from public.guest_groups) <> 0 then raise exception 'FALLO: B ve datos de A'; end if;
  -- B intenta insertar un invitado en el evento de A
  begin
    insert into public.guests(workspace_id, event_id, first_name) values ((select v::uuid from t_ctx where k='ws_a'), (select v::uuid from t_ctx where k='ev_a'), 'Intruso');
    raise exception 'FALLO: B insertó en el workspace de A';
  exception when insufficient_privilege then null; end;
  -- B crea su evento y trata de colgar un invitado suyo del evento de A (workspace propio, evento ajeno)
  insert into public.events(workspace_id, name) values ((select v::uuid from t_ctx where k='ws_b'), 'XV de Sofía');
  begin
    insert into public.guests(workspace_id, event_id, first_name) values ((select v::uuid from t_ctx where k='ws_b'), (select v::uuid from t_ctx where k='ev_a'), 'Cruzado');
    raise exception 'FALLO: referencia cruzada a evento ajeno';
  exception when foreign_key_violation then null; end;
  update public.guests set first_name = 'hack' where id = (select v::uuid from t_ctx where k='guest_luis');
  if exists (select 1 from public.guests) then raise exception 'FALLO: B ve invitados de A tras update'; end if;
  begin
    perform public.regenerate_invite_token((select v::uuid from t_ctx where k='guest_luis'));
    raise exception 'FALLO: B regeneró token ajeno';
  exception when insufficient_privilege then null; end;
  if (public.event_summary((select v::uuid from t_ctx where k='ev_a'))->>'guests_total')::int <> 0 then
    raise exception 'FALLO: event_summary filtra datos ajenos';
  end if;
end $$;

-- ---------------------------------------------------------------- Invitación pública (anon)
reset role;
set local role anon;
do $$ begin
  if public.public_invitation((select v from t_ctx where k='tok_ana')) is not null then
    raise exception 'FALLO: invitación visible sin publicar';
  end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
insert into public.invitations(workspace_id, event_id, title, is_published)
  values ((select v::uuid from t_ctx where k='ws_a'), (select v::uuid from t_ctx where k='ev_a'), '¡Nos casamos!', true);
reset role;
set local role anon;
do $$
declare r jsonb;
begin
  r := public.public_invitation((select v from t_ctx where k='tok_ana'));
  if r is null or r->'guest'->>'first_name' <> 'Ana' then raise exception 'FALLO: invitación publicada no visible: %', r; end if;
  if r::text like '%Luis%' then raise exception 'FALLO: la invitación expone otros invitados'; end if;
  if public.public_invitation('token-inexistente-123456') is not null then raise exception 'FALLO: token falso'; end if;
  begin
    perform public.public_rsvp((select v from t_ctx where k='tok_ana'), true, 3, 1, null);
    raise exception 'FALLO: RSVP superó acompañantes';
  exception when sqlstate 'P0001' then if sqlerrm not like '%máximo%' then raise; end if; end;
  r := public.public_rsvp((select v from t_ctx where k='tok_ana'), true, 2, 1, '¡Ahí estaremos!');
  if r->>'status' <> 'confirmed' then raise exception 'FALLO: RSVP'; end if;
  begin
    perform count(*) from public.guests;
    raise exception 'FALLO: anon lee invitados';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select status from public.guests where first_name='Ana') <> 'confirmed' or (select children from public.guests where first_name='Ana') <> 1 then
    raise exception 'FALLO: RSVP no guardado';
  end if;
end $$;

-- ---------------------------------------------------------------- Resumen y suscripción suspendida
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$
declare s jsonb;
begin
  s := public.event_summary((select v::uuid from t_ctx where k='ev_a'));
  if (s->>'guests_total')::int <> 2 or (s->>'guests_confirmed')::int <> 2 or (s->>'people_confirmed')::int <> 4 then
    raise exception 'FALLO: resumen %', s;
  end if;
end $$;
reset role;
update public.subscriptions set status = 'suspended' where workspace_id = (select v::uuid from t_ctx where k='ws_a');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$ begin
  if (select count(*) from public.guests) <> 2 then raise exception 'FALLO: suspendido no puede leer'; end if;
  begin
    insert into public.event_tasks(workspace_id, event_id, title) values ((select v::uuid from t_ctx where k='ws_a'), (select v::uuid from t_ctx where k='ev_a'), 'x');
    raise exception 'FALLO: suspendido pudo escribir';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  if public.public_invitation((select v from t_ctx where k='tok_ana')) is not null then raise exception 'FALLO: invitación activa con cuenta suspendida'; end if;
end $$;
reset role;
select 'TODAS LAS PRUEBAS DE LA ETAPA 2 PASARON' as resultado;
rollback;
