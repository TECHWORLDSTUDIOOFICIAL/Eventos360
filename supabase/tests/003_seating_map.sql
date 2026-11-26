-- Pruebas: mapa de mesas (aislamiento y validación). Se revierte al final.
begin;
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-0000000000f2');
insert into t_ctx select 'ca', code from private.create_access_code('signup','personal',(select id from public.plans where key='personal_mensual'),null,'{}',null,null,null,null,1,null);
insert into t_ctx select 'cb', code from private.create_access_code('signup','personal',(select id from public.plans where key='personal_mensual'),null,'{}',null,null,null,null,1,null);
set local role service_role;
insert into t_ctx select 'wa', (public.svc_complete_signup((select v from t_ctx where k='ca'),'ip:t','00000000-0000-0000-0000-0000000000f1','map_a','Mapa A',null,'Espacio A','{}'))->>'workspace_id';
insert into t_ctx select 'wb', (public.svc_complete_signup((select v from t_ctx where k='cb'),'ip:t','00000000-0000-0000-0000-0000000000f2','map_b','Mapa B',null,'Espacio B','{}'))->>'workspace_id';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
insert into public.events(workspace_id, name) values ((select v::uuid from t_ctx where k='wa'), 'Evento A');
insert into t_ctx select 'ea', id from public.events;
insert into public.event_tables(workspace_id, event_id, name, capacity, pos_x, pos_y) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='ea'), 'Mesa 1', 8, 20, 30);
insert into public.event_map_items(workspace_id, event_id, kind, label) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='ea'), 'dance', 'Pista');
do $$ begin
  begin update public.event_tables set pos_x = 150; raise exception 'FALLO: posición fuera del plano';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
do $$ begin
  if (select count(*) from public.event_map_items) <> 0 then raise exception 'FALLO: B ve el mapa de A'; end if;
  update public.event_map_items set pos_x = 1;
  begin insert into public.event_map_items(workspace_id, event_id, kind) values ((select v::uuid from t_ctx where k='wa'), (select v::uuid from t_ctx where k='ea'), 'bar'); raise exception 'FALLO: B escribe en A';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin if (select pos_x from public.event_map_items) <> 50 then raise exception 'FALLO: B movió elementos de A'; end if; end $$;
select 'PRUEBAS DEL MAPA DE MESAS PASARON' as resultado;
rollback;
