import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap, useSpecialties } from "@/lib/queries";
import { daysUntil, formatDate, formatMoney } from "@/lib/format";
import { MODALITIES, STATUS_LABEL, STATUS_TONE } from "@/lib/modalities";
import type { Plan, SubscriptionStatus, WorkspaceKind } from "@/lib/types";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";
import { PaymentDialog } from "./AdminPayments";

interface AccountRow {
  id: string; kind: WorkspaceKind; name: string; is_disabled: boolean; created_at: string;
  owner_id: string | null; owner_username: string | null; owner_name: string | null; owner_phone: string | null;
  plan_id: string | null; plan_name: string | null; subscription_status: SubscriptionStatus | null; period_end: string | null; specialties: string[];
}

export default function AdminAccounts() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<WorkspaceKind | "">("");
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const { data: specialties } = useSpecialties();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-accounts", search, kind],
    queryFn: async () => unwrap<AccountRow[]>(await supabase.rpc("admin_list_workspaces", { p_search: search || null, p_kind: kind || null })),
  });
  const specName = (k: string) => specialties?.find((s) => s.key === k)?.name ?? k;

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Cuentas" description="Espacios de trabajo de clientes, su plan y estado de suscripción." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, usuario o teléfono" className="pl-10" />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value as WorkspaceKind | "")} className="w-auto">
          <option value="">Todas las modalidades</option>
          {(Object.keys(MODALITIES) as WorkspaceKind[]).map((k) => <option key={k} value={k}>{MODALITIES[k].short}</option>)}
        </Select>
      </div>
      {error && <Alert tone="danger">{(error as Error).message}</Alert>}
      <Card>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Building2 className="size-6" />} title="No hay cuentas">Las cuentas aparecen aquí cuando un cliente se registra con su código.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((a) => {
              const left = daysUntil(a.period_end);
              return (
                <li key={a.id}>
                  <button onClick={() => setSelected(a)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left hover:bg-paper">
                    <span data-mode={a.kind} className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] font-display font-semibold text-[var(--accent)]">{a.name.charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {MODALITIES[a.kind].short}{a.specialties.length ? ` · ${a.specialties.map(specName).join(", ")}` : ""} · @{a.owner_username ?? "—"}{a.owner_phone ? ` · ${a.owner_phone}` : ""}
                      </span>
                    </span>
                    <span className="text-right text-sm">
                      <span className="block font-medium">{a.plan_name ?? "—"}</span>
                      <span className={cx("block text-xs", left !== null && left <= 7 ? "text-warn" : "text-muted")}>
                        {a.period_end ? `Vence ${formatDate(a.period_end)}` : ""}
                      </span>
                    </span>
                    <span className="flex w-28 justify-end gap-1">
                      {a.is_disabled ? <Badge tone="danger">Desactivada</Badge> : a.subscription_status && <Badge tone={STATUS_TONE[a.subscription_status]}>{STATUS_LABEL[a.subscription_status]}</Badge>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {selected && <AccountDialog account={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AccountDialog({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [days, setDays] = useState("30");
  const [planId, setPlanId] = useState(account.plan_id ?? "");
  const [status, setStatus] = useState<SubscriptionStatus>(account.subscription_status ?? "active");
  const [notes, setNotes] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: ["admin-plans-kind", account.kind],
    queryFn: async () => unwrap<Plan[]>(await supabase.from("plans").select("*").eq("kind", account.kind).order("sort")),
  });
  const history = useQuery({
    queryKey: ["admin-history", account.id],
    queryFn: async () => unwrap<{ id: number; action: string; status: string | null; days_added: number | null; period_end: string | null; notes: string | null; created_at: string }[]>(
      await supabase.from("subscription_history").select("id, action, status, days_added, period_end, notes, created_at").eq("workspace_id", account.id).order("created_at", { ascending: false }).limit(20)),
  });

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(key);
    setMsg(null);
    const { error } = await fn();
    setBusy(null);
    if (error) return setMsg({ tone: "danger", text: error.message });
    setMsg({ tone: "ok", text: ok });
    await Promise.all([qc.invalidateQueries({ queryKey: ["admin-accounts"] }), qc.invalidateQueries({ queryKey: ["admin-history", account.id] }), qc.invalidateQueries({ queryKey: ["admin-metrics"] })]);
  }

  return (
    <Dialog open onClose={onClose} title={account.name} wide>
      <div data-mode={account.kind} className="space-y-6">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="accent">{MODALITIES[account.kind].product}</Badge>
          {account.subscription_status && <Badge tone={STATUS_TONE[account.subscription_status]}>{STATUS_LABEL[account.subscription_status]}</Badge>}
          <span className="text-muted">Propietario: {account.owner_name} (@{account.owner_username}) · Alta {formatDate(account.created_at)}</span>
        </div>
        {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

        <Card>
          <CardHeader title="Extender suscripción" description={`Vigente hasta ${formatDate(account.period_end, { withTime: true })}. Los días se suman desde el vencimiento (o desde hoy si ya venció).`} />
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-[120px_1fr_auto] sm:items-end">
            <Field label="Días">{(id) => <Input id={id} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
            <Field label="Pago" optional>
              {(id) => (
                <div className="flex items-center gap-2">
                  <Input id={id} readOnly value={paymentId ? "Pago registrado ✓" : ""} placeholder="Sin pago asociado" />
                  <Button type="button" variant="secondary" onClick={() => setPayOpen(true)}>Registrar</Button>
                </div>
              )}
            </Field>
            <Button loading={busy === "extend"} onClick={() => void run("extend",
              () => supabase.rpc("admin_extend_subscription", { p_workspace_id: account.id, p_days: Number(days), p_payment_id: paymentId, p_notes: notes || null }),
              `Se agregaron ${days} días.`)}>Extender</Button>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title="Plan" />
            <div className="space-y-3 px-5 py-4">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price, p.currency_code)}</option>)}
              </Select>
              <Button variant="secondary" className="w-full" disabled={planId === account.plan_id} loading={busy === "plan"}
                onClick={() => void run("plan", () => supabase.rpc("admin_change_plan", { p_workspace_id: account.id, p_plan_id: planId, p_notes: notes || null }), "Plan actualizado.")}>
                Cambiar plan
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Estado" />
            <div className="space-y-3 px-5 py-4">
              <Select value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
                {(Object.keys(STATUS_LABEL) as SubscriptionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
              <Button variant="secondary" className="w-full" disabled={status === account.subscription_status} loading={busy === "status"}
                onClick={() => void run("status", () => supabase.rpc("admin_set_subscription_status", { p_workspace_id: account.id, p_status: status, p_notes: notes || null }), "Estado actualizado.")}>
                Aplicar estado
              </Button>
            </div>
          </Card>
        </div>
        <Field label="Nota para el historial" optional>{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo del cambio" />}</Field>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger-soft/50 px-4 py-3">
          <div className="text-sm">
            <div className="font-semibold">{account.is_disabled ? "Cuenta desactivada" : "Desactivar cuenta"}</div>
            <div className="text-muted">{account.is_disabled ? "Los miembros no pueden acceder." : "Bloquea el acceso de todos los miembros a este espacio (no borra datos)."}</div>
          </div>
          <Button variant={account.is_disabled ? "secondary" : "danger"} loading={busy === "disable"}
            onClick={() => {
              if (!account.is_disabled && !confirm("¿Desactivar el acceso a esta cuenta?")) return;
              void run("disable", () => supabase.rpc("admin_set_workspace_disabled", { p_workspace_id: account.id, p_disabled: !account.is_disabled, p_notes: notes || null }),
                account.is_disabled ? "Cuenta reactivada." : "Cuenta desactivada.").then(onClose);
            }}>
            {account.is_disabled ? "Reactivar" : "Desactivar"}
          </Button>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Historial</h3>
          {history.isLoading ? <Spinner /> : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {(history.data ?? []).map((h) => (
                <li key={h.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>{h.action}{h.status ? ` → ${STATUS_LABEL[h.status as SubscriptionStatus] ?? h.status}` : ""}{h.days_added ? ` · +${h.days_added} días` : ""}
                    {h.notes && <span className="block text-xs text-muted">{h.notes}</span>}</span>
                  <span className="shrink-0 text-xs text-muted">{formatDate(h.created_at, { withTime: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {payOpen && <PaymentDialog workspaceId={account.id} defaultName={account.owner_name ?? account.name} onClose={() => setPayOpen(false)}
        onSaved={(id) => { setPaymentId(id); setPayOpen(false); }} />}
    </Dialog>
  );
}
