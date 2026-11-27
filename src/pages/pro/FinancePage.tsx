import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Download, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useEvents } from "@/lib/events";
import { PAYMENT_KIND, docNumber, useCustomers, usePayments, useQuotes, type Payment } from "@/lib/pro";
import { useRentals } from "@/lib/rental";
import { EXPENSE_CATEGORIES, useBusinessExpenses, type BusinessExpense } from "@/lib/catalog";
import { CustomerSelect, SupplierSelect } from "@/components/QuickCreate";
import { useBookings } from "@/lib/venues";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

const METHODS: Record<string, string> = { transferencia: "Transferencia", deposito: "Depósito", efectivo: "Efectivo", tarjeta: "Tarjeta", billetera: "Billetera electrónica", otro: "Otro" };

interface ExpenseLite { event_id: string; planned_amount: number; agreed_amount: number | null; paid_amount: number }

export default function FinancePage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data: payments, isLoading } = usePayments(ws.id);
  const { data: quotes } = useQuotes(ws.id);
  const { data: events } = useEvents(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const { data: rentalRows } = useRentals(ws.id, { statuses: ["reserved", "out", "returned"] });
  const { data: bookingRows } = useBookings(ws.id);
  const { data: expensesBiz } = useBusinessExpenses(ws.id);
  const expenses = useQuery({
    queryKey: ["ws-expenses", ws.id],
    queryFn: async () => unwrap<ExpenseLite[]>(await supabase.from("event_expenses").select("event_id, planned_amount, agreed_amount, paid_amount").eq("workspace_id", ws.id)),
  });
  const [tab, setTab] = useState<"resumen" | "pagos" | "gastos" | "eventos">("resumen");
  const [currency, setCurrency] = useState(region.currency_code);
  const [period, setPeriod] = useState<"mes" | "anterior" | "anio" | "todo">("mes");
  const [editing, setEditing] = useState<Payment | "new" | null>(null);
  const [editingExp, setEditingExp] = useState<BusinessExpense | "new" | null>(null);
  const money = (n: number, c = currency) => formatMoney(n, c, region.locale);
  const cust = (id: string | null) => customers?.find((c) => c.id === id)?.name ?? "";
  const evName = (id: string | null) => events?.find((e) => e.id === id)?.name ?? "";
  const evDate = (id: string | null) => events?.find((e) => e.id === id)?.starts_at?.slice(0, 10) ?? null;

  // Período (fechas AAAA-MM-DD)
  const range = useMemo(() => {
    const d = new Date(); const y = d.getFullYear(), m = d.getMonth();
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    if (period === "mes") return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
    if (period === "anterior") return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    if (period === "anio") return { from: `${y}-01-01`, to: `${y}-12-31` };
    return { from: "0000-01-01", to: "9999-12-31" };
  }, [period]);
  const inRange = (d: string | null | undefined) => !!d && d >= range.from && d <= range.to;

  // Ventas: cotizaciones aceptadas, reservaciones de alquiler y reservas de espacios. Siempre SIN IVA.
  // Una cotización convertida en reservación se cuenta una sola vez (por la reservación).
  const rentedQuotes = new Set((rentalRows ?? []).map((r) => r.quote_id).filter(Boolean));
  const deals = useMemo(() => [
    ...(quotes ?? []).filter((q) => q.status === "accepted" && !rentedQuotes.has(q.id)).map((q) => ({
      event_id: q.event_id, currency_code: q.currency_code, date: (q.accepted_at ?? q.issue_date).slice(0, 10),
      net: Number(q.subtotal) - Math.min(Number(q.discount_amount), Number(q.subtotal)), cost: Number(q.cost_total ?? 0), gross: Number(q.total), retained: 0 })),
    ...(rentalRows ?? []).map((r) => ({ event_id: r.event_id, currency_code: r.currency_code, date: r.starts_at.slice(0, 10),
      net: Number(r.subtotal) - Math.min(Number(r.discount_amount), Number(r.subtotal)) + Number(r.damage_total), cost: 0, gross: Number(r.total) + Number(r.damage_total), retained: Number(r.deposit_retained) })),
    ...(bookingRows ?? []).filter((b) => b.kind === "event" && (b.status === "confirmed" || b.status === "done")).map((b) => ({ event_id: b.event_id, currency_code: b.currency_code, date: b.starts_at.slice(0, 10),
      net: Number(b.subtotal) - Math.min(Number(b.discount_amount), Number(b.subtotal)), cost: Number(b.cost_total ?? 0), gross: Number(b.total), retained: Number(b.deposit_retained) })),
  ], [quotes, rentalRows, bookingRows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Costos de cada evento: el mayor entre lo estimado en sus cotizaciones y los gastos registrados en el evento.
  const eventExpense = (id: string) => (expenses.data ?? []).filter((x) => x.event_id === id).reduce((s, x) => s + Number(x.agreed_amount ?? x.planned_amount), 0);
  const byEvent = useMemo(() => {
    const rows = (events ?? []).filter((e) => e.currency_code === currency || deals.some((d) => d.event_id === e.id && d.currency_code === currency)).map((e) => {
      const ds = deals.filter((d) => d.event_id === e.id && d.currency_code === currency);
      const net = ds.reduce((s, d) => s + d.net, 0);
      const estimated = ds.reduce((s, d) => s + d.cost, 0);
      const real = e.currency_code === currency ? eventExpense(e.id) : 0;
      const costs = Math.max(estimated, real);
      const received = (payments ?? []).filter((p) => p.event_id === e.id && p.currency_code === currency).reduce((s, p) => s + Number(p.amount), 0);
      return { e, net, costs, received, profit: net - costs };
    }).filter((r) => r.net || r.received || r.costs);
    return rows.sort((a, b) => (b.e.starts_at ?? "").localeCompare(a.e.starts_at ?? ""));
  }, [events, deals, payments, expenses.data, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resultado del período
  const pd = deals.filter((d) => d.currency_code === currency && inRange(d.date));
  const sales = pd.reduce((s, d) => s + d.net, 0);
  const tax = pd.reduce((s, d) => s + (d.gross - d.net), 0);
  const eventIds = new Set(pd.map((d) => d.event_id).filter(Boolean) as string[]);
  // Costos del período: por evento (mayor entre estimado y real) + ventas sin evento (estimado)
  const costOfSales = [...eventIds].reduce((s, id) => s + Math.max(pd.filter((d) => d.event_id === id).reduce((a, d) => a + d.cost, 0), (events ?? []).find((e) => e.id === id)?.currency_code === currency ? eventExpense(id) : 0), 0)
    + pd.filter((d) => !d.event_id).reduce((s, d) => s + d.cost, 0);
  const overhead = (expensesBiz ?? []).filter((x) => x.currency_code === currency && inRange(x.spent_at)).reduce((s, x) => s + Number(x.amount), 0);
  const result = sales - costOfSales - overhead;
  const collected = (payments ?? []).filter((p) => p.currency_code === currency && inRange(p.paid_at)).reduce((s, p) => s + Number(p.amount), 0);
  // Por cobrar: de todo el historial (total con IVA − pagado − daños cubiertos con depósito)
  const allGross = deals.filter((d) => d.currency_code === currency).reduce((s, d) => s + d.gross, 0);
  const allPaid = (payments ?? []).filter((p) => p.currency_code === currency).reduce((s, p) => s + Number(p.amount), 0);
  const allRetained = deals.filter((d) => d.currency_code === currency).reduce((s, d) => s + d.retained, 0);
  const receivable = Math.max(0, allGross - allPaid - allRetained);
  const periodLabel = { mes: "este mes", anterior: "el mes pasado", anio: "este año", todo: "todo el historial" }[period];

  // Ingresos por mes (últimos 6 meses)
  const months = useMemo(() => {
    const out: { key: string; label: string; income: number }[] = [];
    const d = new Date();
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
      out.push({ key, label: new Intl.DateTimeFormat(region.locale, { month: "short" }).format(m), income: 0 });
    }
    for (const p of payments ?? []) {
      if (p.currency_code !== currency) continue;
      const row = out.find((o) => o.key === p.paid_at.slice(0, 7));
      if (row) row.income += Number(p.amount);
    }
    return out;
  }, [payments, currency, region.locale]);
  const maxIncome = Math.max(1, ...months.map((m) => m.income));

  async function exportExcel() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const header = ["Fecha", "Cliente", "Evento", "Tipo", "Método", "Referencia", "Moneda", "Monto"].map((value) => ({ value, fontWeight: "bold" as const }));
    const rows = (payments ?? []).map((p) => [p.paid_at, cust(p.customer_id), evName(p.event_id), PAYMENT_KIND[p.kind], METHODS[p.method] ?? p.method, p.reference ?? "", p.currency_code, Number(p.amount)].map((value) => ({ value: value as string | number })));
    await writeXlsxFile([header, ...rows], { columns: [{ width: 12 }, { width: 24 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 8 }, { width: 12 }] }).toFile("Pagos recibidos.xlsx");
  }
  void evDate;

  return (
    <div className="animate-rise">
      <PageHeader title="Finanzas" description="Cuánto vendiste, cuánto te costó y cuánto te quedó de verdad (sin IVA y después de los gastos del negocio)."
        actions={<>
          <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="h-10 w-auto" aria-label="Período"><option value="mes">Este mes</option><option value="anterior">Mes pasado</option><option value="anio">Este año</option><option value="todo">Todo</option></Select>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 w-auto" aria-label="Moneda"><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Registrar pago</Button>}
        </>} />

      {/* El resultado real, como un estado de resultados simple */}
      <Card className="mb-5">
        <CardHeader title={`Resultado de ${periodLabel}`} description="Ventas sin IVA − costo de lo vendido − gastos del negocio." />
        <div className="grid gap-px bg-line sm:grid-cols-4">
          {[
            { l: "Ventas (sin IVA)", v: money(sales), h: tax > 0 ? `+ ${money(tax)} de IVA que va a la DGI` : "Cotizaciones aceptadas y reservas" },
            { l: "Costo de lo vendido", v: `− ${money(costOfSales)}`, h: "Materiales, personal, proveedores" },
            { l: "Gastos del negocio", v: `− ${money(overhead)}`, h: "Alquiler, salarios, luz…", action: () => setTab("gastos") },
            { l: result >= 0 ? "Te quedó" : "Perdiste", v: money(result), h: sales > 0 ? `${Math.round((result / sales) * 100)}% de lo vendido` : "", strong: true, bad: result < 0 },
          ].map((s) => (
            <button key={s.l} type="button" onClick={s.action} disabled={!s.action} className={cx("bg-card p-4 text-left", s.action && "hover:bg-paper")}>
              <div className="text-xs text-muted">{s.l}</div>
              <div className={cx("mt-1 font-display font-semibold tabular-nums", s.strong ? "text-2xl" : "text-xl", s.bad ? "text-danger" : s.strong && "text-ok")}>{s.v}</div>
              <div className="text-xs text-muted">{s.h}</div>
            </button>
          ))}
        </div>
        {costOfSales === 0 && sales > 0 && <p className="border-t border-line px-5 py-3 text-xs text-warn">No hay costos registrados en tus ventas de este período: el resultado parece más alto de lo que es. Agrega el costo de cada línea en tus cotizaciones o usa servicios del catálogo con costos.</p>}
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <Card className="p-4"><div className="text-xs text-muted">Cobrado {periodLabel}</div><div className="mt-1 font-display text-xl font-semibold tabular-nums">{money(collected)}</div><div className="text-xs text-muted">Pagos recibidos de clientes</div></Card>
        <Card className="p-4"><div className="text-xs text-muted">Por cobrar</div><div className={cx("mt-1 font-display text-xl font-semibold tabular-nums", receivable > 0 && "text-warn")}>{money(receivable)}</div><div className="text-xs text-muted">Saldos pendientes de clientes (con IVA)</div></Card>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {([["resumen", "Cobros por mes"], ["pagos", "Pagos recibidos"], ["gastos", "Gastos del negocio"], ["eventos", "Ganancia por evento"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>

      {isLoading ? <Spinner /> : tab === "resumen" ? (
        <Card>
          <CardHeader title="Cobros de los últimos 6 meses" description={currency === "USD" ? "En dólares" : "En córdobas"} />
          <div className="flex h-56 items-end gap-3 px-5 pb-4 pt-6">
            {months.map((m) => (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-2">
                <div className="text-[11px] tabular-nums text-muted">{m.income ? money(m.income).replace(/\.00$/, "") : ""}</div>
                <div className="w-full max-w-14 rounded-t-lg bg-[var(--accent)]" style={{ height: `${Math.max(2, (m.income / maxIncome) * 150)}px`, opacity: m.income ? 1 : 0.15 }} />
                <div className="text-xs font-medium capitalize text-muted">{m.label}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : tab === "pagos" ? (
        <Card>
          <div className="flex justify-end border-b border-line p-3"><Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportExcel()} disabled={!payments?.length}>Exportar Excel</Button></div>
          {!payments?.length ? (
            <EmptyState icon={<BadgeDollarSign className="size-6" />} title="Sin pagos registrados">Registra cada anticipo, cuota o pago final que recibas de tus clientes.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                  <span className="w-24 text-sm text-muted">{formatDate(`${p.paid_at}T12:00:00Z`, { timeZone: "UTC" })}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{cust(p.customer_id)}</span>
                    <span className="block truncate text-xs text-muted">{[PAYMENT_KIND[p.kind], METHODS[p.method], evName(p.event_id), p.reference && `Ref. ${p.reference}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatMoney(Number(p.amount), p.currency_code, region.locale)}</span>
                  {!readOnly && <button onClick={() => setEditing(p)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label="Editar pago"><Pencil className="size-4" /></button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : tab === "gastos" ? (
        <Card>
          <CardHeader title="Gastos del negocio" description="Lo que pagas para operar aunque no haya eventos: alquiler, salarios, luz, internet, publicidad, combustible…"
            action={!readOnly && <Button size="sm" variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditingExp("new")}>Registrar gasto</Button>} />
          {!expensesBiz?.length ? (
            <EmptyState icon={<Receipt className="size-6" />} title="Sin gastos registrados">Anota tus gastos fijos y generales para saber cuánto te queda de verdad cada mes.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {expensesBiz.filter((x) => inRange(x.spent_at)).map((x) => (
                <li key={x.id}><button disabled={readOnly} onClick={() => setEditingExp(x)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-paper sm:px-5">
                  <span className="w-24 text-sm text-muted">{formatDate(`${x.spent_at}T12:00:00Z`, { timeZone: "UTC" })}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{x.description}</span><span className="block truncate text-xs text-muted">{EXPENSE_CATEGORIES[x.category] ?? x.category}</span></span>
                  <span className="font-semibold tabular-nums">−{formatMoney(Number(x.amount), x.currency_code, region.locale)}</span>
                </button></li>
              ))}
              {!expensesBiz.some((x) => inRange(x.spent_at)) && <li className="px-5 py-6 text-center text-sm text-muted">Sin gastos en {periodLabel}.</li>}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          {!byEvent.length ? <EmptyState title="Sin eventos con movimientos">Cuando tengas cotizaciones aceptadas, pagos o costos en eventos, verás aquí la ganancia de cada uno.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <tr><th className="px-5 py-3 font-semibold">Evento</th><th className="px-3 py-3 text-right font-semibold">Venta sin IVA</th><th className="px-3 py-3 text-right font-semibold">Cobrado</th>
                    <th className="px-3 py-3 text-right font-semibold">Costos</th><th className="px-3 py-3 text-right font-semibold">Ganancia</th><th className="px-5 py-3 text-right font-semibold">Margen</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {byEvent.map((r) => (
                    <tr key={r.e.id}>
                      <td className="px-5 py-3"><Link to={workspacePath(ws.kind, ws.id, `m/events/${r.e.id}`)} className="font-medium hover:underline">{r.e.name}</Link>
                        <div className="text-xs text-muted">{r.e.starts_at ? formatDate(r.e.starts_at, { timeZone: region.timezone }) : ""}</div></td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(r.net)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(r.received)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(r.costs)}</td>
                      <td className={cx("px-3 py-3 text-right font-semibold tabular-nums", r.profit < 0 && "text-danger")}>{money(r.profit)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r.net ? `${Math.round((r.profit / r.net) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-5 py-3 text-xs text-muted">Venta sin IVA. Costos: el mayor entre lo estimado en las cotizaciones y los gastos registrados en el evento (para no contarlo dos veces). Los gastos fijos del negocio no se reparten por evento.</p>
        </Card>
      )}
      {editing && <PaymentDialog payment={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      {editingExp && <ExpenseDialog expense={editingExp === "new" ? null : editingExp} onClose={() => setEditingExp(null)} />}
    </div>
  );
}

function ExpenseDialog({ expense, onClose }: { expense: BusinessExpense | null; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({
    spent_at: expense?.spent_at ?? new Date().toISOString().slice(0, 10), category: expense?.category ?? "alquiler", description: expense?.description ?? "",
    amount: expense ? String(expense.amount) : "", currency_code: expense?.currency_code ?? region.currency_code, supplier_id: expense?.supplier_id ?? "", method: expense?.method ?? "transferencia", notes: expense?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.description.trim().length < 2) return setError("Describe el gasto.");
    if (!(Number(f.amount) > 0)) return setError("Indica el monto.");
    setBusy(true);
    const row = { spent_at: f.spent_at, category: f.category, description: f.description.trim(), amount: Number(f.amount), currency_code: f.currency_code, supplier_id: f.supplier_id || null, method: f.method || null, notes: f.notes.trim() || null };
    const res = expense ? await supabase.from("business_expenses").update(row).eq("id", expense.id) : await supabase.from("business_expenses").insert({ ...row, workspace_id: ws.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await qc.invalidateQueries({ queryKey: ["business-expenses", ws.id] });
    onClose();
  }
  async function remove() {
    if (!expense || !confirm("¿Eliminar este gasto?")) return;
    await supabase.from("business_expenses").delete().eq("id", expense.id);
    await qc.invalidateQueries({ queryKey: ["business-expenses", ws.id] });
    onClose();
  }
  return (
    <Dialog open onClose={onClose} title={expense ? "Editar gasto" : "Registrar gasto del negocio"}
      footer={<>
        {expense && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="expense-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="expense-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo de gasto">{(id) => <Select id={id} value={f.category} onChange={(e) => set("category", e.target.value)}>{Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Fecha">{(id) => <Input id={id} type="date" value={f.spent_at} onChange={(e) => set("spent_at", e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label="Descripción">{(id) => <Input id={id} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Ej. Alquiler de bodega de noviembre" autoFocus />}</Field></div>
        <div className="grid grid-cols-[1fr_150px] gap-2 sm:col-span-2">
          <Field label="Monto">{(id) => <Input id={id} type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>}</Field>
        </div>
        <Field label="Pagado a" optional>{(id) => <SupplierSelect id={id} value={f.supplier_id} onChange={(v) => set("supplier_id", v)} emptyLabel="—" />}</Field>
        <Field label="Método">{(id) => <Select id={id} value={f.method} onChange={(e) => set("method", e.target.value)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}

export function PaymentDialog({ payment, defaults, onClose, onSaved }: {
  payment?: Payment | null; defaults?: Partial<Pick<Payment, "customer_id" | "event_id" | "quote_id" | "rental_id" | "booking_id" | "currency_code" | "amount" | "kind">>;
  onClose: () => void; onSaved: () => void;
}) {
  const { ws, region } = useWorkspace();
  const qc = useQueryClient();
  const { data: events } = useEvents(ws.id);
  const { data: quotes } = useQuotes(ws.id);
  const [f, setF] = useState({
    customer_id: payment?.customer_id ?? defaults?.customer_id ?? "", event_id: payment?.event_id ?? defaults?.event_id ?? "",
    quote_id: payment?.quote_id ?? defaults?.quote_id ?? "", rental_id: payment?.rental_id ?? defaults?.rental_id ?? "", booking_id: payment?.booking_id ?? defaults?.booking_id ?? "", kind: payment?.kind ?? defaults?.kind ?? "deposit",
    amount: String(payment?.amount ?? defaults?.amount ?? ""), currency_code: payment?.currency_code ?? defaults?.currency_code ?? region.currency_code,
    method: payment?.method ?? "transferencia", reference: payment?.reference ?? "", paid_at: payment?.paid_at ?? new Date().toISOString().slice(0, 10), notes: payment?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.customer_id) return setError("Elige el cliente.");
    if (!(Number(f.amount) > 0)) return setError("Ingresa un monto válido.");
    setBusy(true);
    const row = { customer_id: f.customer_id, event_id: f.event_id || null, quote_id: f.quote_id || null, rental_id: f.rental_id || null, booking_id: f.booking_id || null, kind: f.kind, amount: Number(f.amount),
      currency_code: f.currency_code, method: f.method, reference: f.reference.trim() || null, paid_at: f.paid_at, notes: f.notes.trim() || null };
    const res = payment ? await supabase.from("customer_payments").update(row).eq("id", payment.id) : await supabase.from("customer_payments").insert({ ...row, workspace_id: ws.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await qc.invalidateQueries({ queryKey: ["payments", ws.id] });
    await qc.invalidateQueries({ queryKey: ["rental-payments"] });
    onSaved();
  }
  async function remove() {
    if (!payment || !confirm("¿Eliminar este pago?")) return;
    const { error: err } = await supabase.from("customer_payments").delete().eq("id", payment.id);
    if (err) return setError(err.message);
    await qc.invalidateQueries({ queryKey: ["payments", ws.id] });
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={payment ? "Editar pago" : "Registrar pago recibido"} wide
      footer={<>
        {payment && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="payment-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="payment-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Cliente">{(id) => <CustomerSelect id={id} value={f.customer_id} onChange={(v) => setF((s) => ({ ...s, customer_id: v, event_id: "", quote_id: "", rental_id: "", booking_id: "" }))} />}</Field>
        <Field label="Evento" optional>{(id) => <Select id={id} value={f.event_id} onChange={(e) => set("event_id", e.target.value)}><option value="">Sin evento</option>{(events ?? []).filter((e) => e.customer_id === f.customer_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>}</Field>
        <Field label="Cotización" optional>{(id) => <Select id={id} value={f.quote_id} onChange={(e) => set("quote_id", e.target.value)}><option value="">Ninguna</option>{(quotes ?? []).filter((q) => q.customer_id === f.customer_id).map((q) => <option key={q.id} value={q.id}>{docNumber("COT", q.number)} · {q.title}</option>)}</Select>}</Field>
        <Field label="Tipo">{(id) => <Select id={id} value={f.kind} onChange={(e) => set("kind", e.target.value)}>{Object.entries(PAYMENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <div className="grid grid-cols-[1fr_150px] gap-2">
          <Field label="Monto">{(id) => <Input id={id} type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>}</Field>
        </div>
        <Field label="Fecha">{(id) => <Input id={id} type="date" value={f.paid_at} onChange={(e) => set("paid_at", e.target.value)} />}</Field>
        <Field label="Método">{(id) => <Select id={id} value={f.method} onChange={(e) => set("method", e.target.value)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Referencia" optional>{(id) => <Input id={id} value={f.reference} onChange={(e) => set("reference", e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
