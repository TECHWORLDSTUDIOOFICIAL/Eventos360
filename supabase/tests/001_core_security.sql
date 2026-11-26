-- =====================================================================
-- Pruebas de seguridad y lógica de la Etapa 1.
-- Ejecutar dentro de una transacción que se revierte (no deja datos):
--   psql ... -v ON_ERROR_STOP=1 -f supabase/tests/001_core_security.sql
-- Cada bloque lanza una excepción si una aserción falla.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, service_role, anon;

-- Usuarios de prueba en auth.users
insert into auth.users(id) values
  ('00000000-0000-0000-0000-0000000000a1'),  -- administrador de plataforma (owner)
  ('00000000-0000-0000-0000-0000000000b1'),  -- empresa A (alquiler)
  ('00000000-0000-0000-0000-0000000000c1'),  -- empresa B (decoración)
  ('00000000-0000-0000-0000-0000000000d1');  -- intruso sin workspace

insert into public.profiles(id, username, full_name) values ('00000000-0000-0000-0000-0000000000a1', 'admin_test', 'Admin Test');
insert into public.platform_admins(user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'owner');

-- ---------------------------------------------------------------------
-- 1. Solo un admin puede crear códigos
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$ begin
  perform public.admin_create_access_code('signup', (select id from public.plans where key = 'biz_inicial'));
  raise exception 'FALLO: un usuario sin rol de admin creó un código';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
insert into t_ctx select 'code_a', code from public.admin_create_access_code('signup',
  (select id from public.plans where key = 'biz_inicial'), null, array['rental'], 'Sillas Managua');
insert into t_ctx select 'code_b', code from public.admin_create_access_code('signup',
  (select id from public.plans where key = 'biz_profesional'), null, '{}', 'Deco Granada');
insert into t_ctx select 'code_renew_a', code from public.admin_create_access_code('renewal',
  (select id from public.plans where key = 'biz_inicial'), 60, '{}', 'Renovación A');
insert into t_ctx select 'code_renew_personal', code from public.admin_create_access_code('renewal',
  (select id from public.plans where key = 'personal_mensual'));

do $$ begin
  if exists (select 1 from public.access_codes where code_hash = (select v from t_ctx where k = 'code_a')) then
    raise exception 'FALLO: el código se guardó en claro';
  end if;
  if (select count(*) from public.access_codes) <> 4 then raise exception 'FALLO: admin no ve los códigos'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Alta de cuentas (como service_role, igual que la Edge Function)
-- ---------------------------------------------------------------------
reset role;
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.svc_check_code((select v from t_ctx where k = 'code_a'), 'ip:test');
  if not (r->>'ok')::boolean or r->>'kind' <> 'business' then raise exception 'FALLO check code_a: %', r; end if;

  r := public.svc_complete_signup((select v from t_ctx where k = 'code_a'), 'ip:test',
        '00000000-0000-0000-0000-0000000000b1', 'sillas_mga', 'Ana Pérez', '+50588888888', 'Sillas Managua', '{}');
  insert into t_ctx values ('ws_a', r->>'workspace_id');

  -- Reutilizar el código debe fallar
  begin
    perform public.svc_complete_signup((select v from t_ctx where k = 'code_a'), 'ip:test',
        '00000000-0000-0000-0000-0000000000d1', 'otro_user', 'Otro', null, 'Copia', '{}');
    raise exception 'FALLO: un código de un solo uso se usó dos veces';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%utilizado%' then raise; end if;
  end;

  -- Empresa B: más especialidades que las permitidas por el plan (2) → error
  begin
    perform public.svc_complete_signup((select v from t_ctx where k = 'code_b'), 'ip:test',
        '00000000-0000-0000-0000-0000000000c1', 'deco_gra', 'Luis Ruiz', null, 'Deco Granada',
        array['decoration','florist','catering']);
    raise exception 'FALLO: se aceptaron más especialidades que las del plan';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%especialidad%' then raise; end if;
  end;
  r := public.svc_complete_signup((select v from t_ctx where k = 'code_b'), 'ip:test',
        '00000000-0000-0000-0000-0000000000c1', 'deco_gra', 'Luis Ruiz', null, 'Deco Granada',
        array['decoration','florist','decoration']);
  insert into t_ctx values ('ws_b', r->>'workspace_id');
