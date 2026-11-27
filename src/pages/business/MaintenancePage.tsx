import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, Plus, Trash2, Wrench, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { MAINT_KIND, MAINT_STATUS, useInvalidateRental, useMaintenance, useRentals, useResources, type MaintenanceRecord } from "@/lib/rental";
import { docNumber } from "@/lib/pro";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Textarea, cx } from "@/components/ui";
import { MaintenanceDialog } from "./rentalShared";

/** Daños, pérdidas, limpieza y reparaciones: lo que está fuera de servicio no se puede alquilar. */
export default function MaintenancePage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useMaintenance(ws.id);
  const { data: resources } = useResources(ws.id, { includeInactive: true });
  const { data: rentals } = useRentals(ws.id);
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<MaintenanceRecord | null>(null);
  const res = (id: string) => resources?.find((r) => r.id === id);
  const list = useMemo(() => (data ?? []).filter((m) => (tab === "open" ? m.status === "open" : m.status !== "open")), [data, tab]);
  const openUnits = (data ?? []).filter((m) => m.status === "open").reduce((s, m) => s + m.quantity, 0);

  return (
    <div className="animate-rise">
      <PageHeader title="Daños y mantenimiento" description="Unidades dañadas, perdidas, en limpieza o reparación. Mientras estén aquí no se pueden alquilar."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Reportar</Button>} />
      <div className="mb-4 flex gap-1 rounded-xl bg-ink/5 p-1 text-sm font-medium sm:w-fit">
        <button onClick={() => setTab("open")} className={cx("flex-1 rounded-lg px-4 py-1.5", tab === "open" ? "bg-card shadow-sm" : "text-muted")}>Fuera de servicio ({openUnits})</button>
        <button onClick={() => setTab("closed")} className={cx("flex-1 rounded-lg px-4 py-1.5", tab === "closed" ? "bg-card shadow-sm" : "text-muted")}>Historial</button>
      </div>
      <Card>
        {isLoading ? <Spinner /> : !list.length ? (
          <EmptyState icon={<Wrench className="size-6" />} title={tab === "open" ? "Todo el inventario está en servicio" : "Sin historial todavía"}>
            {tab === "open" ? "Al registrar una devolución, lo dañado o perdido aparece aquí automáticamente. También puedes reportarlo a mano." : "Aquí verás lo que se reparó o se dio de baja."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((m) => {
              const r = res(m.resource_id);
              const rental = rentals?.find((x) => x.id === m.rental_id);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warn-soft font-display text-lg font-semibold text-warn tabular-nums">{m.quantity}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r?.name ?? "Artículo"} <span className="font-normal text-muted">· {MAINT_KIND[m.kind]}</span></span>
                    <span className="block text-xs text-muted">
                      {formatDate(m.opened_at, { timeZone: region.timezone })}
                      {rental && <> · <Link className="underline" to={workspacePath(ws.kind, ws.id, `m/reservations/${rental.id}`)}>{docNumber("RES", rental.number)}</Link></>}
                      {m.description && ` · ${m.description}`}
                    </span>
                    {m.status !== "open" && <span className="block text-xs text-muted">{MAINT_STATUS[m.status].label} el {formatDate(m.resolved_at, { timeZone: region.timezone })}{m.cost != null && ` · costo ${formatMoney(Number(m.cost), m.currency_code, region.locale)}`}{m.resolution_notes && ` · ${m.resolution_notes}`}</span>}
                  </span>
                  {m.status === "open" ? (!readOnly && <Button size="sm" variant="secondary" onClick={() => setClosing(m)}>Resolver</Button>)
                    : <Badge tone={MAINT_STATUS[m.status].tone}>{MAINT_STATUS[m.status].label}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {creating && <MaintenanceDialog onClose={() => setCreating(false)} />}
      {closing && <ResolveDialog record={closing} name={res(closing.resource_id)?.name ?? ""} onClose={() => setClosing(null)} />}
    </div>
  );
}

function ResolveDialog({ record, name, onClose }: { record: MaintenanceRecord; name: string; onClose: () => void }) {
  const { region } = useWorkspace();
  const invalidate = useInvalidateRental();
  const [qty, setQty] = useState(String(record.quantity));
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function close(status: "resolved" | "written_off") {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1 || n > record.quantity) return setError(`La cantidad debe estar entre 1 y ${record.quantity}.`);
    if (status === "written_off" && !confirm(`¿Dar de baja ${n} de "${name}"? Se descontarán definitivamente del inventario.`)) return;
    setBusy(true);
    setError(null);
    // Si se resuelve solo una parte, la base de datos deja el resto abierto en un registro nuevo.
    const { error: err } = await supabase.from("maintenance_records").update({
      quantity: n, status, cost: cost === "" ? null : Number(cost), resolution_notes: notes.trim() || null, currency_code: region.currency_code,
    }).eq("id", record.id);
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate();
    onClose();
  }
  async function remove() {
    if (!confirm("¿Eliminar este reporte? Úsalo solo si fue un error.")) return;
    const { error: err } = await supabase.from("maintenance_records").delete().eq("id", record.id);
    if (err) return setError(err.message);
    await invalidate();
    onClose();
  }
  return (
    <Dialog open onClose={onClose} title={`Resolver: ${name}`}
      footer={<>
        <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Fue un error</Button>
        <Button variant="secondary" icon={<XCircle className="size-4" />} loading={busy} onClick={() => void close("written_off")}>Dar de baja</Button>
        <Button variant="accent" icon={<CheckCircle2 className="size-4" />} loading={busy} onClick={() => void close("resolved")}>Volver al inventario</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{MAINT_KIND[record.kind]}: {record.quantity} unidades{record.description ? ` · ${record.description}` : ""}.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cantidad" hint={`De ${record.quantity}. El resto sigue fuera de servicio.`}>{(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} max={record.quantity} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
          <Field label="Costo de reparación" optional>{(id) => <Input id={id} type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        </div>
        <Field label="Notas" optional>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />}</Field>
        <p className="text-xs text-muted"><b>Volver al inventario</b>: reparado, limpio o encontrado. <b>Dar de baja</b>: se perdió o no tiene arreglo; se descuenta de la cantidad total.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
