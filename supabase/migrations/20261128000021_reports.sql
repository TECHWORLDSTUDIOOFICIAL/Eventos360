-- =====================================================================
-- Eventos360 · Etapa 8 · Reportes
-- Personal: reporte de su evento (se arma en la pantalla con sus datos).
-- Profesional y Business: report_business() calcula todo en la base,
-- con las mismas reglas de Finanzas (ventas sin IVA, costos reales,
-- gastos del negocio). La comparación con el período anterior y la
-- tendencia de 12 meses son "Reportes avanzados" según el plan.
-- (Migración solo aditiva.)
-- =====================================================================

-- Reportes también en el plan Personal
update public.modules set kinds = array_append(kinds, 'personal'::public.workspace_kind)
  where key = 'reports' and not ('personal' = any(kinds));
update public.modules set default_kinds = array_append(default_kinds, 'personal'::public.workspace_kind)
  where key = 'reports' and not ('personal' = any(default_kinds));

-- ---------------------------------------------------------------------
-- Ventas reconocidas (una fila por venta), en una moneda.
-- Cotización aceptada (si no pasó a reservación de alquiler), reservación
-- de alquiler apartada/entregada/devuelta y reserva de salón confirmada.
-- ---------------------------------------------------------------------
create or replace function private.report_deals(p_ws uuid, p_cur text)
returns table (kind text, id uuid, event_id uuid, customer_id uuid, d date, net numeric, gross numeric, est_cost numeric, retained numeric)
language sql stable security definer set search_path = '' as $$
  with tz as (select timezone from public.workspaces where id = p_ws)
  select 'quote', q.id, q.event_id, q.customer_id, coalesce((q.accepted_at at time zone (select timezone from tz))::date, q.issue_date),
         q.subtotal - least(q.discount_amount, q.subtotal), q.total, q.cost_total, 0::numeric
    from public.quotes q
   where q.workspace_id = p_ws and q.status = 'accepted' and q.currency_code = p_cur
     and not exists (select 1 from public.rentals r where r.quote_id = q.id and r.status in ('reserved','out','returned'))
  union all
  select 'rental', r.id, r.event_id, r.customer_id, (r.starts_at at time zone (select timezone from tz))::date,
         r.subtotal - least(r.discount_amount, r.subtotal) + r.damage_total, r.total + r.damage_total, 0::numeric, r.deposit_retained
    from public.rentals r
   where r.workspace_id = p_ws and r.status in ('reserved','out','returned') and r.currency_code = p_cur
  union all
  select 'booking', b.id, b.event_id, b.customer_id, (b.starts_at at time zone (select timezone from tz))::date,
         b.subtotal - least(b.discount_amount, b.subtotal), b.total, b.cost_total, b.deposit_retained
    from public.bookings b
   where b.workspace_id = p_ws and b.kind = 'event' and b.status in ('confirmed','done') and b.currency_code = p_cur;
$$;

-- Pago del personal (turnos que cuentan), con su fecha local.
create or replace function private.report_staff(p_ws uuid, p_cur text)
returns table (worker_id uuid, shift_id uuid, event_id uuid, d date, hours numeric, pay numeric, status text, paid boolean, started boolean)
language sql stable security definer set search_path = '' as $$
  select a.worker_id, s.id, s.event_id, (s.starts_at at time zone w.timezone)::date,
         round((extract(epoch from coalesce(a.check_out - a.check_in, s.ends_at - s.starts_at)) / 3600)::numeric, 2),
         a.pay_amount, a.status, a.payout_id is not null, s.starts_at <= now()
    from public.shift_assignments a join public.shifts s on s.id = a.shift_id join public.workspaces w on w.id = a.workspace_id
   where a.workspace_id = p_ws and a.currency_code = p_cur;
$$;