end $$;

-- Código inexistente: no lanza excepción y registra el intento
do $$
declare r jsonb; i int;
begin
  for i in 1..8 loop
    r := public.svc_check_code('E360-AAAA-AAAA-AAAA-AAAA', 'ip:atacante');
    if (r->>'ok')::boolean then raise exception 'FALLO: código falso aceptado'; end if;
  end loop;
  r := public.svc_check_code((select v from t_ctx where k = 'code_renew_a'), 'ip:atacante');
  if r->>'error' <> 'too_many_attempts' then raise exception 'FALLO: no se bloqueó la fuerza bruta: %', r; end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Aislamiento entre tenants
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$ begin
  if (select count(*) from public.workspaces) <> 1 then raise exception 'FALLO: A ve workspaces ajenos'; end if;
  if exists (select 1 from public.workspaces where id = (select v::uuid from t_ctx where k = 'ws_b')) then
    raise exception 'FALLO: A puede leer el workspace de B';
  end if;
  if (select count(*) from public.subscriptions) <> 1 then raise exception 'FALLO: A ve suscripciones ajenas'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FALLO: A ve perfiles ajenos'; end if;
  if (select count(*) from public.access_codes) <> 0 then raise exception 'FALLO: un cliente ve códigos'; end if;
  if (select count(*) from public.my_workspaces()) <> 1 then raise exception 'FALLO: my_workspaces'; end if;
end $$;

-- A intenta modificar el workspace de B manipulando el id → 0 filas
update public.workspaces set name = 'hackeado' where id = (select v::uuid from t_ctx where k = 'ws_b');
do $$ begin
  begin
    perform public.workspace_modules_for((select v::uuid from t_ctx where k = 'ws_b'));
    raise exception 'FALLO: A consultó módulos de B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_extend_subscription((select v::uuid from t_ctx where k = 'ws_a'), 365);
    raise exception 'FALLO: un cliente extendió su propia suscripción';
  exception when insufficient_privilege then null; end;
  begin
    perform public.redeem_renewal_code((select v::uuid from t_ctx where k = 'ws_b'), (select v from t_ctx where k = 'code_renew_a'));
    raise exception 'FALLO: A renovó el workspace de B';
  exception when insufficient_privilege then null; end;
end $$;

-- Campos protegidos: un usuario no puede cambiar la modalidad ni desbloquearse
do $$ begin
  begin
    update public.workspaces set kind = 'personal' where id = (select v::uuid from t_ctx where k = 'ws_a');
    raise exception 'FALLO: se pudo modificar kind';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set is_disabled = false where id = '00000000-0000-0000-0000-0000000000b1';
    raise exception 'FALLO: se pudo modificar is_disabled';
  exception when insufficient_privilege then null; end;
end $$;

-- Módulos según especialidad: alquiler sí ve inventario, no ve menús
do $$ begin
  if not exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k = 'ws_a')) where module_key = 'inventory') then
    raise exception 'FALLO: alquiler no tiene inventario';
  end if;
  if exists (select 1 from public.workspace_modules_for((select v::uuid from t_ctx where k = 'ws_a')) where module_key in ('menus','installations','guests')) then
    raise exception 'FALLO: alquiler ve módulos de otra especialidad';
  end if;
end $$;

