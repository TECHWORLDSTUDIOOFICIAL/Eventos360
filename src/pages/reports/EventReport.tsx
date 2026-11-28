import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { daysUntil, formatDate, formatMoney, plural } from "@/lib/format";
import { guestName, useEventSummary, useGuestGroups, useGuests, type EventRow } from "@/lib/events";
import { EXPENSE_CATEGORIES, useExpenses, type ExpenseRow } from "@/pages/personal/BudgetPage";
import { useSuppliers } from "@/pages/personal/SuppliersPage";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Badge, Button, Card, CardHeader, PageHeader, Spinner, cx } from "@/components/ui";
import { KPI, RankBars } from "./charts";

interface TaskRow { id: string; title: string; due_date: string | null; priority: "low" | "medium" | "high"; status: "todo" | "doing" | "done" }
const cost = (e: ExpenseRow) => Number(e.agreed_amount ?? e.planned_amount);

/** Reporte del evento (plan Personal): presupuesto, pagos, proveedores, invitados y tareas en una sola página. */
export default function EventReportPage() {
  return <EventGate>{(ctx) => <EventReport {...ctx} />}</EventGate>;
}

export function EventReport({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { region } = useWorkspace();
  const { data: s } = useEventSummary(event.id);
  const { data: expenses, isLoading } = useExpenses(event.id);
  const { data: guests } = useGuests(event.id);
  const { data: groups } = useGuestGroups(event.id);
  const { data: suppliers } = useSuppliers();
  const { data: tasks } = useQuery({
    queryKey: ["tasks", event.id],
    queryFn: async () => unwrap<TaskRow[]>(await supabase.from("event_tasks").select("*").eq("event_id", event.id).order("due_date", { nullsFirst: false })),
  });
  const money = (n: number) => formatMoney(n, event.currency_code, region.locale);
  const today = new Date().toISOString().slice(0, 10);
  const dateText = (d: string) => formatDate(`${d}T12:00:00Z`, { timeZone: "UTC" });
  const days = daysUntil(event.starts_at);

  const ex = expenses ?? [];
  const committed = ex.reduce((t, e) => t + cost(e), 0);
  const paid = ex.reduce((t, e) => t + Number(e.paid_amount), 0);
  const budget = Number(event.budget);
  const byCat = Object.entries(ex.reduce<Record<string, { planned: number; committed: number; paid: number }>>((acc, e) => {
    const c = (acc[e.category] ??= { planned: 0, committed: 0, paid: 0 });
    c.planned += Number(e.planned_amount); c.committed += cost(e); c.paid += Number(e.paid_amount);
    return acc;
  }, {})).sort((a, b) => b[1].committed - a[1].committed);
  const dueSoon = ex.filter((e) => e.due_date && cost(e) - Number(e.paid_amount) > 0.005).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const bySupplier = Object.entries(ex.filter((e) => e.supplier_id).reduce<Record<string, { committed: number; paid: number }>>((acc, e) => {
    const c = (acc[e.supplier_id!] ??= { committed: 0, paid: 0 }); c.committed += cost(e); c.paid += Number(e.paid_amount); return acc;
  }, {})).sort((a, b) => b[1].committed - a[1].committed);
  const supplierName = (id: string) => suppliers?.find((x) => x.id === id)?.name ?? "Proveedor";
  const g = guests ?? [];
  const people = (st: string[]) => g.filter((x) => st.includes(x.status)).reduce((t, x) => t + (x.status === "confirmed" ? Number(x.adults) + Number(x.children) : Number(x.max_companions) + 1), 0);
  const byGroup = [...(groups ?? []).map((gr) => ({ id: gr.id, name: gr.name })), { id: "", name: "Sin grupo" }].map((gr) => {
    const list = g.filter((x) => (x.group_id ?? "") === gr.id);
    return { ...gr, invites: list.length, confirmed: list.filter((x) => x.status === "confirmed").reduce((t, x) => t + Number(x.adults) + Number(x.children), 0), pending: list.filter((x) => x.status === "pending" || x.status === "invited").length };
  }).filter((x) => x.invites > 0);
  const t = tasks ?? [];
  const overdue = t.filter((x) => x.status !== "done" && x.due_date && x.due_date < today);
  const upcoming = t.filter((x) => x.status !== "done" && x.due_date && x.due_date >= today).slice(0, 8);
  const noShows = g.filter((x) => x.status === "pending" || x.status === "invited");

  async function exportExcel() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const head = (cols: string[]) => cols.map((value) => ({ value, fontWeight: "bold" as const }));
    const row = (vals: (string | number | null)[]) => vals.map((value) => ({ value: value ?? "" }));
    await writeXlsxFile([
      { sheet: "Presupuesto", columns: [{ width: 22 }, { width: 30 }, { width: 22 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 12 }],
        data: [head(["Categoría", "Concepto", "Proveedor", "Estimado", "Acordado", "Pagado", "Falta", "Fecha límite"]),
          ...ex.map((e) => row([EXPENSE_CATEGORIES[e.category] ?? e.category, e.concept, e.supplier_id ? supplierName(e.supplier_id) : "", Number(e.planned_amount), e.agreed_amount == null ? "" : Number(e.agreed_amount), Number(e.paid_amount), cost(e) - Number(e.paid_amount), e.due_date ?? ""]))] },
      { sheet: "Invitados", columns: [{ width: 28 }, { width: 18 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 14 }],
        data: [head(["Nombre", "Grupo", "Estado", "Adultos", "Niños", "Teléfono"]),
          ...g.map((x) => row([guestName(x), groups?.find((gr) => gr.id === x.group_id)?.name ?? "", { pending: "Pendiente", invited: "Invitado", confirmed: "Confirmó", declined: "No asistirá" }[x.status], x.adults, x.children, x.phone ?? ""]))] },
      { sheet: "Tareas", columns: [{ width: 40 }, { width: 12 }, { width: 12 }],
        data: [head(["Tarea", "Fecha", "Estado"]), ...t.map((x) => row([x.title, x.due_date ?? "", { todo: "Pendiente", doing: "En proceso", done: "Hecha" }[x.status]]))] },
    ]).toFile(`Reporte ${event.name}.xlsx`);
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Reporte del evento" description="Todo tu evento en una página: cuánto llevas gastado y pagado, qué pagos vienen, cómo van los invitados y las tareas."
        actions={<>
          {events.length > 1 && <span className="print:hidden"><EventSwitcher events={events} current={event} onSelect={select} /></span>}
          <Button variant="secondary" className="print:hidden" icon={<Download className="size-4" />} onClick={() => void exportExcel()}>Excel</Button>
          <Button variant="secondary" className="print:hidden" icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button>
        </>} />

      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold">{event.name}</h2>
          {event.starts_at && <span className="text-sm text-muted">{formatDate(event.starts_at, { timeZone: region.timezone, withTime: true })}{days != null && days >= 0 ? ` · faltan ${plural(days, "día", "días")}` : ""}</span>}
        </div>
        {event.venue_name && <p className="mt-1 text-sm text-muted">{event.venue_name}</p>}
      </Card>

      {isLoading ? <Spinner /> : (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Dinero" description={budget ? `Tu presupuesto es ${money(budget)}.` : "Define tu presupuesto en Mi evento para compararlo."} />
            <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
              <KPI label="Comprometido" value={money(committed)} hint={budget ? `${Math.round((committed / budget) * 100)}% del presupuesto` : "acordado o estimado"} tone={budget && committed > budget ? "danger" : undefined} />
              <KPI label="Pagado" value={money(paid)} hint={committed ? `${Math.round((paid / committed) * 100)}% de lo comprometido` : undefined} />
              <KPI label="Falta pagar" value={money(Math.max(0, committed - paid))} />
              <KPI label={budget && committed > budget ? "Te pasaste por" : "Te queda disponible"} value={budget ? money(Math.abs(budget - committed)) : "—"} tone={budget ? (committed > budget ? "danger" : "ok") : undefined} />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader title="En qué se va el dinero" description="Lo comprometido por categoría." />
              <RankBars format={money} empty="Aún no registras gastos en tu presupuesto." rows={byCat.map(([k, v]) => ({ key: k, label: EXPENSE_CATEGORIES[k] ?? k, value: v.committed,
                note: v.paid >= v.committed - 0.005 && v.committed > 0 ? "pagado" : `pagado ${money(v.paid)}` }))} />
            </Card>
            <Card>
              <CardHeader title="Próximos pagos" description="Lo que falta pagar, por fecha límite." />
              {!dueSoon.length ? <p className="px-5 pb-5 text-sm text-muted">No tienes pagos pendientes con fecha.</p> : (
                <ul className="divide-y divide-line">{dueSoon.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className={cx("w-24 shrink-0", e.due_date! < today ? "font-semibold text-danger" : "text-muted")}>{dateText(e.due_date!)}</span>
                    <span className="min-w-0 flex-1 truncate">{e.concept}{e.supplier_id && <span className="text-muted"> · {supplierName(e.supplier_id)}</span>}</span>
                    <span className="font-semibold tabular-nums">{money(cost(e) - Number(e.paid_amount))}</span>
                  </li>))}
                </ul>
              )}
            </Card>
          </div>

          {bySupplier.length > 0 && (
            <Card>
              <CardHeader title="Proveedores" description="Cuánto acordaste con cada uno, cuánto le pagaste y cuánto le debes." />
              <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm tabular-nums">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><tr><th className="px-5 py-2 font-semibold">Proveedor</th><th className="px-3 py-2 text-right font-semibold">Acordado</th><th className="px-3 py-2 text-right font-semibold">Pagado</th><th className="px-5 py-2 text-right font-semibold">Falta</th></tr></thead>
                <tbody className="divide-y divide-line">{bySupplier.map(([id, v]) => (
                  <tr key={id}><td className="px-5 py-2.5">{supplierName(id)}</td><td className="px-3 text-right">{money(v.committed)}</td><td className="px-3 text-right">{money(v.paid)}</td>
                    <td className={cx("px-5 text-right font-semibold", v.committed - v.paid > 0.005 ? "text-warn" : "text-ok")}>{v.committed - v.paid > 0.005 ? money(v.committed - v.paid) : "Pagado"}</td></tr>))}</tbody>
              </table></div>
            </Card>
          )}

          <Card>
            <CardHeader title="Invitados" description={g.length ? `${plural(g.length, "invitación", "invitaciones")}. Esperas hasta ${plural(people(["pending", "invited", "confirmed"]), "persona", "personas")} (sin contar a quienes dijeron que no).` : "Aún no agregas invitados."} />
            <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
              <KPI label="Confirmaron" value={plural(s?.people_confirmed ?? 0, "persona", "personas")} hint={`${plural(s?.adults_confirmed ?? 0, "adulto", "adultos")} · ${plural(s?.children_confirmed ?? 0, "niño", "niños")}`} tone="ok" />
              <KPI label="Sin responder" value={plural(s?.guests_pending ?? 0, "invitación", "invitaciones")} />
              <KPI label="No asistirán" value={plural(s?.guests_declined ?? 0, "invitación", "invitaciones")} />
              <KPI label="Sentados en mesas" value={`${s?.seated_people ?? 0} de ${s?.seats_total ?? 0}`} hint={s?.tables_total ? plural(s.tables_total, "mesa", "mesas") : "sin mesas"} />
            </div>
            {byGroup.length > 0 && (
              <div className="overflow-x-auto border-t border-line"><table className="w-full min-w-[420px] text-sm tabular-nums">
                <thead className="text-left text-xs uppercase tracking-wider text-muted"><tr><th className="px-5 py-2 font-semibold">Grupo</th><th className="px-3 py-2 text-right font-semibold">Invitaciones</th><th className="px-3 py-2 text-right font-semibold">Personas confirmadas</th><th className="px-5 py-2 text-right font-semibold">Sin responder</th></tr></thead>
                <tbody className="divide-y divide-line">{byGroup.map((x) => (
                  <tr key={x.id || "none"}><td className="px-5 py-2">{x.name}</td><td className="px-3 text-right">{x.invites}</td><td className="px-3 text-right">{x.confirmed}</td><td className={cx("px-5 text-right", x.pending > 0 && "text-warn")}>{x.pending}</td></tr>))}</tbody>
              </table></div>
            )}
            {noShows.length > 0 && noShows.length <= 30 && <p className="border-t border-line px-5 py-3 text-xs text-muted">Falta que respondan: {noShows.map(guestName).join(", ")}.</p>}
          </Card>

          <Card>
            <CardHeader title="Tareas" description={t.length ? `${t.filter((x) => x.status === "done").length} de ${t.length} hechas.` : "Aún no tienes tareas."} />
            {t.length > 0 && <div className="mx-5 mb-4 h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${(t.filter((x) => x.status === "done").length / t.length) * 100}%` }} /></div>}
            {[["Atrasadas", overdue, "danger"], ["Próximas", upcoming, "neutral"]].map(([title, list, tone]) => (list as TaskRow[]).length > 0 && (
              <div key={title as string} className="border-t border-line px-5 py-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title as string}</div>
                <ul className="space-y-1.5 text-sm">{(list as TaskRow[]).map((x) => (
                  <li key={x.id} className="flex items-center gap-3"><span className={cx("w-24 shrink-0", tone === "danger" ? "font-semibold text-danger" : "text-muted")}>{dateText(x.due_date!)}</span><span className="flex-1">{x.title}</span>
                    {x.priority === "high" && <Badge tone="warn">Prioridad alta</Badge>}</li>))}</ul>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