-- Costo real de un evento: lo registrado en el evento + su personal.
create or replace function private.report_event_real(p_event uuid, p_cur text)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(coalesce(x.agreed_amount, x.planned_amount)) from public.event_expenses x join public.events e on e.id = x.event_id
                    where x.event_id = p_event and e.currency_code = p_cur), 0)
       + coalesce((select sum(a.pay_amount) from public.shift_assignments a join public.shifts s on s.id = a.shift_id
                    where s.event_id = p_event and a.currency_code = p_cur and a.status in ('assigned','confirmed','attended')), 0);
$$;

-- Totales de un período (mismas reglas que Finanzas).
create or replace function private.report_totals(p_ws uuid, p_from date, p_to date, p_cur text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with rd as materialized (select * from private.report_deals(p_ws, p_cur) x where x.d between p_from and p_to),
  st as materialized (select * from private.report_staff(p_ws, p_cur) x where x.d between p_from and p_to and x.status in ('assigned','confirmed','attended')),
  v as (select
    (select coalesce(sum(net), 0) from rd) sales,
    (select coalesce(sum(gross - net), 0) from rd) tax,
    (select count(*) from rd) deals,
    (select coalesce(sum(greatest(ev.est, private.report_event_real(ev.event_id, p_cur))), 0)
       from (select event_id, sum(est_cost) est from rd where event_id is not null group by event_id) ev)
      + (select coalesce(sum(est_cost), 0) from rd where event_id is null)
      + (select coalesce(sum(pay), 0) from st where st.event_id is null or st.event_id not in (select event_id from rd where event_id is not null)) cost,
    (select coalesce(sum(pay), 0) from st) staff,
    (select coalesce(sum(amount), 0) from public.business_expenses where workspace_id = p_ws and currency_code = p_cur and spent_at between p_from and p_to) overhead,
    (select coalesce(sum(amount), 0) from public.customer_payments where workspace_id = p_ws and currency_code = p_cur and paid_at between p_from and p_to) collected)
  select jsonb_build_object('sales', sales, 'tax', tax, 'cost', cost, 'overhead', overhead, 'result', sales - cost - overhead,
    'collected', collected, 'staff', staff, 'deals', deals) from v;
$$;

-- ---------------------------------------------------------------------
-- Reporte del negocio (Profesional y Business)
-- ---------------------------------------------------------------------
create or replace function public.report_business(p_ws uuid, p_from date, p_to date, p_cur text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tz text; v_adv boolean; v_days int; v_today date; v_prev_from date; v_prev_to date;
  v_totals jsonb; v_prev jsonb; v_monthly jsonb; v_m date; v_out jsonb;
begin
  if not (p_ws in (select private.user_workspace_ids()) and private.ws_has_module(p_ws, 'reports') and private.role_can_module(p_ws, 'reports')) then
    raise exception 'No tienes acceso a los reportes de este negocio.' using errcode = '42501';
  end if;
  if (select kind from public.workspaces where id = p_ws) = 'personal' then
    raise exception 'Este reporte es para negocios.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'Elige un período válido (máximo 3 años).' using errcode = '22023';
  end if;
  select timezone into v_tz from public.workspaces where id = p_ws;
  v_today := (now() at time zone v_tz)::date;
  v_days := p_to - p_from + 1;
  v_adv := private.ws_feature_enabled(p_ws, 'reports.advanced');

  v_totals := private.report_totals(p_ws, p_from, p_to, p_cur);
  if v_adv then
    v_prev_to := p_from - 1; v_prev_from := p_from - v_days;
    v_prev := private.report_totals(p_ws, v_prev_from, v_prev_to, p_cur) || jsonb_build_object('from', v_prev_from, 'to', v_prev_to);
    v_monthly := '[]'::jsonb;
    for i in reverse 11..0 loop
      v_m := (date_trunc('month', p_to) - make_interval(months => i))::date;
      v_monthly := v_monthly || jsonb_build_array(private.report_totals(p_ws, v_m, (v_m + interval '1 month' - interval '1 day')::date, p_cur) || jsonb_build_object('month', to_char(v_m, 'YYYY-MM')));
    end loop;
  end if;

  with rd as materialized (select * from private.report_deals(p_ws, p_cur) x where x.d between p_from and p_to)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days, 'currency', p_cur),
    'advanced', v_adv,
    'totals', v_totals, 'previous', v_prev, 'monthly', v_monthly,

    -- Embudo de cotizaciones emitidas en el período
    'quotes', (select jsonb_build_object(
        'total', count(*), 'draft', count(*) filter (where q.status = 'draft'), 'sent', count(*) filter (where q.status = 'sent'),
        'accepted', count(*) filter (where q.status = 'accepted'), 'rejected', count(*) filter (where q.status = 'rejected'),
        'expired', count(*) filter (where q.status = 'expired'),
        'accepted_net', coalesce(sum(q.subtotal - least(q.discount_amount, q.subtotal)) filter (where q.status = 'accepted'), 0),
        'quoted_net', coalesce(sum(q.subtotal - least(q.discount_amount, q.subtotal)) filter (where q.status <> 'draft'), 0),
        'avg_days_to_accept', round(avg(((q.accepted_at at time zone v_tz)::date - q.issue_date)) filter (where q.status = 'accepted' and q.accepted_at is not null), 1))
      from public.quotes q where q.workspace_id = p_ws and q.currency_code = p_cur and q.issue_date between p_from and p_to),

    -- Ventas por tipo de evento
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'count', c.n, 'net', c.net) order by c.net desc), '[]') from (
        select e.category, count(*) n, sum(r.net) net from rd r left join public.events e on e.id = r.event_id group by e.category) c),

    -- Mejores clientes del período
    'top_customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.customer_id, 'name', cu.name, 'count', c.n, 'net', c.net) order by c.net desc), '[]') from (
        select r.customer_id, count(*) n, sum(r.net) net from rd r group by r.customer_id order by sum(r.net) desc limit 10) c
        left join public.customers cu on cu.id = c.customer_id),

    -- Lo más vendido: líneas de cotizaciones aceptadas, reservaciones y reservas del período
    'top_items', (select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'kind', t.k, 'qty', t.qty, 'revenue', t.revenue, 'cost', t.cost) order by t.revenue desc), '[]') from (
        select x.label, min(x.k) k, sum(x.qty) qty, sum(x.revenue) revenue, sum(x.cost) cost from (
          select coalesce(pk.name, ci.name, rs.name, qi.description) label, case when pk.id is not null then 'package' when ci.id is not null then 'catalog' else 'line' end k,
                 qi.quantity qty, qi.line_total revenue, qi.unit_cost * qi.quantity cost
            from public.quote_items qi join rd r on r.kind = 'quote' and r.id = qi.quote_id
            left join public.packages pk on pk.id = qi.package_id left join public.catalog_items ci on ci.id = qi.catalog_item_id left join public.resources rs on rs.id = qi.resource_id
          union all
          select coalesce(rs.name, ri.description), 'rental', ri.quantity, ri.line_total, 0
            from public.rental_items ri join rd r on r.kind = 'rental' and r.id = ri.rental_id left join public.resources rs on rs.id = ri.resource_id
          union all
          select bi.description, 'booking', bi.quantity, bi.line_total, bi.unit_cost * bi.quantity
            from public.booking_items bi join rd r on r.kind = 'booking' and r.id = bi.booking_id
        ) x group by x.label order by sum(x.revenue) desc limit 15) t),

    -- Cobros del período por método
    'payments_by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'count', p.n, 'amount', p.amount) order by p.amount desc), '[]') from (
        select method, count(*) n, sum(amount) amount from public.customer_payments
         where workspace_id = p_ws and currency_code = p_cur and paid_at between p_from and p_to group by method) p),

    -- Nuevos clientes por cómo llegaron
    'new_customers', (select coalesce(jsonb_agg(jsonb_build_object('source', c.source, 'count', c.n) order by c.n desc), '[]') from (
        select nullif(trim(source), '') source, count(*) n from public.customers
         where workspace_id = p_ws and (created_at at time zone v_tz)::date between p_from and p_to group by 1) c),

    -- Gastos del negocio por categoría
    'expenses_by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'amount', x.amount) order by x.amount desc), '[]') from (
        select category, sum(amount) amount from public.business_expenses
         where workspace_id = p_ws and currency_code = p_cur and spent_at between p_from and p_to group by category) x),

    -- A quién le compras: costos con proveedor en ventas del período, gastos de eventos del período y gastos del negocio
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('id', s.supplier_id, 'name', su.name, 'service', su.service_type, 'amount', s.amount) order by s.amount desc), '[]') from (
        select y.supplier_id, sum(y.amount) amount from (
          select qi.supplier_id, qi.unit_cost * qi.quantity amount from public.quote_items qi join rd r on r.kind = 'quote' and r.id = qi.quote_id where qi.supplier_id is not null
          union all
          select bi.supplier_id, bi.unit_cost * bi.quantity from public.booking_items bi join rd r on r.kind = 'booking' and r.id = bi.booking_id where bi.supplier_id is not null
          union all
          select x.supplier_id, coalesce(x.agreed_amount, x.planned_amount) from public.event_expenses x join public.events e on e.id = x.event_id
           where x.workspace_id = p_ws and x.supplier_id is not null and e.currency_code = p_cur and (e.starts_at at time zone v_tz)::date between p_from and p_to
          union all
          select be.supplier_id, be.amount from public.business_expenses be
           where be.workspace_id = p_ws and be.supplier_id is not null and be.currency_code = p_cur and be.spent_at between p_from and p_to
        ) y group by y.supplier_id order by sum(y.amount) desc limit 10) s join public.suppliers su on su.id = s.supplier_id),

    -- Personal: turnos, horas, ausencias y pago por persona
    'staff', case when private.ws_has_module(p_ws, 'shifts') then (select coalesce(jsonb_agg(jsonb_build_object('id', st.worker_id, 'name', wk.full_name,
        'shifts', st.shifts, 'absent', st.absent, 'hours', st.hours, 'pay', st.pay, 'unpaid', st.unpaid) order by st.pay desc), '[]') from (
        select x.worker_id, count(*) filter (where x.status in ('assigned','confirmed','attended')) shifts, count(*) filter (where x.status = 'absent') absent,
               coalesce(sum(x.hours) filter (where x.status in ('assigned','confirmed','attended')), 0) hours, coalesce(sum(x.pay), 0) pay,
               coalesce(sum(x.pay) filter (where not x.paid and x.started), 0) unpaid
          from private.report_staff(p_ws, p_cur) x where x.d between p_from and p_to group by x.worker_id) st
        join public.workers wk on wk.id = st.worker_id) end
  ) into v_out;

  -- Saldos por cobrar y su antigüedad (los pagos de cada cliente se aplican a sus ventas más antiguas primero)
  v_out := v_out || jsonb_build_object('receivables', (
    with deals as (select * from private.report_deals(p_ws, p_cur)),
    paid as (select customer_id, sum(amount) amount from public.customer_payments where workspace_id = p_ws and currency_code = p_cur group by customer_id),
    lined as (
      select d.*, sum(d.gross - d.retained) over (partition by d.customer_id order by d.d, d.id) cum, coalesce(p.amount, 0) paid
        from deals d left join paid p on p.customer_id = d.customer_id),
    open as (select l.customer_id, l.d, greatest(0, least(l.gross - l.retained, l.cum - l.paid)) bal from lined l)
    select jsonb_build_object(
      'total', coalesce(sum(bal), 0),
      'buckets', jsonb_build_object(
        'upcoming', coalesce(sum(bal) filter (where d > v_today), 0),
        'd30', coalesce(sum(bal) filter (where d <= v_today and v_today - d <= 30), 0),
        'd60', coalesce(sum(bal) filter (where v_today - d between 31 and 60), 0),
        'd90', coalesce(sum(bal) filter (where v_today - d between 61 and 90), 0),
        'd90plus', coalesce(sum(bal) filter (where v_today - d > 90), 0)),
      'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.customer_id, 'name', cu.name, 'phone', cu.phone, 'balance', c.bal, 'oldest', c.oldest) order by c.bal desc), '[]') from (
          select customer_id, sum(bal) bal, min(d) filter (where bal > 0) oldest from open group by customer_id having sum(bal) > 0.005 order by sum(bal) desc limit 25) c
          left join public.customers cu on cu.id = c.customer_id))
    from open));

  -- Alquiler: lo más alquilado y qué tanto se usa cada artículo
  if private.ws_has_module(p_ws, 'reservations') then
    v_out := v_out || jsonb_build_object('rental', jsonb_build_object(
      'damages', (select coalesce(sum(r.damage_total), 0) from public.rentals r where r.workspace_id = p_ws and r.currency_code = p_cur and r.status in ('out','returned')
                   and (r.starts_at at time zone v_tz)::date between p_from and p_to),
      'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', rs.id, 'name', rs.name, 'total_qty', rs.total_qty, 'units', u.units, 'revenue', u.revenue,
            'utilization', case when rs.total_qty > 0 then round(u.unit_days / (rs.total_qty * v_days)::numeric * 100, 1) else 0 end) order by u.revenue desc), '[]') from (
          select ri.resource_id, sum(ri.quantity) units, sum(ri.line_total) revenue,
                 sum(ri.quantity * greatest(0, least((r.ends_at at time zone v_tz)::date, p_to) - greatest((r.starts_at at time zone v_tz)::date, p_from) + 1)) unit_days
            from public.rental_items ri join public.rentals r on r.id = ri.rental_id
           where r.workspace_id = p_ws and r.status in ('reserved','out','returned') and ri.resource_id is not null
             and (r.starts_at at time zone v_tz)::date <= p_to and (r.ends_at at time zone v_tz)::date >= p_from
           group by ri.resource_id) u join public.resources rs on rs.id = u.resource_id)));
  end if;

  -- Salones: ocupación por espacio y de dónde llegan las consultas
  if private.ws_has_module(p_ws, 'bookings') then
    v_out := v_out || jsonb_build_object('venues', jsonb_build_object(
      'spaces', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name,
            'events', (select count(*) from public.bookings b where b.venue_id = v.id and b.kind = 'event' and b.status in ('confirmed','done')
                        and (b.starts_at at time zone v_tz)::date between p_from and p_to),
            'days', (select count(distinct g::date) from public.bookings b,
                        generate_series(greatest((b.starts_at at time zone v_tz)::date, p_from), least(((b.ends_at - interval '1 second') at time zone v_tz)::date, p_to), interval '1 day') g
                      where b.venue_id = v.id and b.kind = 'event' and b.status in ('confirmed','done')),
            'net', (select coalesce(sum(b.subtotal - least(b.discount_amount, b.subtotal)), 0) from public.bookings b
                     where b.venue_id = v.id and b.kind = 'event' and b.status in ('confirmed','done') and b.currency_code = p_cur
                       and (b.starts_at at time zone v_tz)::date between p_from and p_to)
          ) order by v.sort, v.name), '[]') from public.venues v where v.workspace_id = p_ws and v.is_active),
      'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'total', s.total, 'won', s.won) order by s.total desc), '[]') from (
          select b.source, count(*) total, count(*) filter (where b.status in ('confirmed','done')) won from public.bookings b
           where b.workspace_id = p_ws and b.kind = 'event' and (b.created_at at time zone v_tz)::date between p_from and p_to group by b.source) s)));
  end if;
  return v_out;
end $$;

revoke execute on function private.report_deals(uuid, text), private.report_staff(uuid, text), private.report_event_real(uuid, text),
  private.report_totals(uuid, date, date, text) from public, anon, authenticated;
revoke execute on function public.report_business(uuid, date, date, text) from public, anon;
grant execute on function public.report_business(uuid, date, date, text) to authenticated;
