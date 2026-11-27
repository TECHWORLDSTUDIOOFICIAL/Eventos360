-- =====================================================================
-- Eventos360 · Etapa 3 · Profesional (reutilizable por Business)
-- Clientes (CRM), cotizaciones, contratos, pagos recibidos, agenda y
-- datos del negocio para documentos. Todo aislado por workspace.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Datos del negocio (encabezado de cotizaciones y contratos)
-- ---------------------------------------------------------------------
alter table public.workspaces
  add column legal_name    text check (char_length(legal_name) <= 160),
  add column tax_id        text check (char_length(tax_id) <= 40),
  add column contact_phone text check (char_length(contact_phone) <= 40),
  add column contact_email text check (char_length(contact_email) <= 160),
  add column address       text check (char_length(address) <= 300),
  add column logo_path     text;
grant update (legal_name, tax_id, contact_phone, contact_email, address, logo_path) on public.workspaces to authenticated;

-- Numeración correlativa por workspace (COT-0001, CON-0001…)
create table public.workspace_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  value        int not null default 0,
  primary key (workspace_id, key)
);
alter table public.workspace_counters enable row level security;   -- sin políticas: solo vía funciones

create or replace function private.next_number(p_ws uuid, p_key text)
returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  insert into public.workspace_counters(workspace_id, key, value) values (p_ws, p_key, 1)
  on conflict (workspace_id, key) do update set value = public.workspace_counters.value + 1
  returning value into v;
  return v;
end $$;
revoke execute on function private.next_number(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Clientes (CRM)
-- ---------------------------------------------------------------------
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  kind          text not null default 'person' check (kind in ('person','company')),
  name          text not null check (char_length(name) between 2 and 160),
  contact_name  text check (char_length(contact_name) <= 120),
  phone         text check (char_length(phone) <= 40),
  email         text check (char_length(email) <= 160),
  tax_id        text check (char_length(tax_id) <= 40),
  address       text check (char_length(address) <= 300),
  source        text check (char_length(source) <= 60),
  status        text not null default 'lead' check (status in ('lead','active','inactive')),
  notes         text check (char_length(notes) <= 4000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id)
);
create index customers_ws_idx on public.customers(workspace_id, name);
create trigger customers_touch before update on public.customers for each row execute function private.touch_updated_at();

create or replace function private.customers_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enforce_limit(new.workspace_id, 'customers.max',
    (select count(*) from public.customers where workspace_id = new.workspace_id));
  return new;
end $$;
create trigger customers_limit before insert on public.customers for each row execute function private.customers_limit();

-- Seguimiento comercial: notas, llamadas, reuniones, recordatorios
create table public.customer_activities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  customer_id   uuid not null,
  kind          text not null default 'note' check (kind in ('note','call','whatsapp','meeting','email','visit')),
  body          text not null check (char_length(body) between 1 and 4000),
  follow_up_on  date,
  done          boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete cascade
);
create index customer_activities_idx on public.customer_activities(customer_id, created_at desc);
create index customer_followups_idx on public.customer_activities(workspace_id, follow_up_on) where not done and follow_up_on is not null;

-- Eventos de clientes (Profesional / Business)
alter table public.events
  add column customer_id     uuid,
  add column guests_estimate int check (guests_estimate between 0 and 100000),
  add constraint events_customer_fk foreign key (workspace_id, customer_id)
      references public.customers(workspace_id, id) on delete set null (customer_id);
create index events_customer_idx on public.events(customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------
-- Cotizaciones
-- ---------------------------------------------------------------------
create table public.quotes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  number          int not null,
  customer_id     uuid not null,
  event_id        uuid,
  title           text not null check (char_length(title) between 2 and 160),
  status          text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired')),
  issue_date      date not null default current_date,
  valid_until     date,
  currency_code   char(3) not null default 'NIO' references public.currencies(code),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),  -- descuento global
  tax_rate        numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  deposit_pct     numeric(5,2) not null default 0 check (deposit_pct between 0 and 100),  -- anticipo requerido
  subtotal        numeric(14,2) not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  terms           text check (char_length(terms) <= 6000),
  notes           text check (char_length(notes) <= 2000),
  public_token    text not null unique default private.random_token(18),
  accepted_at     timestamptz,
  accepted_name   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id)
);
create index quotes_ws_idx on public.quotes(workspace_id, created_at desc);
create index quotes_event_idx on public.quotes(event_id) where event_id is not null;
create trigger quotes_touch before update on public.quotes for each row execute function private.touch_updated_at();

