import { useMemo, useState, type FormEvent } from "react";
import { Armchair, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { guestName, guestSeats, useEventTables, useGuests, useInvalidateEvent, type EventRow, type EventTable, type GuestRow } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";

const seats = guestSeats;

export default function SeatingPage() {
  return <EventGate>{(ctx) => <Seating {...ctx} />}</EventGate>;
}

function Seating({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { readOnly } = useWorkspace();
  const { data: tables, isLoading } = useEventTables(event.id);
  const { data: guests } = useGuests(event.id);
  const invalidate = useInvalidateEvent();
  const [editing, setEditing] = useState<EventTable | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = (guests ?? []).filter((g) => g.status !== "declined");
  const byTable = useMemo(() => {
    const m = new Map<string, GuestRow[]>();
    for (const g of active) if (g.table_id) m.set(g.table_id, [...(m.get(g.table_id) ?? []), g]);
    return m;
  }, [active]);
  const unassigned = active.filter((g) => !g.table_id);
  const totalSeats = (tables ?? []).reduce((s, t) => s + t.capacity, 0);
  const seated = active.filter((g) => g.table_id).reduce((s, g) => s + seats(g), 0);
  const needed = active.reduce((s, g) => s + seats(g), 0);

  async function assign(guest: GuestRow, tableId: string | null) {
    setError(null);
    // La capacidad se valida en la base con las personas reales del invitado.
    const { error: err } = await supabase.from("guests").update({ table_id: tableId }).eq("id", guest.id);
    if (err) return setError(`${guestName(guest)}: ${err.message}`);
    await invalidate(event.id, "guests");
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Distribución de mesas" description={`${seated} de ${needed} personas ubicadas · ${totalSeats} lugares en ${tables?.length ?? 0} mesa(s)`}
        actions={<>
          <EventSwitcher events={events} current={event} onSelect={select} />
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agregar mesas</Button>}
        </>} />
      {needed > totalSeats && (tables?.length ?? 0) > 0 && <div className="mb-4"><Alert tone="warn">Faltan {needed - totalSeats} lugares para todas las personas invitadas.</Alert></div>}
      {error && <div className="mb-4"><Alert tone="danger" onClose={() => setError(null)}>{error}</Alert></div>}
      <p className="mb-4 text-xs text-muted">Los invitados pendientes ocupan el máximo de personas de su invitación; los confirmados, las personas que confirmaron. Quienes no asistirán no aparecen.</p>

      {isLoading ? <Spinner /> : !tables?.length ? (
        <Card><EmptyState icon={<Armchair className="size-6" />} title="Aún no hay mesas"
          action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Crear mesas</Button>}>
          Crea varias mesas de una vez indicando cuántas y su capacidad. Luego asigna a tus invitados.
        </EmptyState></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tables.map((t) => {
              const list = byTable.get(t.id) ?? [];
              const used = list.reduce((s, g) => s + seats(g), 0);
              const full = used >= t.capacity;
              return (
                <Card key={t.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={cx("grid size-12 shrink-0 place-items-center border-2 font-display text-lg font-semibold", t.shape === "round" ? "rounded-full" : "rounded-lg",
                      full ? "border-ok bg-ok-soft text-ok" : "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]")}>
                      {used}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{t.name}</div>
                      <div className="text-xs text-muted">{used} de {t.capacity} lugares {full && <Badge tone="ok" className="ml-1">Completa</Badge>}</div>
                    </div>
                    {!readOnly && <button onClick={() => setEditing(t)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label={`Editar ${t.name}`}><Pencil className="size-4" /></button>}
                  </div>
                  <ul className="mt-3 space-y-1">
                    {list.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2.5 py-1.5 text-sm">
                        <span className="min-w-0 truncate">{guestName(g)} <span className="text-xs text-muted">({seats(g)})</span></span>
                        {!readOnly && <button onClick={() => void assign(g, null)} className="text-xs text-muted hover:text-danger" aria-label={`Quitar a ${guestName(g)} de la mesa`}>Quitar</button>}
                      </li>
                    ))}
                    {!list.length && <li className="text-xs text-faint">Sin invitados</li>}
                  </ul>
                </Card>
              );
            })}
          </div>
          <Card className="self-start">
            <div className="border-b border-line px-4 py-3 font-semibold">Sin mesa ({unassigned.length})</div>
            {!unassigned.length ? <p className="px-4 py-6 text-sm text-muted">Todos tus invitados tienen mesa.</p> : (
              <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                {unassigned.map((g) => (
                  <li key={g.id} className="space-y-1.5 px-4 py-2.5">
                    <div className="text-sm font-medium">{guestName(g)} <span className="text-xs text-muted">· {seats(g)} persona(s)</span></div>
                    {!readOnly && (
                      <Select value="" onChange={(e) => e.target.value && void assign(g, e.target.value)} className="h-9 text-sm" aria-label={`Asignar mesa a ${guestName(g)}`}>
                        <option value="">Asignar a mesa…</option>
                        {tables.map((t) => {
                          const used = (byTable.get(t.id) ?? []).reduce((s, x) => s + seats(x), 0);
                          return <option key={t.id} value={t.id} disabled={used + seats(g) > t.capacity}>{t.name} ({t.capacity - used} libres)</option>;
                        })}
                      </Select>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {editing && <TableDialog event={event} table={editing === "new" ? null : editing} count={tables?.length ?? 0} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TableDialog({ event, table, count, onClose }: { event: EventRow; table: EventTable | null; count: number; onClose: () => void }) {
  const { ws } = useWorkspace();
  const invalidate = useInvalidateEvent();
  const [f, setF] = useState({ name: table?.name ?? "", quantity: "1", capacity: String(table?.capacity ?? 10), shape: table?.shape ?? "round" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const capacity = Math.max(1, Math.min(100, Number(f.capacity) || 1));
    setBusy(true);
    let res;
    if (table) {
      res = await supabase.from("event_tables").update({ name: f.name.trim() || table.name, capacity, shape: f.shape }).eq("id", table.id);
    } else {
      const n = Math.max(1, Math.min(60, Number(f.quantity) || 1));
      const rows = Array.from({ length: n }, (_, i) => ({
        workspace_id: ws.id, event_id: event.id, capacity, shape: f.shape, sort: count + i + 1,
        name: n === 1 && f.name.trim() ? f.name.trim() : `Mesa ${count + i + 1}`,
      }));
      res = await supabase.from("event_tables").insert(rows);
    }
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate(event.id, "event-tables");
    onClose();
  }
  async function remove() {
    if (!table || !confirm(`¿Eliminar ${table.name}? Sus invitados quedarán sin mesa.`)) return;
    const { error: err } = await supabase.from("event_tables").delete().eq("id", table.id);
    if (err) return setError(err.message);
    await invalidate(event.id, "event-tables", "guests");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={table ? `Editar ${table.name}` : "Agregar mesas"}
      footer={<>
        {table && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="table-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="table-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {!table && <Field label="Cantidad de mesas">{(id) => <Input id={id} type="number" min={1} max={60} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />}</Field>}
        {(table || f.quantity === "1") && <Field label="Nombre" optional>{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={`Mesa ${count + 1}`} />}</Field>}
        <Field label="Personas por mesa">{(id) => <Input id={id} type="number" min={1} max={100} value={f.capacity} onChange={(e) => set("capacity", e.target.value)} />}</Field>
        <Field label="Forma">{(id) => <Select id={id} value={f.shape} onChange={(e) => set("shape", e.target.value)}><option value="round">Redonda</option><option value="rect">Rectangular</option></Select>}</Field>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
