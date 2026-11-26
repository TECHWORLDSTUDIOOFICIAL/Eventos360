import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { Alert, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";

interface PaymentRow {
  id: string; payer_name: string; payer_phone: string | null; amount: number; currency_code: string; method: string;
  bank: string | null; reference: string | null; paid_at: string; notes: string | null; workspaces: { name: string } | null;
}

export const PAYMENT_METHODS = [
  { v: "transferencia", l: "Transferencia bancaria" }, { v: "deposito", l: "Depósito" }, { v: "efectivo", l: "Efectivo" },
  { v: "tarjeta", l: "Tarjeta" }, { v: "billetera", l: "Billetera electrónica" }, { v: "otro", l: "Otro" },
];

export default function AdminPayments() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-payments"],
    queryFn: async () => unwrap<PaymentRow[]>(await supabase.from("manual_payments").select("*, workspaces(name)").order("paid_at", { ascending: false }).order("created_at", { ascending: false }).limit(300)),
  });

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Pagos" description="Registro de los pagos recibidos por fuera de la plataforma (transferencias, depósitos, efectivo)."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Registrar pago</Button>} />
      <Card>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Wallet className="size-6" />} title="Sin pagos registrados">Registra cada pago antes de generar el código de acceso, así queda trazabilidad.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <tr><th className="px-5 py-3 font-semibold">Fecha</th><th className="px-3 py-3 font-semibold">Cliente</th><th className="px-3 py-3 font-semibold">Método</th>
                  <th className="px-3 py-3 font-semibold">Cuenta</th><th className="px-5 py-3 text-right font-semibold">Monto</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3">{formatDate(p.paid_at)}</td>
                    <td className="px-3 py-3">{p.payer_name}<div className="text-xs text-muted">{p.payer_phone}</div></td>
                    <td className="px-3 py-3">{PAYMENT_METHODS.find((m) => m.v === p.method)?.l ?? p.method}
                      <div className="text-xs text-muted">{[p.bank, p.reference && `Ref. ${p.reference}`].filter(Boolean).join(" · ")}</div></td>
                    <td className="px-3 py-3">{p.workspaces?.name ?? <span className="text-xs text-faint">Sin asociar</span>}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatMoney(p.amount, p.currency_code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <PaymentDialog onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await qc.invalidateQueries({ queryKey: ["admin-payments"] }); }} />}
    </div>
  );
}

export function PaymentDialog({ onClose, onSaved, workspaceId, defaultName }: { onClose: () => void; onSaved: (id: string) => void; workspaceId?: string; defaultName?: string }) {
  const [f, setF] = useState({ payer_name: defaultName ?? "", payer_phone: "", amount: "", currency: "USD", method: "transferencia", bank: "", reference: "", paid_at: new Date().toISOString().slice(0, 10), notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.payer_name.trim() || !(Number(f.amount) > 0)) return setError("Ingresa el nombre del cliente y un monto válido.");
    setBusy(true);
    const { data, error: err } = await supabase.rpc("admin_record_payment", {
      p_payer_name: f.payer_name, p_amount: Number(f.amount), p_currency: f.currency, p_method: f.method,
      p_workspace_id: workspaceId ?? null, p_payer_phone: f.payer_phone || null, p_bank: f.bank || null,
      p_reference: f.reference || null, p_paid_at: f.paid_at, p_notes: f.notes || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    onSaved(data as string);
  }

  return (
    <Dialog open onClose={onClose} title="Registrar pago" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="pay-form" loading={busy}>Guardar pago</Button></>}>
      <form id="pay-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Cliente">{(id) => <Input id={id} value={f.payer_name} onChange={(e) => set("payer_name", e.target.value)} />}</Field>
        <Field label="Teléfono" optional>{(id) => <Input id={id} type="tel" value={f.payer_phone} onChange={(e) => set("payer_phone", e.target.value)} />}</Field>
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <Field label="Monto">{(id) => <Input id={id} type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency} onChange={(e) => set("currency", e.target.value)}><option>USD</option><option>NIO</option></Select>}</Field>
        </div>
        <Field label="Fecha de pago">{(id) => <Input id={id} type="date" value={f.paid_at} onChange={(e) => set("paid_at", e.target.value)} />}</Field>
        <Field label="Método">{(id) => <Select id={id} value={f.method} onChange={(e) => set("method", e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}</Select>}</Field>
        <Field label="Banco / billetera" optional>{(id) => <Input id={id} value={f.bank} onChange={(e) => set("bank", e.target.value)} placeholder="BAC, Banpro, Lafise…" />}</Field>
        <Field label="Referencia" optional>{(id) => <Input id={id} value={f.reference} onChange={(e) => set("reference", e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
