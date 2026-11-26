-- =====================================================================
-- Eventos360 · Etapa 2 · Núcleo de eventos (Personal; reutilizable por
-- Profesional y Business). Todas las tablas pertenecen a un workspace.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Escritura protegida por rol + suscripción + módulo habilitado
-- ---------------------------------------------------------------------
create or replace function private.can_write_module(p_ws uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_write(p_ws) and private.ws_has_module(p_ws, p_module);
$$;
grant execute on function private.can_write_module(uuid, text) to authenticated;

-- Token aleatorio URL-safe (para enlaces de invitación).
create or replace function private.random_token(p_bytes int default 16)
returns text language sql volatile set search_path = '' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '='), '+/', '-_');
$$;

-- ---------------------------------------------------------------------
-- Eventos
-- ---------------------------------------------------------------------
create table public.events (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  name           text not null check (char_length(name) between 2 and 120),
  category       text not null default 'otro' check (category in
                   ('boda','quinceanos','cumpleanos','graduacion','aniversario','bautizo','baby_shower','despedida','corporativo','fiesta','otro')),
  honorees       text check (char_length(honorees) <= 200),      -- nombre(s) del/los festejado(s)
  starts_at      timestamptz,
  ends_at        timestamptz,
  venue_name     text check (char_length(venue_name) <= 160),
  venue_address  text check (char_length(venue_address) <= 300),
  venue_map_url  text check (venue_map_url is null or venue_map_url ~* '^https://'),
  budget         numeric(14,2) not null default 0 check (budget >= 0),
  currency_code  char(3) not null default 'NIO' references public.currencies(code),
  description    text check (char_length(description) <= 4000),
  cover_path     text,
  status         text not null default 'planning' check (status in ('planning','confirmed','done','canceled')),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index events_ws_idx on public.events(workspace_id, starts_at);
create trigger events_touch before update on public.events for each row execute function private.touch_updated_at();

create or replace function private.events_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enforce_limit(new.workspace_id, 'events.max',
    (select count(*) from public.events where workspace_id = new.workspace_id));
  return new;
end $$;
create trigger events_limit before insert on public.events for each row execute function private.events_limit();

-- ---------------------------------------------------------------------
-- Invitados
-- ---------------------------------------------------------------------
create table public.guest_groups (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id     uuid not null,
  name         text not null check (char_length(name) between 1 and 80),
  created_at   timestamptz not null default now(),
  unique (workspace_id, id),
  unique (event_id, name),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade
);

create table public.event_tables (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id     uuid not null,
  name         text not null check (char_length(name) between 1 and 60),
  capacity     int not null default 10 check (capacity between 1 and 100),
  shape        text not null default 'round' check (shape in ('round','rect')),
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade
);

create table public.guests (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  event_id       uuid not null,
  group_id       uuid,
  table_id       uuid,
  first_name     text not null check (char_length(first_name) between 1 and 80),
  last_name      text check (char_length(last_name) <= 80),
  phone          text check (char_length(phone) <= 30),
  email          text check (char_length(email) <= 160),
  max_companions int not null default 0 check (max_companions between 0 and 20),  -- acompañantes permitidos
  adults         int not null default 1 check (adults between 0 and 21),          -- personas confirmadas (incluye al invitado)
  children       int not null default 0 check (children between 0 and 20),
  status         text not null default 'pending' check (status in ('pending','invited','confirmed','declined')),
  notes          text check (char_length(notes) <= 1000),
  invite_token   text not null unique default private.random_token(16),
  rsvp_message   text check (char_length(rsvp_message) <= 500),
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  check (adults + children <= max_companions + 1),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade,
  foreign key (workspace_id, group_id) references public.guest_groups(workspace_id, id) on delete set null (group_id),
  foreign key (workspace_id, table_id) references public.event_tables(workspace_id, id) on delete set null (table_id)
);
create index guests_event_idx on public.guests(event_id, last_name, first_name);
create index guests_table_idx on public.guests(table_id) where table_id is not null;
create trigger guests_touch before update on public.guests for each row execute function private.touch_updated_at();

-- Límite de invitados por evento (plan) y coherencia de evento entre grupo/mesa.
create or replace function private.guests_checks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_used int; v_cap int;
begin
  if tg_op = 'INSERT' then
    perform private.enforce_limit(new.workspace_id, 'guests.max',
      (select count(*) from public.guests where event_id = new.event_id));
  end if;
  if new.group_id is not null and not exists (select 1 from public.guest_groups where id = new.group_id and event_id = new.event_id) then
    raise exception 'El grupo no pertenece a este evento' using errcode = 'P0001';
  end if;
  if new.table_id is not null then
    select capacity into v_cap from public.event_tables where id = new.table_id and event_id = new.event_id;
    if v_cap is null then raise exception 'La mesa no pertenece a este evento' using errcode = 'P0001'; end if;
    select coalesce(sum(greatest(adults, 1) + children), 0) into v_used
      from public.guests where table_id = new.table_id and id <> new.id and status <> 'declined';
    if new.status <> 'declined' and v_used + greatest(new.adults, 1) + new.children > v_cap then
      raise exception 'La mesa no tiene espacio suficiente (% de % lugares ocupados)', v_used, v_cap using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger guests_checks before insert or update on public.guests for each row execute function private.guests_checks();

-- ---------------------------------------------------------------------
-- Invitación digital (un diseño por evento)
-- ---------------------------------------------------------------------
create table public.invitations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  event_id       uuid not null unique,
  template       text not null default 'elegante' check (template in ('elegante','floral','moderno','fiesta')),
  accent_color   text not null default '#b9802a' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  title          text check (char_length(title) <= 120),
  message        text check (char_length(message) <= 1500),
  dress_code     text check (char_length(dress_code) <= 120),
  rsvp_deadline  date,
  is_published   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade
);
create trigger invitations_touch before update on public.invitations for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Proveedores (por workspace) y presupuesto (por evento)
-- ---------------------------------------------------------------------
create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  service_type  text check (char_length(service_type) <= 80),
  contact_name  text check (char_length(contact_name) <= 120),
  phone         text check (char_length(phone) <= 30),
  email         text check (char_length(email) <= 160),
  notes         text check (char_length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id)
);
create index suppliers_ws_idx on public.suppliers(workspace_id, name);
create trigger suppliers_touch before update on public.suppliers for each row execute function private.touch_updated_at();

