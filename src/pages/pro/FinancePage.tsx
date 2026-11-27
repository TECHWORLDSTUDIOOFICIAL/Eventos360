import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useEvents } from "@/lib/events";
import { PAYMENT_KIND, docNumber, useCustomers, usePayments, useQuotes, type Payment } from "@/lib/pro";
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
  const expenses = useQuery({
    queryKey: ["ws-expenses", ws.id],
    queryFn: async () => unwrap<ExpenseLite[]>(await supabase.from("event_expenses").select("event_id, planned_amount, agreed_amount, paid_amount").eq("workspace_id", ws.id)),
  });
  const [tab, setTab] = useState<"resumen" | "pagos" | "eventos">("resumen");
  const [currency, setCurrency] = useState(region.currency_code);
  const [editing, setEditing] = useState<Payment | "new" | null>(null);
  const money = (n: number, c = currency) => formatMoney(n, c, region.locale);
  const cust = (id: string | null) => customers?.find((c) => c.id === id)?.name ?? "";
  const evName = (id: string | null) => events?.find((e) => e.id === id)?.name ?? "";

  // Por evento: contratado (cotizaciones aceptadas), cobrado, costos y ganancia. Solo en la moneda elegida.
  const byEvent = useMemo(() => {
    const rows = (events ?? []).map((e) => {
      const acc = (quotes ?? []).filter((q) => q.event_id === e.id && q.status === "accepted" && q.currency_code === currency);
      const contracted = acc.reduce((s, q) => s + Number(q.total), 0);
      const received = (payments ?? []).filter((p) => p.event_id === e.id && p.currency_code === currency).reduce((s, p) => s + Number(p.amount), 0);
      const ex = e.currency_code === currency ? (expenses.data ?? []).filter((x) => x.event_id === e.id) : [];
      const costs = ex.reduce((s, x) => s + Number(x.agreed_amount ?? x.planned_amount), 0);
      const paidOut = ex.reduce((s, x) => s + Number(x.paid_amount), 0);
      return { e, contracted, received, costs, paidOut, profit: contracted - costs };
    }).filter((r) => r.contracted || r.received || r.costs);
    return rows.sort((a, b) => (b.e.starts_at ?? "").localeCompare(a.e.starts_at ?? ""));
  }, [events, quotes, payments, expenses.data, currency]);

  const totals = byEvent.reduce((t, r) => ({ contracted: t.contracted + r.contracted, received: t.received + r.received, costs: t.costs + r.costs, paidOut: t.paidOut + r.paidOut }),
    { contracted: 0, received: 0, costs: 0, paidOut: 0 });
  const receivable = Math.max(0, totals.contracted - totals.received);

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

  return (
    <div className="animate-rise">
      <PageHeader title="Finanzas" description="Lo que contrataste, lo que cobraste, lo que gastaste y cuánto ganas por evento."
        actions={<>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 w-auto" aria-label="Moneda"><option>NIO</option><option>USD</option></Select>
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Registrar pago</Button>}
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Contratado", v: money(totals.contracted), h: "Cotizaciones aceptadas" },
          { l: "Cobrado", v: money(totals.received), h: "Pagos de clientes" },
          { l: "Por cobrar", v: money(receivable), h: "Saldo pendiente de clientes", warn: receivable > 0 },
          { l: "Ganancia estimada", v: money(totals.contracted - totals.costs), h: `Costos ${money(totals.costs)}`, bad: totals.contracted - totals.costs < 0 },
        ].map((s) => (
          <Card key={s.l} className="p-4">
            <div className="text-xs text-muted">{s.l}</div>
            <div className={cx("mt-1 font-display text-xl font-semibold tabular-nums sm:text-2xl", s.warn && "text-warn", s.bad && "text-danger")}>{s.v}</div>
            <div className="text-xs text-muted">{s.h}</div>
          </Card>
        ))}
      </div>

      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        {([["resumen", "Resumen"], ["pagos", "Pagos recibidos"], ["eventos", "Rentabilidad por evento"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>

      {isLoading ? <Spinner /> : tab === "resumen" ? (
        <Card>
          <CardHeader title="Cobros de los últimos 6 meses" description={`En ${currency}`} />
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
      ) : (
        <Card>
          {!byEvent.length ? <EmptyState title={`Sin movimientos en ${currency}`}>Cuando tengas cotizaciones aceptadas, pagos o costos en eventos, verás aquí la ganancia de cada uno.</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <tr><th className="px-5 py-3 font-semibold">Evento</th><th className="px-3 py-3 text-right font-semibold">Contratado</th><th className="px-3 py-3 text-right font-semibold">Cobrado</th>
                    <th className="px-3 py-3 text-right font-semibold">Costos</th><th className="px-3 py-3 text-right font-semibold">Ganancia</th><th className="px-5 py-3 text-right font-semibold">Margen</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {byEvent.map((r) => (
                    <tr key={r.e.id}>
                      <td className="px-5 py-3"><Link to={workspacePath(ws.kind, ws.id, `m/events/${r.e.id}`)} className="font-medium hover:underline">{r.e.name}</Link>
                        <div className="text-xs text-muted">{r.e.starts_at ? formatDate(r.e.starts_at, { timeZone: region.timezone }) : ""}</div></td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(r.contracted)}</td>
                      <td className={cx("px-3 py-3 text-right tabular-nums", r.received < r.contracted && "text-warn")}>{money(r.received)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(r.costs)}</td>
                      <td className={cx("px-3 py-3 text-right font-semibold tabular-nums", r.profit < 0 && "text-danger")}>{money(r.profit)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r.contracted ? `${Math.round((r.profit / r.contracted) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-5 py-3 text-xs text-muted">Costos = gastos registrados en la pestaña "Costos" de cada evento (costo acordado o estimado).</p>
        </Card>
      )}
      {editing && <PaymentDialog payment={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    </div>
  );
}

export function PaymentDialog({ payment, defaults, onClose, onSaved }: {
  payment?: Payment | null; defaults?: Partial<Pick<Payment, "customer_id" | "event_id" | "quote_id" | "rental_id" | "currency_code" | "amount" | "kind">>;
  onClose: () => void; onSaved: () => void;
}) {
  const { ws, region } = useWorkspace();
  const qc = useQueryClient();
  const { data: customers } = useCustomers(ws.id);
  const { data: events } = useEvents(ws.id);
  const { data: quotes } = useQuotes(ws.id);
  const [f, setF] = useState({
    customer_id: payment?.customer_id ?? defaults?.customer_id ?? "", event_id: payment?.event_id ?? defaults?.event_id ?? "",
    quote_id: payment?.quote_id ?? defaults?.quote_id ?? "", rental_id: payment?.rental_id ?? defaults?.rental_id ?? "", kind: payment?.kind ?? defaults?.kind ?? "deposit",
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
    const row = { customer_id: f.customer_id, event_id: f.event_id || null, quote_id: f.quote_id || null, rental_id: f.rental_id || null, kind: f.kind, amount: Number(f.amount),
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
        <Field label="Cliente">{(id) => <Select id={id} value={f.customer_id} onChange={(e) => setF((s) => ({ ...s, customer_id: e.target.value, event_id: "", quote_id: "", rental_id: "" }))}><option value="">Elegir…</option>{(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Evento" optional>{(id) => <Select id={id} value={f.event_id} onChange={(e) => set("event_id", e.target.value)}><option value="">Sin evento</option>{(events ?? []).filter((e) => e.customer_id === f.customer_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>}</Field>
        <Field label="Cotización" optional>{(id) => <Select id={id} value={f.quote_id} onChange={(e) => set("quote_id", e.target.value)}><option value="">Ninguna</option>{(quotes ?? []).filter((q) => q.customer_id === f.customer_id).map((q) => <option key={q.id} value={q.id}>{docNumber("COT", q.number)} · {q.title}</option>)}</Select>}</Field>
        <Field label="Tipo">{(id) => <Select id={id} value={f.kind} onChange={(e) => set("kind", e.target.value)}>{Object.entries(PAYMENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <Field label="Monto">{(id) => <Input id={id} type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option>NIO</option><option>USD</option></Select>}</Field>
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