create table public.quote_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  quote_id      uuid not null,
  sort          int not null default 0,
  description   text not null check (char_length(description) between 1 and 500),
  quantity      numeric(12,2) not null default 1 check (quantity > 0),
  unit_price    numeric(14,2) not null default 0 check (unit_price >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  line_total    numeric(14,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  unique (workspace_id, id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete cascade
);
create index quote_items_quote_idx on public.quote_items(quote_id, sort);

-- Número correlativo y cálculo de totales (en el servidor: el cliente no puede alterarlos)
create or replace function private.quotes_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sub numeric(14,2); v_disc numeric(14,2);
begin
  if tg_op = 'INSERT' then
    new.number := private.next_number(new.workspace_id, 'quote');
  else
    new.number := old.number;
    new.public_token := old.public_token;
  end if;
  select coalesce(sum(line_total), 0) into v_sub from public.quote_items where quote_id = new.id;
  v_disc := least(new.discount_amount, v_sub);   -- el descuento nunca supera el subtotal (se conserva el valor ingresado)
  new.subtotal := v_sub;
  new.tax_amount := round((v_sub - v_disc) * new.tax_rate / 100, 2);
  new.total := v_sub - v_disc + new.tax_amount;
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') and new.accepted_at is null then
    new.accepted_at := now();
  end if;
  return new;
end $$;
create trigger quotes_before before insert or update on public.quotes for each row execute function private.quotes_before();

create or replace function private.quote_items_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Recalcula la cotización (el trigger de quotes vuelve a sumar las líneas).
  update public.quotes set updated_at = now() where id = coalesce(new.quote_id, old.quote_id);
  return null;
end $$;
create trigger quote_items_after after insert or update or delete on public.quote_items for each row execute function private.quote_items_after();

-- ---------------------------------------------------------------------
-- Contratos (con aceptación digital y evidencia)
-- ---------------------------------------------------------------------
create table public.contract_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 120),
  body          text not null check (char_length(body) between 10 and 30000),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.contracts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  number          int not null,
  customer_id     uuid not null,
  event_id        uuid,
  quote_id        uuid,
  title           text not null check (char_length(title) between 2 and 160),
  body            text not null check (char_length(body) between 10 and 30000),
  amount          numeric(14,2) check (amount >= 0),
  currency_code   char(3) not null default 'NIO' references public.currencies(code),
  status          text not null default 'draft' check (status in ('draft','sent','accepted','canceled')),
  public_token    text not null unique default private.random_token(18),
  accepted_at     timestamptz,
  accepted_name   text,
  accepted_id_doc text,
  accepted_ip     text,
  accepted_agent  text,
  accepted_hash   text,          -- SHA-256 del texto aceptado (prueba de que no cambió después)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, number),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete set null (quote_id)
);
create index contracts_ws_idx on public.contracts(workspace_id, created_at desc);
create trigger contracts_touch before update on public.contracts for each row execute function private.touch_updated_at();

create or replace function private.contracts_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.number := private.next_number(new.workspace_id, 'contract');
    new.accepted_at := null; new.accepted_name := null; new.accepted_id_doc := null;
    new.accepted_ip := null; new.accepted_agent := null; new.accepted_hash := null;
    if new.status = 'accepted' then new.status := 'draft'; end if;
  else
    new.number := old.number;
    new.public_token := old.public_token;
    -- La evidencia de aceptación solo la escribe public_accept_contract.
    if current_setting('eventos360.accepting', true) is distinct from 'on' then
      new.accepted_at := old.accepted_at; new.accepted_name := old.accepted_name; new.accepted_id_doc := old.accepted_id_doc;
      new.accepted_ip := old.accepted_ip; new.accepted_agent := old.accepted_agent; new.accepted_hash := old.accepted_hash;
      if old.status = 'accepted' then
        -- Un contrato aceptado no se modifica (solo puede cancelarse).
        if new.status not in ('accepted','canceled') or new.body <> old.body or new.amount is distinct from old.amount then
          raise exception 'Un contrato aceptado no puede modificarse; puedes cancelarlo y crear uno nuevo' using errcode = 'P0001';
        end if;
      elsif new.status = 'accepted' then
        raise exception 'El contrato se marca como aceptado cuando el cliente lo acepta desde su enlace' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger contracts_before before insert or update on public.contracts for each row execute function private.contracts_before();