create table public.event_expenses (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  event_id        uuid not null,
  supplier_id     uuid,
  category        text not null default 'otros' check (category in
                    ('lugar','comida','bebidas','decoracion','vestuario','musica','fotografia','invitaciones','pastel','flores','transporte','mobiliario','recuerdos','otros')),
  concept         text not null check (char_length(concept) between 1 and 160),
  planned_amount  numeric(14,2) not null default 0 check (planned_amount >= 0),   -- estimado
  agreed_amount   numeric(14,2) check (agreed_amount >= 0),                        -- costo acordado / cotizado
  paid_amount     numeric(14,2) not null default 0 check (paid_amount >= 0),      -- pagado (incluye anticipos)
  due_date        date,
  notes           text check (char_length(notes) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade,
  foreign key (workspace_id, supplier_id) references public.suppliers(workspace_id, id) on delete set null (supplier_id)
);
create index event_expenses_event_idx on public.event_expenses(event_id);
create trigger event_expenses_touch before update on public.event_expenses for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Cronograma, tareas e inspiración
-- ---------------------------------------------------------------------
create table public.event_schedule_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  event_id      uuid not null,
  start_time    time not null,
  duration_min  int check (duration_min between 1 and 1440),
  title         text not null check (char_length(title) between 1 and 120),
  responsible   text check (char_length(responsible) <= 120),
  notes         text check (char_length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade
);
create index event_schedule_event_idx on public.event_schedule_items(event_id, start_time);

create table public.event_tasks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  event_id      uuid not null,
  title         text not null check (char_length(title) between 1 and 160),
  description   text check (char_length(description) <= 2000),
  due_date      date,
  priority      text not null default 'medium' check (priority in ('low','medium','high')),
  status        text not null default 'todo' check (status in ('todo','doing','done')),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade
);
create index event_tasks_event_idx on public.event_tasks(event_id, status, due_date);
create trigger event_tasks_touch before update on public.event_tasks for each row execute function private.touch_updated_at();

