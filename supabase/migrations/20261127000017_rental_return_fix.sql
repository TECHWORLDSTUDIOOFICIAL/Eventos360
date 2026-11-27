-- Devolución con varios artículos: al registrar la revisión no se vuelve a validar
-- existencias (los daños recién enviados a mantenimiento no deben bloquear el cierre).
-- La validación de inventario solo corre cuando cambia la cantidad o el artículo.
create or replace function private.rental_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.rentals set updated_at = now() where id = coalesce(new.rental_id, old.rental_id);   -- recalcula totales
  if tg_op <> 'DELETE' and new.resource_id is not null
     and coalesce(current_setting('eventos360.returning', true) = 'on', false) = false
     and (tg_op = 'INSERT' or new.quantity <> old.quantity or new.resource_id is distinct from old.resource_id) then
    perform private.check_rental_stock(new.rental_id);
  end if;
  return null;
end $$;
