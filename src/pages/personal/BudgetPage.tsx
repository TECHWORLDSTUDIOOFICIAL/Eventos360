import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useInvalidateEvent, type EventRow } from "@/lib/events";
import { formatDate, formatMoney } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";
import { useSuppliers } from "./SuppliersPage";
import { SupplierSelect } from "@/components/QuickCreate";

export interface ExpenseRow {
  id: string; event_id: string; supplier_id: string | null; category: string; concept: string;
  planned_amount: number; agreed_amount: number | null; paid_amount: number; due_date: string | null; notes: string | null;
}

export const EXPENSE_CATEGORIES: Record<string, string> = {
  lugar: "Lugar", comida: "Comida", bebidas: "Bebidas", decoracion: "Decoración", vestuario: "Vestuario", musica: "Música",
  fotografia: "Fotografía y video", invitaciones: "Invitaciones", pastel: "Pastel y postres", flores: "Flores",
  transporte: "Transporte", mobiliario: "Mobiliario", recuerdos: "Recuerdos", otros: "Otros",
};

export const useExpenses = (eventId: string | undefined) =>
  useQuery({
    queryKey: ["expenses", eventId],
    enabled: !!eventId,
    queryFn: async () => unwrap<ExpenseRow[]>(await supabase.from("event_expenses").select("*").eq("event_id", eventId).order("category").order("concept")),
  });

const cost = (e: ExpenseRow) => Number(e.agreed_amount ?? e.planned_amount);

export default function BudgetPage() {
  return <EventGate>{(ctx) => <Budget {...ctx} />}</EventGate>;
}