create or replace function private.task_completed_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.completed_at := now();
  elsif new.status <> 'done' then new.completed_at := null;
  end if;
  return new;
end $$;
create trigger event_tasks_done before insert or update on public.event_tasks for each row execute function private.task_completed_at();

create table public.inspiration_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  event_id      uuid not null,
  kind          text not null check (kind in ('image','palette','note')),
  title         text check (char_length(title) <= 120),
  image_path    text,
  colors        text[] not null default '{}' check (cardinality(colors) <= 8),
  note          text check (char_length(note) <= 2000),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade
);
create index inspiration_event_idx on public.inspiration_items(event_id, created_at desc);

-- =====================================================================
-- RLS: lectura para miembros; escritura con rol + suscripción + módulo
-- =====================================================================
do $$
declare
  t record;
begin
  for t in select * from (values
    ('events', 'my_event'),
    ('guest_groups', 'guests'),
    ('guests', 'guests'),
    ('event_tables', 'seating'),
    ('invitations', 'invitations'),
    ('suppliers', 'suppliers'),
    ('event_expenses', 'budget'),
    ('event_schedule_items', 'schedule'),
    ('event_tasks', 'tasks'),
    ('inspiration_items', 'inspiration')
  ) as x(tbl, module)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('revoke all on public.%I from anon', t.tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.tbl);
    execute format($p$create policy "miembros leen" on public.%I for select to authenticated
                     using (workspace_id in (select private.user_workspace_ids()))$p$, t.tbl);
    execute format($p$create policy "miembros crean" on public.%I for insert to authenticated
                     with check (private.can_write_module(workspace_id, %L))$p$, t.tbl, t.module);
    execute format($p$create policy "miembros editan" on public.%I for update to authenticated
                     using (private.can_write_module(workspace_id, %L)) with check (private.can_write_module(workspace_id, %L))$p$, t.tbl, t.module, t.module);
    execute format($p$create policy "miembros eliminan" on public.%I for delete to authenticated
                     using (private.can_write_module(workspace_id, %L))$p$, t.tbl, t.module);
  end loop;
end $$;

-- Las mesas también se asignan desde Invitados y viceversa: escribir un invitado basta con el módulo "guests";
-- modificar mesas requiere "seating". Eventos de Profesional/Business usan el módulo "events".
drop policy "miembros crean" on public.events;
drop policy "miembros editan" on public.events;
drop policy "miembros eliminan" on public.events;
create policy "miembros crean" on public.events for insert to authenticated
  with check (private.can_write_module(workspace_id, 'my_event') or private.can_write_module(workspace_id, 'events'));
create policy "miembros editan" on public.events for update to authenticated
  using (private.can_write_module(workspace_id, 'my_event') or private.can_write_module(workspace_id, 'events'))
  with check (private.can_write_module(workspace_id, 'my_event') or private.can_write_module(workspace_id, 'events'));
create policy "miembros eliminan" on public.events for delete to authenticated
  using (private.can_write_module(workspace_id, 'my_event') or private.can_write_module(workspace_id, 'events'));

-- El token de invitación y la respuesta del invitado no se pueden fijar desde el panel
-- (un permiso de columna no anula uno de tabla: se otorgan columna por columna).
revoke insert, update on public.guests from authenticated;
grant insert (workspace_id, event_id, group_id, table_id, first_name, last_name, phone, email, max_companions,
              adults, children, status, notes) on public.guests to authenticated;
grant update (group_id, table_id, first_name, last_name, phone, email, max_companions,
              adults, children, status, notes) on public.guests to authenticated;
