import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCustomers } from "@/lib/pro";
import { useSuppliers } from "@/pages/personal/SuppliersPage";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Dialog, Field, Input, Select } from "./ui";

const NEW = "__nuevo__";

/**
 * Selector de proveedor con opción "+ Nuevo proveedor…": lo crea ahí mismo (sin ir al módulo
 * Proveedores) y lo deja seleccionado.
 */
export function SupplierSelect({ id, value, onChange, emptyLabel = "Sin proveedor", className, "aria-label": ariaLabel, disabled }: {
  id?: string; value: string; onChange: (id: string) => void; emptyLabel?: string; className?: string; "aria-label"?: string; disabled?: boolean;
}) {
  const { data: suppliers } = useSuppliers();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Select id={id} value={value} className={className} aria-label={ariaLabel} disabled={disabled}
        onChange={(e) => (e.target.value === NEW ? setCreating(true) : onChange(e.target.value))}>
        <option value="">{emptyLabel}</option>
        {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.service_type ? ` · ${s.service_type}` : ""}</option>)}
        <option value={NEW}>+ Nuevo proveedor…</option>
      </Select>
      {creating && <NewSupplierDialog onClose={() => setCreating(false)} onCreated={(sid) => { setCreating(false); onChange(sid); }} />}
    </>
  );
}

export function NewSupplierDialog({ onClose, onCreated, initialName = "" }: { onClose: () => void; onCreated: (id: string) => void; initialName?: string }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: initialName, service_type: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del proveedor.");
    setBusy(true);
    const { data, error: err } = await supabase.from("suppliers").insert({ workspace_id: ws.id, name: f.name.trim(), service_type: f.service_type.trim() || null, phone: f.phone.trim() || null }).select("id").single();
    setBusy(false);
    if (err) return setError(err.message);
    await qc.invalidateQueries({ queryKey: ["suppliers", ws.id] });
    onCreated((data as { id: string }).id);
  }
  return (
    <Dialog open onClose={onClose} title="Nuevo proveedor"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="quick-supplier" variant="accent" loading={busy}>Crear y seleccionar</Button></>}>
      <form id="quick-supplier" onSubmit={submit} className="space-y-3">
        <Field label="Nombre">{(i) => <Input id={i} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} autoFocus placeholder="Ej. Flores del Valle" />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="¿Qué te provee?" optional>{(i) => <Input id={i} value={f.service_type} onChange={(e) => setF((s) => ({ ...s, service_type: e.target.value }))} placeholder="Flores, sonido, transporte…" />}</Field>
          <Field label="Teléfono / WhatsApp" optional>{(i) => <Input id={i} type="tel" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} />}</Field>
        </div>
        <p className="text-xs text-muted">Después puedes completar sus datos en Proveedores.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

/** Selector de cliente con opción "+ Nuevo cliente…" que lo crea sin salir de la pantalla. */
export function CustomerSelect({ id, value, onChange, emptyLabel = "Elegir…", className, "aria-label": ariaLabel, disabled }: {
  id?: string; value: string; onChange: (id: string) => void; emptyLabel?: string; className?: string; "aria-label"?: string; disabled?: boolean;
}) {
  const { ws } = useWorkspace();
  const { data: customers } = useCustomers(ws.id);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Select id={id} value={value} className={className} aria-label={ariaLabel} disabled={disabled}
        onChange={(e) => (e.target.value === NEW ? setCreating(true) : onChange(e.target.value))}>
        <option value="">{emptyLabel}</option>
        {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value={NEW}>+ Nuevo cliente…</option>
      </Select>
      {creating && <NewCustomerDialog onClose={() => setCreating(false)} onCreated={(cid) => { setCreating(false); onChange(cid); }} />}
    </>
  );
}

function NewCustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: "person", name: "", phone: "", tax_id: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del cliente.");
    setBusy(true);
    const { data, error: err } = await supabase.from("customers").insert({ workspace_id: ws.id, kind: f.kind, name: f.name.trim(), phone: f.phone.trim() || null, tax_id: f.tax_id.trim() || null, status: "active" }).select("id").single();
    setBusy(false);
    if (err) return setError(err.message);
    await qc.invalidateQueries({ queryKey: ["customers", ws.id] });
    onCreated((data as { id: string }).id);
  }
  return (
    <Dialog open onClose={onClose} title="Nuevo cliente"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="quick-customer" variant="accent" loading={busy}>Crear y seleccionar</Button></>}>
      <form id="quick-customer" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[["person", "Persona"], ["company", "Empresa"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setF((s) => ({ ...s, kind: k! }))} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${f.kind === k ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-line"}`}>{l}</button>
          ))}
        </div>
        <Field label={f.kind === "company" ? "Nombre de la empresa" : "Nombre completo"}>{(i) => <Input id={i} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} autoFocus />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Teléfono / WhatsApp" optional>{(i) => <Input id={i} type="tel" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} />}</Field>
          <Field label={f.kind === "company" ? "RUC" : "Cédula"} optional>{(i) => <Input id={i} value={f.tax_id} onChange={(e) => setF((s) => ({ ...s, tax_id: e.target.value }))} />}</Field>
        </div>
        <p className="text-xs text-muted">Después puedes completar sus datos en Clientes.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
