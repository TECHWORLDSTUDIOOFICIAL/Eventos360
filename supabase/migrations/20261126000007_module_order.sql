-- Reportes y Equipo siempre al final de la navegación.
update public.modules set sort = 9000 where key = 'reports';
update public.modules set sort = 9100 where key = 'team';
