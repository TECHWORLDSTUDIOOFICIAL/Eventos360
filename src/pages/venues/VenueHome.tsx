import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck, CalendarDays, Clock, Inbox, Plus, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { useCustomers, usePayments } from "@/lib/pro";
import { scheduleText, useBookings, useVenues } from "@/lib/venues";
import { formatDate, formatMoney, plural } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Button, Card, CardHeader, PageHeader, Spinner, Stat, cx } from "@/components/ui";
import { GettingStarted } from "@/components/GettingStarted";
import { BookingBadge } from "./BookingsPage";

interface Dash {
  venues: number; rates: number; today: number; week: number; inquiries: number; holds: number; holds_expiring: number; confirmed_month: number;
  occupancy: { venue_id: string; name: string; days: number; month_days: number }[];
}

/** Panel del salón o local: hoy, lo que vence, consultas por atender y ocupación del mes. */
export default function VenueHome() {
  const { ws, region, readOnly, modules } = useWorkspace();
  const { profile } = useAuth();
  const has = (k: string) => modules.some((m) => m.module_key === k);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const { data: d, isLoading } = useQuery({ queryKey: ["venue-dashboard", ws.id], queryFn: async () => unwrap<Dash>(await supabase.rpc("venue_dashboard", { p_ws: ws.id })) });
  const { data: bookings } = useBookings(ws.id);
  const { data: venues } = useVenues(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const payments = usePayments(ws.id);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const income = new Map<string, number>();
  for (const p of payments.data ?? []) if (p.paid_at >= monthStart) income.set(p.currency_code, (income.get(p.currency_code) ?? 0) + Number(p.amount));
  const incomeText = [...income.entries()].map(([c, v]) => formatMoney(v, c, region.locale)).join(" · ") || formatMoney(0, region.currency_code, region.locale);
  const monthName = new Intl.DateTimeFormat(region.locale, { month: "long" }).format(now);
  const cust = (id: string | null) => customers?.find((c) => c.id === id)?.name ?? "";
  const venue = (id: string) => venues?.find((v) => v.id === id);
  const upcoming = (bookings ?? []).filter((b) => b.kind === "event" && (b.status === "confirmed" || b.status === "hold") && new Date(b.ends_at) > now).slice(0, 6);
  const expiring = (bookings ?? []).filter((b) => b.status === "hold" && b.hold_until && new Date(b.hold_until) > now).sort((a, b) => a.hold_until!.localeCompare(b.hold_until!)).slice(0, 5);
  const inquiries = (bookings ?? []).filter((b) => b.status === "inquiry" && new Date(b.ends_at) > now).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

  if (isLoading || !d) return <Spinner />;
  return (
    <div className="animate-rise">
      <PageHeader eyebrow={ws.primary_specialty ?? "Eventos360 Business"} title={`Hola, ${profile?.full_name.split(" ")[0] ?? ""}`} description="Tus espacios de un vistazo: eventos, apartados por vencer y consultas por atender."
        actions={<>
          {has("venue_calendar") && <Link to={base("m/venue_calendar")}><Button variant="secondary" icon={<CalendarDays className="size-4" />}>Ocupación</Button></Link>}
          {!readOnly && has("bookings") && <Link to={base("m/bookings/nueva")}><Button variant="accent" icon={<Plus className="size-4" />}>Reserva</Button></Link>}
        </>} />
      <GettingStarted variant="venue" />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Eventos hoy" value={d.today} icon={<CalendarCheck className="size-4" />} hint={`${plural(d.week, "evento", "eventos")} en los próximos 7 días`} />
        <Stat label="Consultas por atender" value={d.inquiries} icon={<Inbox className="size-4" />} hint={d.inquiries ? "Respóndelas pronto" : "Todo al día"} />
        <Stat label="Apartados" value={d.holds} icon={<Clock className="size-4" />} hint={d.holds_expiring ? <span className="font-semibold text-warn">{plural(d.holds_expiring, "vence", "vencen")} en 3 días</span> : "Ninguno por vencer"} />
        {has("finance") ? <Stat label={`Cobrado en ${monthName}`} value={<span className="text-xl">{incomeText}</span>} icon={<Wallet className="size-4" />} hint={`${plural(d.confirmed_month, "evento confirmado", "eventos confirmados")} este mes`} />
          : <Stat label="Confirmados este mes" value={d.confirmed_month} icon={<CalendarCheck className="size-4" />} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Próximos eventos" action={<Link to={base("m/bookings")} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent)]">Ver todos<ArrowRight className="size-4" /></Link>} />
          {!upcoming.length ? <p className="px-5 py-8 text-center text-sm text-muted">Sin eventos próximos.</p> : (
            <ul className="divide-y divide-line">{upcoming.map((b) => (
              <li key={b.id}><Link to={base(`m/bookings/${b.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                <span className="w-1 self-stretch rounded-full" style={{ background: venue(b.venue_id)?.color }} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.title}</span><span className="block truncate text-xs text-muted">{venue(b.venue_id)?.name} · {scheduleText(b.starts_at, b.ends_at, region.timezone, region.locale)}</span></span>
                <BookingBadge b={b} />
              </Link></li>
            ))}</ul>
          )}
        </Card>
        <div className="space-y-6">
          {inquiries.length > 0 && (
            <Card>
              <CardHeader title="Consultas recientes" action={<Link to={base("m/bookings?ver=consultas")} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent)]">Ver todas<ArrowRight className="size-4" /></Link>} />
              <ul className="divide-y divide-line">{inquiries.map((b) => (
                <li key={b.id}><Link to={base(`m/bookings/${b.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{cust(b.customer_id) || b.title}</span><span className="block truncate text-xs text-muted">{venue(b.venue_id)?.name} · {formatDate(b.starts_at, { timeZone: region.timezone })}{b.guests ? ` · ${b.guests} personas` : ""}{b.source === "web" ? " · desde tu página" : ""}</span></span>
                  <ArrowRight className="size-4 text-faint" />
                </Link></li>
              ))}</ul>
            </Card>
          )}
          {expiring.length > 0 && (
            <Card>
              <CardHeader title="Apartados por vencer" description="Si no se confirman, la fecha se libera sola." />
              <ul className="divide-y divide-line">{expiring.map((b) => (
                <li key={b.id}><Link to={base(`m/bookings/${b.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.title}</span><span className="block truncate text-xs text-muted">{venue(b.venue_id)?.name} · {formatDate(b.starts_at, { timeZone: region.timezone })}</span></span>
                  <span className={cx("text-xs font-semibold", new Date(b.hold_until!).getTime() - Date.now() < 3 * 86_400_000 ? "text-warn" : "text-muted")}>Vence {formatDate(b.hold_until, { timeZone: region.timezone })}</span>
                </Link></li>
              ))}</ul>
            </Card>
          )}
          {d.occupancy.length > 0 && (
            <Card>
              <CardHeader title={`Ocupación de ${monthName}`} description="Días con eventos confirmados." />
              <ul className="space-y-3 p-5">
                {d.occupancy.map((o) => {
                  const pct = Math.round((o.days / Math.max(1, o.month_days)) * 100);
                  return (
                    <li key={o.venue_id}>
                      <div className="flex justify-between text-sm"><span className="font-medium">{o.name}</span><span className="tabular-nums text-muted">{plural(o.days, "día", "días")} · {pct}%</span></div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: venue(o.venue_id)?.color ?? "var(--accent)" }} /></div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
