-- Integridad: cotizaciones, contratos, pagos y seguimiento pertenecen directamente al workspace
-- (se eliminan en cascada si se elimina el espacio). Eliminar un CLIENTE con documentos sigue
-- bloqueado (NO ACTION se evalúa al final de la sentencia, por eso no impide la cascada del espacio).
alter table public.quotes add constraint quotes_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.quote_items add constraint quote_items_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.contracts add constraint contracts_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.customer_payments add constraint customer_payments_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.customer_activities add constraint customer_activities_ws_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.quotes drop constraint quotes_workspace_id_customer_id_fkey,
  add constraint quotes_customer_fk foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete no action;
alter table public.contracts drop constraint contracts_workspace_id_customer_id_fkey,
  add constraint contracts_customer_fk foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete no action;
alter table public.customer_payments drop constraint customer_payments_workspace_id_customer_id_fkey,
  add constraint customer_payments_customer_fk foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete no action;