-- ---------------------------------------------------------------------
-- Pagos recibidos de clientes (anticipos, cuotas, saldos)
-- ---------------------------------------------------------------------
create table public.customer_payments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  customer_id   uuid not null,
  event_id      uuid,
  quote_id      uuid,
  kind          text not null default 'installment' check (kind in ('deposit','installment','final','other')),
  amount        numeric(14,2) not null check (amount > 0),
  currency_code char(3) not null default 'NIO' references public.currencies(code),
  method        text not null default 'transferencia' check (method in ('transferencia','deposito','efectivo','tarjeta','billetera','otro')),
  reference     text check (char_length(reference) <= 80),
  paid_at       date not null default current_date,
  notes         text check (char_length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id),
  foreign key (workspace_id, quote_id) references public.quotes(workspace_id, id) on delete set null (quote_id)
);
create index customer_payments_ws_idx on public.customer_payments(workspace_id, paid_at desc);
create index customer_payments_event_idx on public.customer_payments(event_id) where event_id is not null;

-- ---------------------------------------------------------------------
-- Agenda (reuniones, entregas, cobros, visitas)
-- ---------------------------------------------------------------------
create table public.calendar_items (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  kind          text not null default 'meeting' check (kind in ('meeting','delivery','payment','visit','other')),
  title         text not null check (char_length(title) between 1 and 160),
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  customer_id   uuid,
  event_id      uuid,
  location      text check (char_length(location) <= 200),
  notes         text check (char_length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  check (ends_at is null or ends_at >= starts_at),
  foreign key (workspace_id, customer_id) references public.customers(workspace_id, id) on delete set null (customer_id),
  foreign key (workspace_id, event_id) references public.events(workspace_id, id) on delete set null (event_id)
);
create index calendar_items_ws_idx on public.calendar_items(workspace_id, starts_at);

-- =====================================================================
-- Módulos: los de evento (invitados, mesas, etc.) también en Profesional,
-- dentro de cada evento (la navegación principal los oculta).
-- =====================================================================
update public.modules set default_kinds = array_append(default_kinds, 'professional'::public.workspace_kind)
 where key in ('guests','invitations','seating') and not ('professional' = any(default_kinds));
update public.modules set kinds = array_append(kinds, 'professional'::public.workspace_kind)
 where key = 'budget' and not ('professional' = any(kinds));
update public.modules set default_kinds = array_append(default_kinds, 'professional'::public.workspace_kind)
 where key = 'budget' and not ('professional' = any(default_kinds));

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare t record;
begin
  for t in select * from (values
    ('customers', 'customers'), ('customer_activities', 'customers'),
    ('quotes', 'quotes'), ('quote_items', 'quotes'),
    ('contract_templates', 'contracts'), ('contracts', 'contracts'),
    ('customer_payments', 'finance'), ('calendar_items', 'calendar')
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

-- Columnas calculadas/protegidas: no se envían desde el cliente.
revoke insert, update on public.quotes from authenticated;
grant insert (workspace_id, customer_id, event_id, title, status, issue_date, valid_until, currency_code, discount_amount, tax_rate, deposit_pct, terms, notes)
  on public.quotes to authenticated;
grant update (customer_id, event_id, title, status, issue_date, valid_until, currency_code, discount_amount, tax_rate, deposit_pct, terms, notes)
  on public.quotes to authenticated;
revoke insert, update on public.contracts from authenticated;
grant insert (workspace_id, customer_id, event_id, quote_id, title, body, amount, currency_code, status) on public.contracts to authenticated;
grant update (customer_id, event_id, quote_id, title, body, amount, currency_code, status) on public.contracts to authenticated;
-- Un contrato aceptado no se puede borrar (es evidencia); solo cancelar.
drop policy "miembros eliminan" on public.contracts;
create policy "miembros eliminan" on public.contracts for delete to authenticated
  using (private.can_write_module(workspace_id, 'contracts') and status <> 'accepted');

-- =====================================================================
-- Documentos públicos para el cliente (cotización y contrato por enlace)
-- =====================================================================
create or replace function private.public_business(p_ws uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', coalesce(w.legal_name, w.name), 'tax_id', w.tax_id, 'phone', w.contact_phone,
                            'email', w.contact_email, 'address', w.address, 'logo_path', w.logo_path, 'locale', w.locale, 'timezone', w.timezone)
  from public.workspaces w where w.id = p_ws;
$$;

create or replace function private.ws_public_ok(p_ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspaces w join public.subscriptions s on s.workspace_id = w.id
                 where w.id = p_ws and not w.is_disabled and s.status in ('trialing','active','past_due'));
$$;

create or replace function public.public_quote(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 64 then return null; end if;
  select jsonb_build_object(
    'quote', jsonb_build_object('number', q.number, 'title', q.title, 'status', q.status, 'issue_date', q.issue_date, 'valid_until', q.valid_until,
      'currency_code', q.currency_code, 'subtotal', q.subtotal, 'discount_amount', q.discount_amount, 'tax_rate', q.tax_rate, 'tax_amount', q.tax_amount,
      'total', q.total, 'deposit_pct', q.deposit_pct, 'terms', q.terms, 'accepted_at', q.accepted_at, 'accepted_name', q.accepted_name,
      'expired', q.valid_until is not null and q.valid_until < current_date),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'unit_price', i.unit_price,
                         'discount_pct', i.discount_pct, 'line_total', i.line_total) order by i.sort, i.id) from public.quote_items i where i.quote_id = q.id), '[]'),
    'customer', jsonb_build_object('name', c.name),
    'event', case when e.id is null then null else jsonb_build_object('name', e.name, 'starts_at', e.starts_at, 'venue_name', e.venue_name) end,
    'business', private.public_business(q.workspace_id)
  ) into v
  from public.quotes q join public.customers c on c.id = q.customer_id left join public.events e on e.id = q.event_id
  where q.public_token = p_token and q.status in ('sent','accepted','rejected','expired') and private.ws_public_ok(q.workspace_id);
  return v;
