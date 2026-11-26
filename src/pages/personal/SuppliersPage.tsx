import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Pencil, Phone, Plus, Store, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { formatMoney } from "@/lib/format";
import { useCurrentEvent } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Textarea } from "@/components/ui";
import { useExpenses } from "./BudgetPage";

export interface SupplierRow {
  id: string; name: string; service_type: string | null; contact_name: string | null; phone: string | null; email: string | null; notes: string | null;
}

export function useSuppliers() {
  const { ws } = useWorkspace();
  return useQuery({
    queryKey: ["suppliers", ws.id],
    queryFn: async () => unwrap<SupplierRow[]>(await supabase.from("suppliers").select("*").eq("workspace_id", ws.id).order("name")),
  });
}

export default function SuppliersPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useSuppliers();
  const { event } = useCurrentEvent(ws.id);
  const { data: expenses } = useExpenses(event?.id);
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);

  const totals = useMemo(() => {
    const m = new Map<string, { cost: number; paid: number }>();
    for (const e of expenses ?? []) {
      if (!e.supplier_id) continue;
      const t = m.get(e.supplier_id) ?? { cost: 0, paid: 0 };
      t.cost += Number(e.agreed_amount ?? e.planned_amount); t.paid += Number(e.paid_amount);
      m.set(e.supplier_id, t);
    }
    return m;
  }, [expenses]);
  const currency = event?.currency_code ?? region.currency_code;

  return (
    <div className="animate-rise">
      <PageHeader title="Proveedores" description="Tus contactos de servicios. Asócialos a los gastos del presupuesto para ver costos y pagos."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agregar proveedor</Button>} />
      {isLoading ? <Spinner /> : !data?.length ? (
        <Card><EmptyState icon={<Store className="size-6" />} title="Sin proveedores"
          action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Agregar proveedor</Button>}>
          Guarda aquí a tu fotógrafo, el salón, la pastelería y demás servicios que estés cotizando.
        </EmptyState></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => {
            const t = totals.get(s.id);
            const phone = (s.phone ?? "").replace(/\D/g, "");
            return (
              <Card key={s.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{s.name}</div>
                    <div className="text-sm text-muted">{s.service_type ?? "Servicio"}{s.contact_name ? ` · ${s.contact_name}` : ""}</div>
                  </div>
                  {!readOnly && <button onClick={() => setEditing(s)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label={`Editar ${s.name}`}><Pencil className="size-4" /></button>}
                </div>
                {s.notes && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{s.notes}</p>}
                {t && (
                  <div className="mt-3 rounded-xl bg-paper px-3 py-2 text-sm tabular-nums">
                    {formatMoney(t.cost, currency, region.locale)} · pagado {formatMoney(t.paid, currency, region.locale)}
                    {t.cost - t.paid > 0 && <span className="block text-xs text-muted">Saldo {formatMoney(t.cost - t.paid, currency, region.locale)}</span>}
                  </div>
                )}
                {phone && (
                  <div className="mt-auto flex gap-2 pt-4">
                    <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-paper"><Phone className="size-3.5" />Llamar</a>
                    <a href={`https://wa.me/${phone.length === 8 ? `505${phone}` : phone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-[#1f8b4c] hover:bg-paper"><MessageCircle className="size-3.5" />WhatsApp</a>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editing && <SupplierDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: SupplierRow | null; onClose: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: supplier?.name ?? "", service_type: supplier?.service_type ?? "", contact_name: supplier?.contact_name ?? "",
    phone: supplier?.phone ?? "", email: supplier?.email ?? "", notes: supplier?.notes ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setError("Escribe el nombre del proveedor.");
    setBusy(true);
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])) as Record<string, string | null>;
    row.name = f.name.trim();
    const res = supplier ? await supabase.from("suppliers").update(row).eq("id", supplier.id) : await supabase.from("suppliers").insert({ ...row, workspace_id: ws.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await qc.invalidateQueries({ queryKey: ["suppliers", ws.id] });
    onClose();
  }
  async function remove() {
    if (!supplier || !confirm(`¿Eliminar a ${supplier.name}? Los gastos asociados se conservan sin proveedor.`)) return;
    const { error: err } = await supabase.from("suppliers").delete().eq("id", supplier.id);
    if (err) return setError(err.message);
    await qc.invalidateQueries({ queryKey: ["suppliers", ws.id] });
    await qc.invalidateQueries({ queryKey: ["expenses"] });
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={supplier ? "Editar proveedor" : "Agregar proveedor"} wide
      footer={<>
        {supplier && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="supplier-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="supplier-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />}</Field>
        <Field label="Servicio" optional>{(id) => <Input id={id} value={f.service_type} onChange={(e) => set("service_type", e.target.value)} placeholder="Ej. Fotografía" />}</Field>
        <Field label="Persona de contacto" optional>{(id) => <Input id={id} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} />}</Field>
        <Field label="Teléfono / WhatsApp" optional>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
        <Field label="Correo" optional>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label="Notas y cotización" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Qué incluye, condiciones, anticipo requerido…" />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