export function Budget({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { region, readOnly } = useWorkspace();
  const { data, isLoading } = useExpenses(event.id);
  const { data: suppliers } = useSuppliers();
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const money = (n: number) => formatMoney(n, event.currency_code, region.locale);
  const list = data ?? [];
  const totals = useMemo(() => {
    const planned = list.reduce((s, e) => s + Number(e.planned_amount), 0);
    const committed = list.reduce((s, e) => s + cost(e), 0);
    const paid = list.reduce((s, e) => s + Number(e.paid_amount), 0);
    return { planned, committed, paid, pending: Math.max(0, committed - paid) };
  }, [list]);
  const budget = Number(event.budget) || 0;
  const byCat = useMemo(() => {
    const m = new Map<string, { planned: number; committed: number; paid: number; items: ExpenseRow[] }>();
    for (const e of list) {
      const c = m.get(e.category) ?? { planned: 0, committed: 0, paid: 0, items: [] };
      c.planned += Number(e.planned_amount); c.committed += cost(e); c.paid += Number(e.paid_amount); c.items.push(e);
      m.set(e.category, c);
    }
    return [...m.entries()].sort((a, b) => b[1].committed - a[1].committed);
  }, [list]);
  const supplierName = (id: string | null) => suppliers?.find((s) => s.id === id)?.name;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="animate-rise">
      <PageHeader title="Presupuesto" description={`${event.name} · los montos se expresan en ${event.currency_code}`}
        actions={<>
          <EventSwitcher events={events} current={event} onSelect={select} />
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agregar gasto</Button>}
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Presupuesto", v: money(budget), h: budget ? `Disponible ${money(budget - totals.committed)}` : "Defínelo en Mi evento", warn: budget > 0 && totals.committed > budget },
          { l: "Comprometido", v: money(totals.committed), h: `Estimado inicial ${money(totals.planned)}` },
          { l: "Pagado", v: money(totals.paid), h: "Incluye anticipos" },
          { l: "Por pagar", v: money(totals.pending), h: `${list.filter((e) => cost(e) > Number(e.paid_amount)).length} concepto(s) con saldo` },
        ].map((s) => (
          <Card key={s.l} className="p-4">
            <div className="text-xs font-medium text-muted">{s.l}</div>
            <div className={cx("mt-1 font-display text-xl font-semibold tabular-nums sm:text-2xl", s.warn && "text-danger")}>{s.v}</div>
            <div className={cx("text-xs", s.warn ? "text-danger" : "text-muted")}>{s.h}</div>
          </Card>
        ))}
      </div>
      {budget > 0 && totals.committed > budget && <div className="mb-4"><Alert tone="warn">Tus gastos comprometidos superan el presupuesto por {money(totals.committed - budget)}.</Alert></div>}

      {isLoading ? <Spinner /> : !list.length ? (
        <Card><EmptyState icon={<Wallet className="size-6" />} title="Aún no registras gastos"
          action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Agregar el primero</Button>}>
          Registra cada concepto con su costo estimado. Cuando tengas la cotización, anota el costo acordado y lo que vas pagando.
        </EmptyState></Card>
      ) : (
        <div className="space-y-4">
          {byCat.map(([cat, c]) => (
            <Card key={cat}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
                <h2 className="font-semibold">{EXPENSE_CATEGORIES[cat] ?? cat}</h2>
                <span className="text-sm text-muted tabular-nums">{money(c.committed)} · pagado {money(c.paid)}</span>
              </div>
              <ul className="divide-y divide-line">
                {c.items.map((e) => {
                  const pending = cost(e) - Number(e.paid_amount);
                  const overdue = pending > 0 && e.due_date && e.due_date < today;
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{e.concept}</div>
                        <div className="text-xs text-muted">{[supplierName(e.supplier_id), e.agreed_amount === null ? "Estimado" : "Acordado",
                          e.due_date && `Vence ${formatDate(`${e.due_date}T12:00:00Z`, { timeZone: "UTC" })}`].filter(Boolean).join(" · ")}</div>
                      </div>
                      <div className="text-right text-sm tabular-nums">
                        <div className="font-semibold">{money(cost(e))}</div>
                        {pending > 0 ? <div className={cx("text-xs", overdue ? "font-semibold text-danger" : "text-muted")}>Saldo {money(pending)}</div>
                          : <Badge tone="ok">Pagado</Badge>}
                      </div>
                      {!readOnly && <button onClick={() => setEditing(e)} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" aria-label={`Editar ${e.concept}`}><Pencil className="size-4" /></button>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing && <ExpenseDialog event={event} expense={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ExpenseDialog({ event, expense, onClose }: { event: EventRow; expense: ExpenseRow | null; onClose: () => void }) {
  const { ws } = useWorkspace();
  const invalidate = useInvalidateEvent();
  const [f, setF] = useState({
    category: expense?.category ?? "lugar", concept: expense?.concept ?? "", supplier_id: expense?.supplier_id ?? "",
    planned_amount: String(expense?.planned_amount ?? ""), agreed_amount: expense?.agreed_amount == null ? "" : String(expense.agreed_amount),
    paid_amount: String(expense?.paid_amount ?? "0"), due_date: expense?.due_date ?? "", notes: expense?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.concept.trim()) return setError("Escribe el concepto.");
    setBusy(true);
    const row = {
      category: f.category, concept: f.concept.trim(), supplier_id: f.supplier_id || null,
      planned_amount: Number(f.planned_amount) || 0, agreed_amount: f.agreed_amount === "" ? null : Number(f.agreed_amount),
      paid_amount: Number(f.paid_amount) || 0, due_date: f.due_date || null, notes: f.notes.trim() || null,
    };
    const res = expense ? await supabase.from("event_expenses").update(row).eq("id", expense.id)
      : await supabase.from("event_expenses").insert({ ...row, workspace_id: ws.id, event_id: event.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate(event.id, "expenses");
    onClose();
  }
  async function remove() {
    if (!expense || !confirm(`¿Eliminar "${expense.concept}"?`)) return;
    const { error: err } = await supabase.from("event_expenses").delete().eq("id", expense.id);
    if (err) return setError(err.message);
    await invalidate(event.id, "expenses");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={expense ? "Editar gasto" : "Agregar gasto"} wide
      footer={<>
        {expense && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="expense-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="expense-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoría">{(id) => <Select id={id} value={f.category} onChange={(e) => set("category", e.target.value)}>{Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Concepto">{(id) => <Input id={id} value={f.concept} onChange={(e) => set("concept", e.target.value)} placeholder="Ej. Alquiler del salón" autoFocus />}</Field>
        <Field label="Proveedor" optional>
          {(id) => (
            <SupplierSelect id={id} value={f.supplier_id} onChange={(v) => set("supplier_id", v)} />
          )}
        </Field>
        <Field label="Fecha límite de pago" optional>{(id) => <Input id={id} type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />}</Field>
        <Field label={`Costo estimado (${event.currency_code})`}>{(id) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={f.planned_amount} onChange={(e) => set("planned_amount", e.target.value)} />}</Field>
        <Field label="Costo acordado / cotizado" optional hint="Si lo dejas vacío se usa el estimado.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.01" inputMode="decimal" value={f.agreed_amount} onChange={(e) => set("agreed_amount", e.target.value)} />}</Field>
        <Field label="Pagado hasta ahora" hint="Incluye anticipos y abonos.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.01" inputMode="decimal" value={f.paid_amount} onChange={(e) => set("paid_amount", e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
