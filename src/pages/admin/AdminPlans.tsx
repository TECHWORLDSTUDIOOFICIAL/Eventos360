import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap, useEntitlements, useFeatures } from "@/lib/queries";
import { formatMoney } from "@/lib/format";
import { MODALITIES } from "@/lib/modalities";
import type { Plan, WorkspaceKind } from "@/lib/types";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";

export default function AdminPlans() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const plans = useQuery({
    queryKey: ["admin-plans-all"],
    queryFn: async () => unwrap<Plan[]>(await supabase.from("plans").select("*").order("kind").order("sort")),
  });
  const { data: features } = useFeatures();
  const { data: ents } = useEntitlements();

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Planes y precios"
        description="Precios, duración y límites de cada plan. Los cambios aplican de inmediato a todas las cuentas del plan."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo plan</Button>} />
      {plans.isLoading ? <Spinner /> : (
        <div className="space-y-6">
          {(Object.keys(MODALITIES) as WorkspaceKind[]).map((k) => (
            <Card key={k}>
              <div data-mode={k}><CardHeader title={MODALITIES[k].product} /></div>
              <ul className="divide-y divide-line">
                {(plans.data ?? []).filter((p) => p.kind === k).map((p) => {
                  const pe = (ents ?? []).filter((e) => e.plan_id === p.id && e.is_enabled);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{p.name}</span>
                          {!p.is_active && <Badge tone="danger">Inactivo</Badge>}
                          {p.is_active && !p.is_public && <Badge tone="neutral">Oculto</Badge>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                          {pe.map((e) => {
                            const f = features?.find((x) => x.key === e.feature_key);
                            return <span key={e.feature_key}>{f?.name}{f?.value_type === "limit" ? `: ${e.limit_value ?? "∞"}` : ""}</span>;
                          })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-xl font-semibold tabular-nums">{formatMoney(p.price, p.currency_code)}</div>
                        <div className="text-xs text-muted">{p.duration_days} días</div>
                      </div>
                      <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(p)}>Editar</Button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([qc.invalidateQueries({ queryKey: ["admin-plans-all"] }), qc.invalidateQueries({ queryKey: ["plan-entitlements"] }), qc.invalidateQueries({ queryKey: ["public-plans"] })]);
          }} />
      )}
    </div>
  );
}

function PlanDialog({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const { data: features } = useFeatures();
  const { data: ents } = useEntitlements();
  const [f, setF] = useState({
    key: plan?.key ?? "", kind: plan?.kind ?? ("business" as WorkspaceKind), name: plan?.name ?? "", description: plan?.description ?? "",
    price: String(plan?.price ?? ""), currency_code: plan?.currency_code ?? "USD", duration_days: String(plan?.duration_days ?? 30),
    is_active: plan?.is_active ?? true, is_public: plan?.is_public ?? true, sort: String(plan?.sort ?? 100),
  });
  const initial = Object.fromEntries((ents ?? []).filter((e) => e.plan_id === plan?.id).map((e) => [e.feature_key, { on: e.is_enabled, limit: e.limit_value === null ? "" : String(e.limit_value) }]));
  const [ent, setEnt] = useState<Record<string, { on: boolean; limit: string }>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!plan && !/^[a-z0-9_]+$/.test(f.key)) return setError("La clave debe usar minúsculas, números y guion bajo.");
    setBusy(true);
    const row = {
      name: f.name.trim(), description: f.description.trim() || null, price: Number(f.price), currency_code: f.currency_code,
      duration_days: Number(f.duration_days), is_active: f.is_active, is_public: f.is_public, sort: Number(f.sort),
    };
    const res = plan
      ? await supabase.from("plans").update(row).eq("id", plan.id).select("id").single()
      : await supabase.from("plans").insert({ ...row, key: f.key, kind: f.kind }).select("id").single();
    if (res.error) { setBusy(false); return setError(res.error.message); }
    const planId = (res.data as { id: string }).id;
    const rows = (features ?? []).filter((x) => ent[x.key]).map((x) => ({
      plan_id: planId, feature_key: x.key, is_enabled: ent[x.key]!.on,
      limit_value: x.value_type === "limit" && ent[x.key]!.limit !== "" ? Number(ent[x.key]!.limit) : null,
    }));
    if (rows.length) {
      const { error: eErr } = await supabase.from("plan_entitlements").upsert(rows, { onConflict: "plan_id,feature_key" });
      if (eErr) { setBusy(false); return setError(eErr.message); }
    }
    setBusy(false);
    onSaved();
  }

  return (
    <Dialog open onClose={onClose} title={plan ? `Editar ${plan.name}` : "Nuevo plan"} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="plan-form" loading={busy}>Guardar</Button></>}>
      <form id="plan-form" onSubmit={submit} className="space-y-5">
        {plan && <Alert tone="warn">Los cambios de precio no se aplican retroactivamente a pagos ya registrados; los límites sí aplican de inmediato a las cuentas de este plan.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          {!plan && (
            <>
              <Field label="Modalidad">{(id) => <Select id={id} value={f.kind} onChange={(e) => set("kind", e.target.value as WorkspaceKind)}>{(Object.keys(MODALITIES) as WorkspaceKind[]).map((k) => <option key={k} value={k}>{MODALITIES[k].product}</option>)}</Select>}</Field>
              <Field label="Clave interna" hint="Ej. biz_premium (no se puede cambiar)">{(id, d) => <Input id={id} aria-describedby={d} value={f.key} onChange={(e) => set("key", e.target.value.toLowerCase())} />}</Field>
            </>
          )}
          <Field label="Nombre">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <Field label="Precio">{(id) => <Input id={id} type="number" min={0} step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} />}</Field>
            <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option>USD</option><option>NIO</option></Select>}</Field>
          </div>
          <Field label="Duración (días)">{(id) => <Input id={id} type="number" min={1} value={f.duration_days} onChange={(e) => set("duration_days", e.target.value)} />}</Field>
          <Field label="Orden">{(id) => <Input id={id} type="number" value={f.sort} onChange={(e) => set("sort", e.target.value)} />}</Field>
          <div className="sm:col-span-2"><Field label="Descripción" optional>{(id) => <Textarea id={id} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" /> Activo (se pueden emitir códigos)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_public} onChange={(e) => set("is_public", e.target.checked)} className="size-4 accent-ink" /> Visible en la página pública</label>
        </div>
        <Card>
          <CardHeader title="Funcionalidades y límites" description="Límite vacío = ilimitado." />
          <ul className="divide-y divide-line">
            {(features ?? []).map((x) => {
              const v = ent[x.key] ?? { on: false, limit: "" };
              return (
                <li key={x.key} className="flex items-center gap-3 px-5 py-2.5">
                  <input type="checkbox" checked={v.on} onChange={(e) => setEnt((s) => ({ ...s, [x.key]: { ...v, on: e.target.checked } }))} className="size-4 accent-ink" aria-label={x.name} />
                  <span className="flex-1 text-sm">{x.name}</span>
                  {x.value_type === "limit" && (
                    <Input type="number" min={0} value={v.limit} disabled={!v.on} placeholder="∞" className="h-9 w-28"
                      onChange={(e) => setEnt((s) => ({ ...s, [x.key]: { ...v, limit: e.target.value } }))} aria-label={`Límite de ${x.name}`} />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
