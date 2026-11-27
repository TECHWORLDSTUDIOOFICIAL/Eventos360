import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Boxes, CalendarCheck, ClipboardCheck, Plus, RotateCcw, ShieldCheck, Truck, Wallet, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { docNumber, useCustomers, usePayments } from "@/lib/pro";
import { useRentals } from "@/lib/rental";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, CardHeader, PageHeader, Spinner, Stat, cx } from "@/components/ui";
import { RentalStatusBadge } from "./rentalShared";

interface Dash {
  resources: number; units: number; deliveries_today: number; deliveries_overdue: number; deliveries_week: number;
  returns_today: number; returns_pending: number; returns_overdue: number; drafts: number; maintenance_units: number;
  deposits_held: Record<string, number>;
}
interface Shortage { rental_id: string; rental_number: number; title: string; starts_at: string; resource_name: string; requested: number; available: number }

/** Panel del negocio de alquiler. Todas las cifras salen de los registros reales. */
export default function BusinessHome() {
  const { ws, region, readOnly, modules } = useWorkspace();
  const { profile } = useAuth();
  const has = (k: string) => modules.some((m) => m.module_key === k);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const { data: d, isLoading } = useQuery({ queryKey: ["rental-dashboard", ws.id], queryFn: async () => unwrap<Dash>(await supabase.rpc("rental_dashboard", { p_ws: ws.id })) });
  const { data: shortages } = useQuery({ queryKey: ["rental-shortages", ws.id], queryFn: async () => unwrap<Shortage[]>(await supabase.rpc("rental_shortages", { p_ws: ws.id })) });
  const { data: active } = useRentals(ws.id, { statuses: ["reserved", "out"] });
  const { data: customers } = useCustomers(ws.id);
  const payments = usePayments(ws.id);
  const cust = (id: string) => customers?.find((c) => c.id === id)?.name ?? "";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const income = new Map<string, number>();
  for (const p of payments.data ?? []) if (p.paid_at >= monthStart) income.set(p.currency_code, (income.get(p.currency_code) ?? 0) + Number(p.amount));
  const fmtMap = (m: Map<string, number> | Record<string, number>) => {
    const parts = (m instanceof Map ? [...m.entries()] : Object.entries(m)).filter(([, v]) => Math.abs(v) >= 0.005).map(([c, v]) => formatMoney(v, c, region.locale));
    return parts.length ? parts.join(" · ") : formatMoney(0, region.currency_code, region.locale);
  };
  const nextOut = (active ?? []).filter((r) => r.status === "reserved").slice(0, 6);
  const nextBack = [...(active ?? []).filter((r) => r.status === "out")].sort((a, b) => a.ends_at.localeCompare(b.ends_at)).slice(0, 6);
  const monthName = new Intl.DateTimeFormat(region.locale, { month: "long" }).format(now);

  if (isLoading || !d) return <Spinner />;
  return (
    <div className="animate-rise">
      <PageHeader eyebrow={ws.primary_specialty ?? "Eventos360 Business"} title={`Hola, ${profile?.full_name.split(" ")[0] ?? ""}`} description="Lo que sale, lo que vuelve y lo que necesita atención hoy."
        actions={<>
          {has("availability") && <Link to={base("m/availability")}><Button variant="secondary" icon={<ClipboardCheck className="size-4" />}>Disponibilidad</Button></Link>}
          {!readOnly && has("reservations") && <Link to={base("m/reservations/nueva")}><Button variant="accent" icon={<Plus className="size-4" />}>Reservación</Button></Link>}
        </>} />

      {d.resources === 0 && has("inventory") && (
        <div className="mb-6"><Alert tone="info" title="Empieza por tu inventario">Registra tus artículos (o impórtalos desde Excel) con su cantidad total. Después crea reservaciones y el sistema cuidará que nunca apartes más de lo que tienes. <Link to={base("m/inventory")} className="font-semibold underline">Ir a Inventario</Link></Alert></div>
      )}
      {(shortages?.length ?? 0) > 0 && (
        <div className="mb-6"><Alert tone="danger" title="Reservaciones sin unidades suficientes">
          Por daños, bajas o cambios de inventario, estas reservaciones apartadas ya no tienen todo lo que necesitan:
          <ul className="mt-2 space-y-1">
            {shortages!.slice(0, 6).map((s) => (
              <li key={`${s.rental_id}-${s.resource_name}`}><Link to={base(`m/reservations/${s.rental_id}`)} className="font-semibold underline">{docNumber("RES", s.rental_number)}</Link> ({formatDate(s.starts_at, { timeZone: region.timezone })}): {s.resource_name}, apartadas {s.requested}, disponibles {Math.max(0, s.available)}.</li>
            ))}
          </ul>
        </Alert></div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Entregas hoy" value={d.deliveries_today} icon={<Truck className="size-4" />}
          hint={d.deliveries_overdue ? <span className="font-semibold text-danger">{d.deliveries_overdue} atrasada{d.deliveries_overdue === 1 ? "" : "s"}</span> : `${d.deliveries_week} en los próximos 7 días`} />
        <Stat label="Por devolver" value={d.returns_pending} icon={<RotateCcw className="size-4" />}
          hint={d.returns_overdue ? <span className="font-semibold text-danger">{d.returns_overdue} atrasada{d.returns_overdue === 1 ? "" : "s"}</span> : `${d.returns_today} vuelven hoy`} />
        <Stat label="En mantenimiento" value={d.maintenance_units} icon={<Wrench className="size-4" />} hint={`de ${d.units.toLocaleString(region.locale)} unidades en ${d.resources} artículos`} />
        {has("finance") ? (
          <Stat label={`Cobrado en ${monthName}`} value={<span className="text-xl">{fmtMap(income)}</span>} icon={<Wallet className="size-4" />}
            hint={Object.keys(d.deposits_held).length ? `Depósitos en custodia: ${fmtMap(d.deposits_held)}` : "Sin depósitos en custodia"} />
        ) : (
          <Stat label="Borradores" value={d.drafts} icon={<CalendarCheck className="size-4" />} hint="Reservaciones sin apartar" />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Próximas entregas" action={has("deliveries") && <Link to={base("m/deliveries")} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent)]">Ver todas<ArrowRight className="size-4" /></Link>} />
          {!nextOut.length ? <p className="px-5 py-8 text-center text-sm text-muted">No hay entregas pendientes.</p> : (
            <ul className="divide-y divide-line">{nextOut.map((r) => (
              <li key={r.id}><Link to={base(`m/reservations/${r.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                <span className={cx("w-24 shrink-0 text-xs", new Date(r.starts_at) < new Date() ? "font-semibold text-danger" : "text-muted")}>{formatDate(r.starts_at, { timeZone: region.timezone, withTime: true })}</span>
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{r.title}</span><span className="block truncate text-xs text-muted">{cust(r.customer_id)}</span></span>
                <RentalStatusBadge r={r} />
              </Link></li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Devoluciones esperadas" action={has("returns") && <Link to={base("m/returns")} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent)]">Ver todas<ArrowRight className="size-4" /></Link>} />
          {!nextBack.length ? <p className="px-5 py-8 text-center text-sm text-muted">No hay artículos fuera.</p> : (
            <ul className="divide-y divide-line">{nextBack.map((r) => (
              <li key={r.id}><Link to={base(`m/reservations/${r.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                <span className={cx("w-24 shrink-0 text-xs", new Date(r.ends_at) < new Date() ? "font-semibold text-danger" : "text-muted")}>{formatDate(r.ends_at, { timeZone: region.timezone, withTime: true })}</span>
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{r.title}</span><span className="block truncate text-xs text-muted">{cust(r.customer_id)}</span></span>
                <RentalStatusBadge r={r} />
              </Link></li>
            ))}</ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {has("inventory") && <QuickLink to={base("m/inventory")} icon={<Boxes className="size-5" />} title="Inventario" text={`${d.resources} artículos · ${d.units.toLocaleString(region.locale)} unidades`} />}
        {has("maintenance") && <QuickLink to={base("m/maintenance")} icon={<Wrench className="size-5" />} title="Daños y mantenimiento" text={d.maintenance_units ? `${d.maintenance_units} unidades fuera de servicio` : "Todo en servicio"} />}
        {has("team") && <QuickLink to={base("m/team")} icon={<ShieldCheck className="size-5" />} title="Equipo" text="Usuarios y permisos" />}
      </div>
      {d.returns_overdue > 0 && <p className="mt-6 flex items-center gap-2 text-sm text-danger"><AlertTriangle className="size-4" />Las devoluciones atrasadas mantienen sus unidades bloqueadas para cualquier fecha hasta que se reciban.</p>}
    </div>
  );
}

function QuickLink({ to, icon, title, text }: { to: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 transition hover:border-line-strong hover:shadow-[var(--shadow-card)]">
      <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">{icon}</span>
      <span className="min-w-0"><span className="block font-semibold">{title}</span><span className="block truncate text-xs text-muted">{text}</span></span>
    </Link>
  );
}