-- Renovación: código de otra modalidad es rechazado; el correcto suma días
do $$
declare r jsonb; v_before timestamptz; v_after timestamptz;
begin
  r := public.redeem_renewal_code((select v::uuid from t_ctx where k = 'ws_a'), (select v from t_ctx where k = 'code_renew_personal'));
  if (r->>'ok')::boolean then raise exception 'FALLO: se aceptó código de otra modalidad'; end if;
  select current_period_end into v_before from public.subscriptions;
  r := public.redeem_renewal_code((select v::uuid from t_ctx where k = 'ws_a'), lower((select v from t_ctx where k = 'code_renew_a')));
  if not (r->>'ok')::boolean then raise exception 'FALLO renovación: %', r; end if;
  select current_period_end into v_after from public.subscriptions;
  if v_after - v_before < interval '59 days' then raise exception 'FALLO: no se sumaron 60 días'; end if;
end $$;

-- Intruso autenticado sin workspace no ve nada
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$ begin
  if (select count(*) from public.workspaces) + (select count(*) from public.subscriptions)
     + (select count(*) from public.workspace_members) + (select count(*) from public.manual_payments) <> 0 then
    raise exception 'FALLO: intruso ve datos';
  end if;
end $$;

-- B ve sus especialidades (decoración principal + floristería) y la etiqueta especializada
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$ begin
  if (select count(*) from public.workspace_specialties) <> 2 then raise exception 'FALLO: especialidades de B'; end if;
  if (select label from public.workspace_modules_for((select v::uuid from t_ctx where k = 'ws_b')) where module_key = 'catalog') <> 'Decoraciones' then
    raise exception 'FALLO: etiqueta de módulo especializada';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Vencimientos: past_due → suspended → solo lectura
-- ---------------------------------------------------------------------
reset role;
do $$ begin
  if (select name from public.workspaces where id = (select v::uuid from t_ctx where k = 'ws_b')) <> 'Deco Granada' then
    raise exception 'FALLO: A modificó el workspace de B';
  end if;
end $$;
update public.subscriptions set current_period_start = now() - interval '40 days', current_period_end = now() - interval '1 day'
  where workspace_id = (select v::uuid from t_ctx where k = 'ws_b');
select private.refresh_subscription_statuses();
do $$ begin
  if (select status from public.subscriptions where workspace_id = (select v::uuid from t_ctx where k = 'ws_b')) <> 'past_due' then
    raise exception 'FALLO: no pasó a past_due';
  end if;
  if not private.ws_is_writable((select v::uuid from t_ctx where k = 'ws_b')) then raise exception 'FALLO: gracia no permite escribir'; end if;
end $$;
update public.subscriptions set current_period_end = now() - interval '10 days'
  where workspace_id = (select v::uuid from t_ctx where k = 'ws_b');
select private.refresh_subscription_statuses();
do $$ begin
  if (select status from public.subscriptions where workspace_id = (select v::uuid from t_ctx where k = 'ws_b')) <> 'suspended' then
    raise exception 'FALLO: no pasó a suspended';
  end if;
  if private.ws_is_writable((select v::uuid from t_ctx where k = 'ws_b')) then raise exception 'FALLO: suspendido puede escribir'; end if;
end $$;

-- Límite de plan
do $$ begin
  perform private.enforce_limit((select v::uuid from t_ctx where k = 'ws_a'), 'venues.max', 1);  -- límite 2: ok
  begin
    perform private.enforce_limit((select v::uuid from t_ctx where k = 'ws_a'), 'venues.max', 2);
    raise exception 'FALLO: no se aplicó el límite';
  exception when sqlstate 'P0001' then if sqlerrm not like '%límite%' then raise; end if; end;
  begin
    perform private.enforce_limit((select v::uuid from t_ctx where k = 'ws_a'), 'automations', 0);
    raise exception 'FALLO: funcionalidad fuera del plan permitida';
  exception when sqlstate 'P0001' then null; end;
end $$;

-- Anon: solo catálogo público
set local role anon;
do $$ begin
  if (select count(*) from public.plans) <> 7 then raise exception 'FALLO: anon no ve planes públicos'; end if;
  begin
    perform count(*) from public.workspaces;
    raise exception 'FALLO: anon puede consultar workspaces';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'TODAS LAS PRUEBAS PASARON' as resultado;
rollback;
