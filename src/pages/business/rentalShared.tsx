import { useState, type FormEvent } from "react";
import { RotateCcw, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { docNumber } from "@/lib/pro";
import { MAINT_KIND, RENTAL_STATUS, isOverdue, useInvalidateRental, useRentalItems, useResources, type MaintenanceRecord, type Rental } from "@/lib/rental";
import { formatDate, formatMoney } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Dialog, Field, Input, Select, Spinner, Textarea, cx } from "@/components/ui";

/** Piezas compartidas por las pantallas de alquiler (reservaciones, entregas, devoluciones, inventario). */

export const rentalRange = (r: Pick<Rental, "starts_at" | "ends_at">, tz: string, locale: string) => {
  const a = formatDate(r.starts_at, { timeZone: tz, locale, withTime: true });
  const b = formatDate(r.ends_at, { timeZone: tz, locale, withTime: true });
  return `${a} → ${b}`;
};

export function RentalStatusBadge({ r }: { r: Pick<Rental, "status" | "ends_at"> }) {
  if (isOverdue(r)) return <Badge tone="danger">Atrasada</Badge>;
  return <Badge tone={RENTAL_STATUS[r.status].tone}>{RENTAL_STATUS[r.status].label}</Badge>;
}

// ------------------------------------------------------------------ Entrega
export function DeliveryDialog({ rental: r, onClose, onDone }: { rental: Rental; onClose: () => void; onDone: () => void }) {
  const invalidate = useInvalidateRental();
  const [by, setBy] = useState(r.delivery_contact ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await supabase.from("rentals").update({ status: "out", out_received_by: by.trim() || null }).eq("id", r.id);
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate();
    onDone();
  }
  return (
    <Dialog open onClose={onClose} title={`Entregar ${docNumber("RES", r.number)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="deliver-form" variant="accent" loading={busy} icon={<Truck className="size-4" />}>Confirmar entrega</Button></>}>
      <form id="deliver-form" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">{r.title}</p>
        <Field label="Recibido por" optional hint="Nombre de quien recibe los artículos.">{(id, d) => <Input id={id} aria-describedby={d} value={by} onChange={(e) => setBy(e.target.value)} autoFocus />}</Field>
        <Alert tone="info">Imprime la hoja de entrega para que el cliente firme lo recibido. Después de entregar ya no se pueden cambiar cantidades ni precios.</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Devolución
export function ReturnDialog({ rental: r, onClose, onDone }: { rental: Rental; onClose: () => void; onDone: () => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateRental();
  const { data: items } = useRentalItems(r.id);
  const { data: resources } = useResources(ws.id, { includeInactive: true });
  const [rows, setRows] = useState<Record<string, { damaged: string; lost: string; charge: string; notes: string }>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = (items ?? []).filter((i) => i.resource_id);
  const row = (id: string) => rows[id] ?? { damaged: "", lost: "", charge: "", notes: "" };
  const setRow = (id: string, k: "damaged" | "lost" | "charge" | "notes", v: string) => setRows((s) => ({ ...s, [id]: { ...row(id), [k]: v } }));
  const money = (n: number) => formatMoney(n, r.currency_code, region.locale);
  const totalCharge = lines.reduce((s, i) => s + (Number(row(i.id).charge) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    for (const i of lines) {
      const d = Number(row(i.id).damaged || 0), l = Number(row(i.id).lost || 0);
      if (!Number.isInteger(d) || !Number.isInteger(l) || d < 0 || l < 0) return setError(`Revisa las cantidades de "${i.description}".`);
      if (d + l > i.quantity) return setError(`En "${i.description}" los dañados y faltantes superan lo entregado (${i.quantity}).`);
    }
    setBusy(true);
    const payload = lines.map((i) => ({ id: i.id, damaged: Number(row(i.id).damaged || 0), lost: Number(row(i.id).lost || 0), charge: Number(row(i.id).charge || 0), notes: row(i.id).notes }));
    const { error: err } = await supabase.rpc("rental_register_return", { p_rental: r.id, p_items: payload, p_notes: notes.trim() || null });
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate();
    onDone();
  }
  return (
    <Dialog open onClose={onClose} title={`Devolución de ${docNumber("RES", r.number)}`} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="return-form" variant="accent" loading={busy} icon={<RotateCcw className="size-4" />}>Registrar devolución</Button></>}>
      <form id="return-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Cuenta y revisa cada artículo. Deja en blanco si todo volvió bien. Lo dañado o faltante pasa a Daños y mantenimiento y deja de estar disponible hasta que lo resuelvas.</p>
        {!items ? <Spinner /> : (
          <div className="space-y-3">
            {lines.map((i) => {
              const res = resources?.find((x) => x.id === i.resource_id);
              const d = Number(row(i.id).damaged || 0), l = Number(row(i.id).lost || 0);
              const ok = i.quantity - d - l;
              const suggest = res?.replacement_cost != null ? Math.round(l * Number(res.replacement_cost) * 100) / 100 : null;
              return (
                <div key={i.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{i.description}</span>
                    <span className={cx("text-sm tabular-nums", ok < 0 ? "text-danger" : "text-muted")}>Entregados {i.quantity} · en buen estado <b>{ok}</b></span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label="Dañados">{(id) => <Input id={id} type="number" min={0} max={i.quantity} step={1} value={row(i.id).damaged} onChange={(e) => setRow(i.id, "damaged", e.target.value)} placeholder="0" className="h-9" />}</Field>
                    <Field label="Faltantes">{(id) => <Input id={id} type="number" min={0} max={i.quantity} step={1} value={row(i.id).lost} onChange={(e) => setRow(i.id, "lost", e.target.value)} placeholder="0" className="h-9" />}</Field>
                    <Field label="Cargo al cliente">{(id) => <Input id={id} type="number" min={0} step="0.01" value={row(i.id).charge} onChange={(e) => setRow(i.id, "charge", e.target.value)} placeholder="0" className="h-9" />}</Field>
                    <Field label="Observación">{(id) => <Input id={id} value={row(i.id).notes} onChange={(e) => setRow(i.id, "notes", e.target.value)} className="h-9" />}</Field>
                  </div>
                  {res?.replacement_cost != null && (d > 0 || l > 0) && (
                    <p className="mt-1.5 text-xs text-muted">Reposición: {formatMoney(Number(res.replacement_cost), res.currency_code, region.locale)} c/u.
                      {suggest !== null && l > 0 && <> <button type="button" className="font-semibold text-[var(--accent)] underline" onClick={() => setRow(i.id, "charge", String(suggest))}>Cobrar faltantes ({formatMoney(suggest, res.currency_code, region.locale)})</button></>}
                    </p>
                  )}
                </div>
              );
            })}
            {!lines.length && <p className="text-sm text-muted">Esta reservación no tiene artículos de inventario.</p>}
          </div>
        )}
        <Field label="Observaciones generales" optional>{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />}</Field>
        {totalCharge > 0 && <div className="flex justify-between rounded-xl bg-paper px-3 py-2 text-sm"><span>Cargos por daños y faltantes</span><b className="tabular-nums">{money(totalCharge)}</b></div>}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

/** Reportar unidades fuera de servicio (daño, pérdida, limpieza o reparación). */
export function MaintenanceDialog({ resourceId, onClose }: { resourceId?: string; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateRental();
  const { data: resources } = useResources(ws.id);
  const [f, setF] = useState({ resource_id: resourceId ?? "", kind: "damaged" as MaintenanceRecord["kind"], quantity: "1", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.resource_id) return setError("Elige el artículo.");
    const qty = Number(f.quantity);
    if (!Number.isInteger(qty) || qty < 1) return setError("La cantidad debe ser un número entero mayor que 0.");
    setBusy(true);
    const { error: err } = await supabase.from("maintenance_records").insert({
      workspace_id: ws.id, resource_id: f.resource_id, kind: f.kind, quantity: qty, description: f.description.trim() || null, currency_code: region.currency_code,
    });
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate();
    onClose();
  }
  return (
    <Dialog open onClose={onClose} title="Reportar unidades fuera de servicio"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="maint-form" variant="accent" loading={busy}>Guardar</Button></>}>
      <form id="maint-form" onSubmit={submit} className="space-y-3">
        <Field label="Artículo">{(id) => <Select id={id} value={f.resource_id} onChange={(e) => setF((s) => ({ ...s, resource_id: e.target.value }))}><option value="">Elegir…</option>{(resources ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.total_qty})</option>)}</Select>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Motivo">{(id) => <Select id={id} value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as MaintenanceRecord["kind"] }))}>{Object.entries(MAINT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Cantidad">{(id) => <Input id={id} type="number" min={1} step={1} inputMode="numeric" value={f.quantity} onChange={(e) => setF((s) => ({ ...s, quantity: e.target.value }))} />}</Field>
        </div>
        <Field label="Detalle" optional>{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} placeholder="Ej. Respaldo quebrado, manchas de vino…" />}</Field>
        <Alert tone="info">Estas unidades dejarán de estar disponibles hasta que marques el registro como resuelto.</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

