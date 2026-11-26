-- Lugares que ocupa un invitado en una mesa: si confirmó, las personas confirmadas;
-- si no ha respondido, el máximo de su invitación (reserva el espacio). Los que no asistirán no ocupan.
create or replace function private.guest_seats(p_status text, p_adults int, p_children int, p_max_companions int)
returns int language sql immutable set search_path = '' as $$
  select case p_status when 'declined' then 0
                       when 'confirmed' then greatest(p_adults, 1) + p_children
                       else p_max_companions + 1 end;
$$;
grant execute on function private.guest_seats(text, int, int, int) to authenticated;

create or replace function private.guests_checks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_used int; v_cap int; v_need int;
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
    -- Serializa asignaciones simultáneas a la misma mesa.
    perform 1 from public.event_tables where id = new.table_id for update;
    select coalesce(sum(private.guest_seats(status, adults, children, max_companions)), 0) into v_used
      from public.guests where table_id = new.table_id and id <> new.id;
    v_need := private.guest_seats(new.status, new.adults, new.children, new.max_companions);
    if v_need > 0 and v_used + v_need > v_cap then
      raise exception 'La mesa no tiene espacio suficiente (% de % lugares ocupados, se necesitan %)', v_used, v_cap, v_need using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- Reducir la capacidad de una mesa por debajo de lo ya asignado no está permitido.
create or replace function private.tables_capacity_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_used int;
begin
  select coalesce(sum(private.guest_seats(status, adults, children, max_companions)), 0) into v_used
    from public.guests where table_id = new.id;
  if v_used > new.capacity then
    raise exception 'La mesa ya tiene % lugares ocupados; quita invitados antes de reducir su capacidad', v_used using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger event_tables_capacity before update of capacity on public.event_tables
  for each row execute function private.tables_capacity_check();
