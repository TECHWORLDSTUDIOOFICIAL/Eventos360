import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarRange, FileSignature, FileText, Plus, UserPlus, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { useEvents } from "@/lib/events";
import { useCustomers, usePayments, useQuotes } from "@/lib/pro";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Button, Card, CardHeader, PageHeader, Spinner, Stat, cx } from "@/components/ui";

interface Dash {
  customers_active: number; customers_leads: number; events_upcoming: number; quotes_sent: number; quotes_sent_total: number;
  contracts_pending: number; income_period: number; expenses_period: number; contracted_total: number; received_total: number;
  followups_due: number; tasks_open: number; tasks_overdue: number;
}

/** Panel Profesional. Todas las cifras salen de los registros reales del espacio. */
export default function ProHome() {
  const { ws, region, readOnly } = useWorkspace();
  const { profile } = useAuth();
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const { data: d, isLoading } = useQuery({
    queryKey: ["pro-dashboard", ws.id, from],
    queryFn: async () => unwrap<Dash>(await supabase.rpc("pro_dashboard", { p_ws: ws.id, p_from: from, p_to: to })),
  });
  const { data: events } = useEvents(ws.id);
  const { data: payments } = usePayments(ws.id);
  const { data: quotes } = useQuotes(ws.id);
  // Montos separados por moneda (nunca se suman córdobas con dólares).
  const byCurrency = (rows: { currency_code: string; amount: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.currency_code, (m.get(r.currency_code) ?? 0) + Number(r.amount));
    return m;
  };
  const fmtMap = (m: Map<string, number>) => {
    const parts = [...m.entries()].filter(([, v]) => Math.abs(v) >= 0.005).map(([c, v]) => formatMoney(v, c, region.locale));
    return parts.length ? parts.join(" · ") : formatMoney(0, region.currency_code, region.locale);
  };
  const monthIncome = byCurrency((payments ?? []).filter((p) => p.paid_at >= from && p.paid_at <= to));
  const contracted = byCurrency((quotes ?? []).filter((q) => q.status === "accepted").map((q) => ({ currency_code: q.currency_code, amount: Number(q.total) })));
  const received = byCurrency(payments ?? []);
  const receivable = new Map<string, number>();
  for (const [c, v] of contracted) receivable.set(c, Math.max(0, v - (received.get(c) ?? 0)));
  const { data: customers } = useCustomers(ws.id);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const upcoming = (events ?? []).filter((e) => e.starts_at && new Date(e.starts_at).getTime() >= Date.now() - 86_400_000 && e.status !== "canceled").slice(0, 6);
  const cust = (id: string | null | undefined) => customers?.find((c) => c.id === id)?.name;
  const monthName = new Intl.DateTimeFormat(region.locale, { month: "long" }).format(now);

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Eventos360 Profesional" title={`Hola, ${profile?.full_name.split(" ")[0] ?? ""}`} description="Tu actividad como organizador de un vistazo."
        actions={!readOnly && <>
          <Link to={base("m/customers")}><Button variant="secondary" icon={<UserPlus className="size-4" />}>Cliente</Button></Link>
          <Link to={base("m/quotes/nueva")}><Button variant="accent" icon={<Plus className="size-4" />}>Cotización</Button></Link>
        </>} />
      {isLoading || !d ? <Spinner /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`Cobrado en ${monthName}`} value={<span className="text-2xl">{fmtMap(monthIncome)}</span>} hint="Pagos recibidos de clientes" icon={<Wallet className="size-4" />} />
            <Stat label="Por cobrar" value={<span className="text-2xl">{fmtMap(receivable)}</span>} hint="Cotizaciones aceptadas menos lo cobrado" />
            <Stat label="Cotizaciones enviadas" value={d.quotes_sent} hint={d.quotes_sent ? `${fmtMap(byCurrency((quotes ?? []).filter((q) => q.status === "sent").map((q) => ({ currency_code: q.currency_code, amount: Number(q.total) }))))} en espera de respuesta` : "Ninguna pendiente"} icon={<FileText className="size-4" />} />
            <Stat label="Próximos eventos" value={d.events_upcoming} hint={`${d.customers_active} clientes activos · ${d.customers_leads} prospectos`} icon={<CalendarRange className="size-4" />} />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Próximos eventos" action={<Link to={base("m/events")} className="text-sm font-semibold text-[var(--accent)]">Ver todos</Link>} />
              {!upcoming.length ? <p className="px-5 py-6 text-sm text-muted">Sin eventos próximos.</p> : (
                <ul className="divide-y divide-line">
                  {upcoming.map((e) => (
                    <li key={e.id}><Link to={base(`m/events/${e.id}`)} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper">
                      <span className="min-w-0"><span className="block truncate font-medium">{e.name}</span><span className="block truncate text-xs text-muted">{cust(e.customer_id) ?? "Sin cliente"}{e.venue_name ? ` · ${e.venue_name}` : ""}</span></span>
                      <span className="shrink-0 text-sm text-muted">{formatDate(e.starts_at, { timeZone: region.timezone, locale: region.locale })}</span>
                    </Link></li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Pendientes" />
              <ul className="divide-y divide-line">
                {[
                  { n: d.followups_due, l: "seguimiento(s) de clientes para hoy o vencidos", to: "m/calendar", warn: d.followups_due > 0 },
                  { n: d.contracts_pending, l: "contrato(s) sin aceptar", to: "m/contracts", icon: FileSignature },
                  { n: d.quotes_sent, l: "cotización(es) esperando respuesta", to: "m/quotes" },
                  { n: d.tasks_overdue, l: `tarea(s) vencida(s) de ${d.tasks_open} abiertas`, to: "m/events", warn: d.tasks_overdue > 0 },
                ].map((x) => (
                  <li key={x.l}><Link to={base(x.to)} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-paper">
                    <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg font-display text-base font-semibold", x.warn ? "bg-warn-soft text-warn" : "bg-[var(--accent-soft)] text-[var(--accent)]")}>{x.n}</span>
                    <span className="flex-1">{x.l}</span><ArrowRight className="size-4 text-faint" />
                  </Link></li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
