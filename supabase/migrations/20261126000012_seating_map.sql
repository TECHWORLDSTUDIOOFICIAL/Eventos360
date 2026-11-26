-- =====================================================================
-- Eventos360 · Mapa de mesas: posición de cada mesa y elementos del salón
-- Coordenadas en porcentaje del plano (0–100) para que se adapte a cualquier pantalla o papel.
-- =====================================================================
alter table public.event_tables
  add column pos_x numeric(5,2) check (pos_x between 0 and 100),
  add column pos_y numeric(5,2) check (pos_y between 0 and 100);

create table public.event_map_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id     uuid not null,
  kind         text not null check (kind in ('stage','dance','entrance','buffet','bar','head','dj','cake','photo','other')),
  label        text check (char_length(label) <= 40),
  pos_x        numeric(5,2) not null default 50 check (pos_x between 0 and 100),
  pos_y        numeric(5,2) not null default 50 check (pos_y between 0 and 100),
  width        numeric(5,2) not null default 18 check (width between 3 and 100),
  height       numeric(5,2) not null default 10 check (height between 3 and 100),
  created_at   timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete cascade
);
create index event_map_items_event_idx on public.event_map_items(event_id);

alter table public.event_map_items enable row level security;
revoke all on public.event_map_items from anon;
grant select, insert, update, delete on public.event_map_items to authenticated;
create policy "miembros leen" on public.event_map_items for select to authenticated
  using (workspace_id in (select private.user_workspace_ids()));
create policy "miembros crean" on public.event_map_items for insert to authenticated
  with check (private.can_write_module(workspace_id, 'seating'));
create policy "miembros editan" on public.event_map_items for update to authenticated
  using (private.can_write_module(workspace_id, 'seating')) with check (private.can_write_module(workspace_id, 'seating'));
create policy "miembros eliminan" on public.event_map_items for delete to authenticated
  using (private.can_write_module(workspace_id, 'seating'));