-- Regenerar el enlace de un invitado (por si se compartió por error).
create or replace function public.regenerate_invite_token(p_guest_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_token text;
begin
  select workspace_id into v_ws from public.guests where id = p_guest_id;
  if v_ws is null or not private.can_write_module(v_ws, 'guests') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_token := private.random_token(16);
  update public.guests set invite_token = v_token where id = p_guest_id;
  return v_token;
end $$;
revoke execute on function public.regenerate_invite_token(uuid) from public, anon;
grant execute on function public.regenerate_invite_token(uuid) to authenticated;

-- =====================================================================
-- Resumen para el panel (SECURITY INVOKER: respeta RLS)
-- =====================================================================
create or replace function public.event_summary(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'guests_total',      (select count(*) from public.guests g where g.event_id = p_event_id),
    'guests_confirmed',  (select count(*) from public.guests g where g.event_id = p_event_id and g.status = 'confirmed'),
    'guests_declined',   (select count(*) from public.guests g where g.event_id = p_event_id and g.status = 'declined'),
    'guests_pending',    (select count(*) from public.guests g where g.event_id = p_event_id and g.status in ('pending','invited')),
    'people_confirmed',  (select coalesce(sum(g.adults + g.children), 0) from public.guests g where g.event_id = p_event_id and g.status = 'confirmed'),
    'adults_confirmed',  (select coalesce(sum(g.adults), 0) from public.guests g where g.event_id = p_event_id and g.status = 'confirmed'),
    'children_confirmed',(select coalesce(sum(g.children), 0) from public.guests g where g.event_id = p_event_id and g.status = 'confirmed'),
    'people_invited',    (select coalesce(sum(g.max_companions + 1), 0) from public.guests g where g.event_id = p_event_id and g.status <> 'declined'),
    'planned_total',     (select coalesce(sum(x.planned_amount), 0) from public.event_expenses x where x.event_id = p_event_id),
    'committed_total',   (select coalesce(sum(coalesce(x.agreed_amount, x.planned_amount)), 0) from public.event_expenses x where x.event_id = p_event_id),
    'paid_total',        (select coalesce(sum(x.paid_amount), 0) from public.event_expenses x where x.event_id = p_event_id),
    'tasks_total',       (select count(*) from public.event_tasks t where t.event_id = p_event_id),
    'tasks_done',        (select count(*) from public.event_tasks t where t.event_id = p_event_id and t.status = 'done'),
    'tasks_overdue',     (select count(*) from public.event_tasks t where t.event_id = p_event_id and t.status <> 'done' and t.due_date < current_date),
    'tables_total',      (select count(*) from public.event_tables t where t.event_id = p_event_id),
    'seats_total',       (select coalesce(sum(t.capacity), 0) from public.event_tables t where t.event_id = p_event_id),
    'seated_people',     (select coalesce(sum(greatest(g.adults, 1) + g.children), 0) from public.guests g where g.event_id = p_event_id and g.table_id is not null and g.status <> 'declined')
  );
$$;
revoke execute on function public.event_summary(uuid) from public, anon;
grant execute on function public.event_summary(uuid) to authenticated;

-- =====================================================================
-- Invitación pública y confirmación de asistencia (sin cuenta)
-- Solo expone los datos del evento y del propio invitado del token.
-- =====================================================================
create or replace function public.public_invitation(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 64 then return null; end if;
  select jsonb_build_object(
    'guest', jsonb_build_object('first_name', g.first_name, 'last_name', g.last_name, 'max_companions', g.max_companions,
                                'status', g.status, 'adults', g.adults, 'children', g.children, 'rsvp_message', g.rsvp_message,
                                'responded_at', g.responded_at),
    'event', jsonb_build_object('name', e.name, 'category', e.category, 'honorees', e.honorees, 'starts_at', e.starts_at,
                                'ends_at', e.ends_at, 'venue_name', e.venue_name, 'venue_address', e.venue_address,
                                'venue_map_url', e.venue_map_url, 'cover_path', e.cover_path, 'timezone', w.timezone, 'locale', w.locale),
    'invitation', jsonb_build_object('template', i.template, 'accent_color', i.accent_color, 'title', i.title, 'message', i.message,
                                     'dress_code', i.dress_code, 'rsvp_deadline', i.rsvp_deadline,
                                     'rsvp_open', (i.rsvp_deadline is null or i.rsvp_deadline >= (now() at time zone w.timezone)::date)
                                                  and e.status not in ('canceled','done'))
  ) into v
  from public.guests g
  join public.events e on e.id = g.event_id
  join public.workspaces w on w.id = g.workspace_id
  join public.invitations i on i.event_id = e.id
  where g.invite_token = p_token and i.is_published and not w.is_disabled
    and exists (select 1 from public.subscriptions s where s.workspace_id = w.id and s.status in ('trialing','active','past_due'));
  return v;
end $$;

create or replace function public.public_rsvp(p_token text, p_attending boolean, p_adults int default 1, p_children int default 0, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.guests; v_open boolean;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 64 then
    raise exception 'Invitación no válida' using errcode = 'P0001';
  end if;
  if private.attempts_exceeded('rsvp:' || p_token, 15, interval '1 hour') then
    raise exception 'Demasiados cambios en poco tiempo. Inténtalo más tarde.' using errcode = 'P0001';
  end if;
  select gg.* into g from public.guests gg
    join public.invitations i on i.event_id = gg.event_id
    join public.events e on e.id = gg.event_id
    join public.workspaces w on w.id = gg.workspace_id
  where gg.invite_token = p_token and i.is_published and not w.is_disabled
    and e.status not in ('canceled','done')
    and (i.rsvp_deadline is null or i.rsvp_deadline >= (now() at time zone w.timezone)::date)
    and exists (select 1 from public.subscriptions s where s.workspace_id = w.id and s.status in ('trialing','active','past_due'))
  for update of gg;
  if g.id is null then
    raise exception 'La confirmación no está disponible para esta invitación' using errcode = 'P0001';
  end if;
  if p_attending then
    if coalesce(p_adults, 0) < 1 then raise exception 'Indica al menos 1 adulto' using errcode = 'P0001'; end if;
    if coalesce(p_adults, 0) + coalesce(p_children, 0) > g.max_companions + 1 then
      raise exception 'Tu invitación es para un máximo de % persona(s)', g.max_companions + 1 using errcode = 'P0001';
    end if;
  end if;
  update public.guests
     set status = case when p_attending then 'confirmed' else 'declined' end,
         adults = case when p_attending then p_adults else 1 end,
         children = case when p_attending then coalesce(p_children, 0) else 0 end,
         rsvp_message = nullif(left(trim(coalesce(p_message, '')), 500), ''),
         responded_at = now()
   where id = g.id;
  perform private.log_attempt('rsvp:' || p_token, false);  -- cuenta los cambios para el límite
  return jsonb_build_object('ok', true, 'status', case when p_attending then 'confirmed' else 'declined' end);
end $$;

revoke execute on function public.public_invitation(text), public.public_rsvp(text, boolean, int, int, text) from public;
grant execute on function public.public_invitation(text), public.public_rsvp(text, boolean, int, int, text) to anon, authenticated;

-- =====================================================================
-- Almacenamiento
--  · event-media  (público, solo portadas de eventos: se muestran en la invitación)
--  · workspace-files (privado: inspiración y documentos)
-- Ruta obligatoria: <workspace_id>/<...>
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('event-media', 'event-media', true, 3145728, array['image/jpeg','image/png','image/webp']),
  ('workspace-files', 'workspace-files', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create or replace function private.storage_ws(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.storage_ws(text) to authenticated;

create policy "e360 miembros leen archivos" on storage.objects for select to authenticated
  using (bucket_id in ('event-media','workspace-files') and private.storage_ws(name) in (select private.user_workspace_ids()));
create policy "e360 miembros suben archivos" on storage.objects for insert to authenticated
  with check (bucket_id in ('event-media','workspace-files') and private.can_write(private.storage_ws(name)));
create policy "e360 miembros actualizan archivos" on storage.objects for update to authenticated
  using (bucket_id in ('event-media','workspace-files') and private.can_write(private.storage_ws(name)))
  with check (bucket_id in ('event-media','workspace-files') and private.can_write(private.storage_ws(name)));
create policy "e360 miembros eliminan archivos" on storage.objects for delete to authenticated
  using (bucket_id in ('event-media','workspace-files') and private.can_write(private.storage_ws(name)));
