-- =====================================================================
-- Documentos profesionales: diseños, fotos en cotizaciones, firmas.
-- =====================================================================

-- Marca del negocio: color y firma del prestador del servicio
alter table public.workspaces
  add column brand_color    text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  add column signature_path text,
  add column signer_name    text check (char_length(signer_name) <= 120),
  add column signer_title   text check (char_length(signer_title) <= 120);
grant update (brand_color, signature_path, signer_name, signer_title) on public.workspaces to authenticated;

-- Cotizaciones: diseño, introducción y líneas con foto y detalle
alter table public.quotes
  add column template text not null default 'clasica' check (template in ('clasica','catalogo','elegante')),
  add column intro    text check (char_length(intro) <= 3000);
grant insert (template, intro), update (template, intro) on public.quotes to authenticated;

alter table public.quote_items
  add column details    text check (char_length(details) <= 2000),
  add column image_path text;

-- Contratos: diseño, firma del prestador y firma manuscrita del cliente
alter table public.contracts
  add column template                   text not null default 'clasica' check (template in ('clasica','elegante','moderna')),
  add column include_provider_signature boolean not null default true,
  add column accepted_signature         text check (accepted_signature is null or
                                          (accepted_signature like 'data:image/png;base64,%' and char_length(accepted_signature) <= 400000));
grant insert (template, include_provider_signature), update (template, include_provider_signature) on public.contracts to authenticated;

-- La firma del cliente es evidencia: solo la escribe public_accept_contract.
create or replace function private.contracts_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.number := private.next_number(new.workspace_id, 'contract');
    new.accepted_at := null; new.accepted_name := null; new.accepted_id_doc := null;
    new.accepted_ip := null; new.accepted_agent := null; new.accepted_hash := null; new.accepted_signature := null;
    if new.status = 'accepted' then new.status := 'draft'; end if;
  else
    new.number := old.number;
    new.public_token := old.public_token;
    if current_setting('eventos360.accepting', true) is distinct from 'on' then
      new.accepted_at := old.accepted_at; new.accepted_name := old.accepted_name; new.accepted_id_doc := old.accepted_id_doc;
      new.accepted_ip := old.accepted_ip; new.accepted_agent := old.accepted_agent; new.accepted_hash := old.accepted_hash;
      new.accepted_signature := old.accepted_signature;
      if old.status = 'accepted' then
        if new.status not in ('accepted','canceled') or new.body <> old.body or new.amount is distinct from old.amount then
          raise exception 'Un contrato firmado no puede modificarse; puedes cancelarlo y crear uno nuevo' using errcode = 'P0001';
        end if;
      elsif new.status = 'accepted' then
        raise exception 'El contrato queda firmado cuando el cliente lo firma desde su enlace' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;

-- Datos públicos del negocio para documentos
create or replace function private.public_business(p_ws uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', coalesce(w.legal_name, w.name), 'tax_id', w.tax_id, 'phone', w.contact_phone,
                            'email', w.contact_email, 'address', w.address, 'logo_path', w.logo_path, 'locale', w.locale, 'timezone', w.timezone,
                            'brand_color', w.brand_color, 'signature_path', w.signature_path, 'signer_name', w.signer_name, 'signer_title', w.signer_title)
  from public.workspaces w where w.id = p_ws;
$$;
revoke execute on function private.public_business(uuid) from public, anon, authenticated;

create or replace function public.public_quote(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 64 then return null; end if;
  select jsonb_build_object(
    'quote', jsonb_build_object('number', q.number, 'title', q.title, 'status', q.status, 'issue_date', q.issue_date, 'valid_until', q.valid_until,
      'currency_code', q.currency_code, 'subtotal', q.subtotal, 'discount_amount', q.discount_amount, 'tax_rate', q.tax_rate, 'tax_amount', q.tax_amount,
      'total', q.total, 'deposit_pct', q.deposit_pct, 'terms', q.terms, 'intro', q.intro, 'template', q.template,
      'accepted_at', q.accepted_at, 'accepted_name', q.accepted_name,
      'expired', q.valid_until is not null and q.valid_until < current_date),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'details', i.details, 'image_path', i.image_path,
                         'quantity', i.quantity, 'unit_price', i.unit_price, 'discount_pct', i.discount_pct, 'line_total', i.line_total) order by i.sort, i.id)
                       from public.quote_items i where i.quote_id = q.id), '[]'),
    'customer', jsonb_build_object('name', c.name),
    'event', case when e.id is null then null else jsonb_build_object('name', e.name, 'starts_at', e.starts_at, 'venue_name', e.venue_name) end,
    'business', private.public_business(q.workspace_id)
  ) into v
  from public.quotes q join public.customers c on c.id = q.customer_id left join public.events e on e.id = q.event_id
  where q.public_token = p_token and q.status in ('sent','accepted','rejected','expired') and private.ws_public_ok(q.workspace_id);
  return v;
end $$;

create or replace function public.public_contract(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 64 then return null; end if;
  select jsonb_build_object(
    'contract', jsonb_build_object('number', k.number, 'title', k.title, 'body', k.body, 'status', k.status, 'amount', k.amount,
      'currency_code', k.currency_code, 'accepted_at', k.accepted_at, 'accepted_name', k.accepted_name, 'accepted_id_doc', k.accepted_id_doc,
      'accepted_hash', k.accepted_hash, 'accepted_signature', k.accepted_signature, 'template', k.template,
      'include_provider_signature', k.include_provider_signature, 'created_at', k.created_at),
    'customer', jsonb_build_object('name', c.name, 'tax_id', c.tax_id),
    'business', private.public_business(k.workspace_id)
  ) into v
  from public.contracts k join public.customers c on c.id = k.customer_id
  where k.public_token = p_token and k.status in ('sent','accepted') and private.ws_public_ok(k.workspace_id);
  return v;
end $$;

-- Firma del cliente: nombre, identificación y firma manuscrita (dibujada en pantalla).
drop function public.public_accept_contract(text, text, text);
create or replace function public.public_accept_contract(p_token text, p_name text, p_id_doc text, p_signature text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.contracts; v_headers jsonb; v_ip text; v_agent text;
begin
  if private.attempts_exceeded('contract:' || coalesce(p_token, ''), 10, interval '1 hour') then
    raise exception 'Demasiados intentos. Inténtalo más tarde.' using errcode = 'P0001';
  end if;
  select * into k from public.contracts where public_token = p_token and private.ws_public_ok(workspace_id) for update;
  if k.id is null or k.status <> 'sent' then
    raise exception 'Este contrato no está disponible para firmar' using errcode = 'P0001';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 5 then
    raise exception 'Escribe tu nombre completo' using errcode = 'P0001';
  end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or char_length(p_signature) > 400000 or char_length(p_signature) < 200 then
    raise exception 'Dibuja tu firma en el recuadro' using errcode = 'P0001';
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
         accepted_agent = nullif(v_agent, ''), accepted_hash = encode(extensions.digest(k.body, 'sha256'), 'hex'),
         accepted_signature = p_signature
   where id = k.id;
  perform set_config('eventos360.accepting', 'off', true);
  perform private.log_attempt('contract:' || p_token, false);
  insert into public.audit_logs(workspace_id, action, entity, entity_id, details)
  values (k.workspace_id, 'contract.signed_by_customer', 'contract', k.id::text, jsonb_build_object('name', left(trim(p_name), 120), 'ip', v_ip));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.public_accept_contract(text, text, text, text) from public;
grant execute on function public.public_accept_contract(text, text, text, text) to anon, authenticated;