end $$;

create or replace function public.public_respond_quote(p_token text, p_accept boolean, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.quotes;
begin
  if private.attempts_exceeded('quote:' || coalesce(p_token, ''), 10, interval '1 hour') then
    raise exception 'Demasiados intentos. Inténtalo más tarde.' using errcode = 'P0001';
  end if;
  select * into q from public.quotes where public_token = p_token and private.ws_public_ok(workspace_id) for update;
  if q.id is null or q.status <> 'sent' then
    raise exception 'Esta cotización no está disponible para responder' using errcode = 'P0001';
  end if;
  if q.valid_until is not null and q.valid_until < current_date then
    raise exception 'Esta cotización venció. Solicita una actualización.' using errcode = 'P0001';
  end if;
  if p_accept and char_length(trim(coalesce(p_name, ''))) < 3 then
    raise exception 'Escribe tu nombre completo para aceptar' using errcode = 'P0001';
  end if;
  update public.quotes set status = case when p_accept then 'accepted' else 'rejected' end,
         accepted_name = case when p_accept then left(trim(p_name), 120) else null end
   where id = q.id;
  perform private.log_attempt('quote:' || p_token, false);
  insert into public.audit_logs(workspace_id, action, entity, entity_id, details)
  values (q.workspace_id, case when p_accept then 'quote.accepted_by_customer' else 'quote.rejected_by_customer' end, 'quote', q.id::text,
          jsonb_build_object('name', left(trim(coalesce(p_name, '')), 120)));
  return jsonb_build_object('ok', true, 'status', case when p_accept then 'accepted' else 'rejected' end);
end $$;

create or replace function public.public_contract(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 64 then return null; end if;
  select jsonb_build_object(
    'contract', jsonb_build_object('number', k.number, 'title', k.title, 'body', k.body, 'status', k.status, 'amount', k.amount,
      'currency_code', k.currency_code, 'accepted_at', k.accepted_at, 'accepted_name', k.accepted_name, 'accepted_hash', k.accepted_hash,
      'created_at', k.created_at),
    'customer', jsonb_build_object('name', c.name),
    'business', private.public_business(k.workspace_id)
  ) into v
  from public.contracts k join public.customers c on c.id = k.customer_id
  where k.public_token = p_token and k.status in ('sent','accepted') and private.ws_public_ok(k.workspace_id);
  return v;
end $$;

create or replace function public.public_accept_contract(p_token text, p_name text, p_id_doc text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.contracts; v_headers jsonb; v_ip text; v_agent text;
begin
  if private.attempts_exceeded('contract:' || coalesce(p_token, ''), 10, interval '1 hour') then
    raise exception 'Demasiados intentos. Inténtalo más tarde.' using errcode = 'P0001';
  end if;
  select * into k from public.contracts where public_token = p_token and private.ws_public_ok(workspace_id) for update;
  if k.id is null or k.status <> 'sent' then
    raise exception 'Este contrato no está disponible para aceptar' using errcode = 'P0001';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 5 then
    raise exception 'Escribe tu nombre completo' using errcode = 'P0001';
  end if;
  begin
    v_headers := current_setting('request.headers', true)::jsonb;
  exception when others then v_headers := '{}'::jsonb; end;
  v_ip := split_part(coalesce(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip', ''), ',', 1);
  v_agent := left(coalesce(v_headers->>'user-agent', ''), 300);
  perform set_config('eventos360.accepting', 'on', true);
  update public.contracts
     set status = 'accepted', accepted_at = now(), accepted_name = left(trim(p_name), 120),
         accepted_id_doc = nullif(left(trim(coalesce(p_id_doc, '')), 40), ''), accepted_ip = nullif(trim(v_ip), ''),
         accepted_agent = nullif(v_agent, ''), accepted_hash = encode(extensions.digest(k.body, 'sha256'), 'hex')
   where id = k.id;
  perform set_config('eventos360.accepting', 'off', true);
  perform private.log_attempt('contract:' || p_token, false);
  insert into public.audit_logs(workspace_id, action, entity, entity_id, details)
  values (k.workspace_id, 'contract.accepted_by_customer', 'contract', k.id::text, jsonb_build_object('name', left(trim(p_name), 120), 'ip', v_ip));
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.public_quote(text), public.public_respond_quote(text, boolean, text),
  public.public_contract(text), public.public_accept_contract(text, text, text) from public;
grant execute on function public.public_quote(text), public.public_respond_quote(text, boolean, text),
  public.public_contract(text), public.public_accept_contract(text, text, text) to anon, authenticated;
revoke execute on function private.public_business(uuid), private.ws_public_ok(uuid) from public, anon, authenticated;

-- =====================================================================
-- Resumen del panel Profesional (SECURITY INVOKER: respeta RLS)
-- =====================================================================
create or replace function public.pro_dashboard(p_ws uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'customers_active',  (select count(*) from public.customers where workspace_id = p_ws and status = 'active'),
    'customers_leads',   (select count(*) from public.customers where workspace_id = p_ws and status = 'lead'),
    'events_upcoming',   (select count(*) from public.events where workspace_id = p_ws and starts_at >= now() and status not in ('canceled','done')),
    'quotes_sent',       (select count(*) from public.quotes where workspace_id = p_ws and status = 'sent'),
    'quotes_sent_total', (select coalesce(sum(total), 0) from public.quotes where workspace_id = p_ws and status = 'sent'),
    'contracts_pending', (select count(*) from public.contracts where workspace_id = p_ws and status in ('draft','sent')),
    'income_period',     (select coalesce(sum(amount), 0) from public.customer_payments where workspace_id = p_ws and paid_at between p_from and p_to),
    'expenses_period',   (select coalesce(sum(x.paid_amount), 0) from public.event_expenses x join public.events e on e.id = x.event_id
                           where x.workspace_id = p_ws and e.starts_at::date between p_from and p_to),
    'contracted_total',  (select coalesce(sum(total), 0) from public.quotes where workspace_id = p_ws and status = 'accepted'),
    'received_total',    (select coalesce(sum(amount), 0) from public.customer_payments where workspace_id = p_ws),
    'followups_due',     (select count(*) from public.customer_activities where workspace_id = p_ws and not done and follow_up_on <= current_date),
    'tasks_open',        (select count(*) from public.event_tasks where workspace_id = p_ws and status <> 'done'),
    'tasks_overdue',     (select count(*) from public.event_tasks where workspace_id = p_ws and status <> 'done' and due_date < current_date)
  );
$$;
revoke execute on function public.pro_dashboard(uuid, date, date) from public, anon;
grant execute on function public.pro_dashboard(uuid, date, date) to authenticated;

-- Conflictos de agenda: eventos que se superponen con un rango (avisa, no bloquea).
create or replace function public.event_conflicts(p_ws uuid, p_starts timestamptz, p_ends timestamptz, p_exclude uuid default null)
returns table (id uuid, name text, starts_at timestamptz, ends_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select e.id, e.name, e.starts_at, e.ends_at
  from public.events e
  where e.workspace_id = p_ws and e.status not in ('canceled') and e.starts_at is not null
    and (p_exclude is null or e.id <> p_exclude)
    and tstzrange(e.starts_at, coalesce(e.ends_at, e.starts_at + interval '6 hours'), '[)')
        && tstzrange(p_starts, coalesce(p_ends, p_starts + interval '6 hours'), '[)')
  order by e.starts_at;
$$;
revoke execute on function public.event_conflicts(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.event_conflicts(uuid, timestamptz, timestamptz, uuid) to authenticated;
