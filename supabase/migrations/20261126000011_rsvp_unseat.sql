-- La confirmación del invitado nunca debe fallar por falta de espacio en su mesa:
-- si al confirmar ya no cabe (o si declina), queda sin mesa para que el anfitrión lo reubique.
create or replace function public.public_rsvp(p_token text, p_attending boolean, p_adults int default 1, p_children int default 0, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.guests; v_table uuid; v_cap int; v_used int;
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

  v_table := g.table_id;
  if not p_attending then
    v_table := null;
  elsif v_table is not null then
    select capacity into v_cap from public.event_tables where id = v_table for update;
    select coalesce(sum(private.guest_seats(status, adults, children, max_companions)), 0) into v_used
      from public.guests where table_id = v_table and id <> g.id;
    if v_used + p_adults + coalesce(p_children, 0) > v_cap then v_table := null; end if;
  end if;

  update public.guests
     set status = case when p_attending then 'confirmed' else 'declined' end,
         adults = case when p_attending then p_adults else 1 end,
         children = case when p_attending then coalesce(p_children, 0) else 0 end,
         table_id = v_table,
         rsvp_message = nullif(left(trim(coalesce(p_message, '')), 500), ''),
         responded_at = now()
   where id = g.id;
  perform private.log_attempt('rsvp:' || p_token, false);
  return jsonb_build_object('ok', true, 'status', case when p_attending then 'confirmed' else 'declined' end);
end $$;
