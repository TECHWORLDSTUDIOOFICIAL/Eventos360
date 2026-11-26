import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Copy, KeyRound, MessageCircle, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { unwrap, useSpecialties } from "@/lib/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { MODALITIES } from "@/lib/modalities";
import type { AccessCodePurpose, Plan, WorkspaceKind } from "@/lib/types";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";

interface CodeRow {
  id: string; code_hint: string; purpose: AccessCodePurpose; kind: WorkspaceKind | null; duration_days: number | null;
  specialty_keys: string[]; label: string | null; max_uses: number; use_count: number; expires_at: string;
  status: "active" | "used" | "revoked"; created_at: string; plans: { name: string; duration_days: number } | null;
}

const PURPOSE_LABEL: Record<AccessCodePurpose, string> = { signup: "Registro nuevo", renewal: "Renovación", platform_admin: "Administrador" };

function codeState(c: CodeRow): { label: string; tone: "ok" | "neutral" | "danger" | "warn" } {
  if (c.status === "revoked") return { label: "Anulado", tone: "danger" };
  if (c.status === "used") return { label: "Usado", tone: "neutral" };
  if (new Date(c.expires_at) <= new Date()) return { label: "Vencido", tone: "warn" };
  return { label: "Disponible", tone: "ok" };
}

export default function AdminCodes() {
  const qc = useQueryClient();
  const { platformRole } = useAuth();
  const { data: specialties } = useSpecialties();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ code: string; purpose: AccessCodePurpose; plan?: string; kind?: WorkspaceKind } | null>(null);
  const [filter, setFilter] = useState<"all" | "active">("active");

  const codes = useQuery({
    queryKey: ["admin-codes"],
    queryFn: async () =>
      unwrap<CodeRow[]>(await supabase.from("access_codes").select("*, plans(name, duration_days)").order("created_at", { ascending: false }).limit(300)),
  });
  const plans = useQuery({
    queryKey: ["admin-plans-all"],
    queryFn: async () => unwrap<Plan[]>(await supabase.from("plans").select("*").order("kind").order("sort")),
  });

  async function revoke(id: string) {
    if (!confirm("¿Anular este código? Ya no podrá usarse.")) return;
    const { error } = await supabase.rpc("admin_revoke_access_code", { p_id: id });
    if (error) return alert(error.message);
    await qc.invalidateQueries({ queryKey: ["admin-codes"] });
  }

  const list = (codes.data ?? []).filter((c) => filter === "all" || codeState(c).label === "Disponible");
  const specName = (k: string) => specialties?.find((s) => s.key === k)?.name ?? k;

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Códigos de acceso"
        description="Genera un código cuando confirmes un pago. El cliente lo usa para crear su cuenta o renovar su plan."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Nuevo código</Button>} />

      <div className="mb-4 flex gap-2">
        {(["active", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cx("rounded-full px-3 py-1.5 text-sm font-medium", filter === f ? "bg-ink text-paper" : "bg-card text-ink-soft border border-line")}>
            {f === "active" ? "Disponibles" : "Todos"}
          </button>
        ))}
      </div>

      <Card>
        {codes.isLoading ? <Spinner /> : list.length === 0 ? (
          <EmptyState icon={<KeyRound className="size-6" />} title="No hay códigos" action={<Button onClick={() => setOpen(true)}>Generar el primero</Button>}>
            Los códigos se muestran completos solo al crearlos. Aquí verás sus últimos 4 caracteres.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <tr><th className="px-5 py-3 font-semibold">Código</th><th className="px-3 py-3 font-semibold">Tipo</th><th className="px-3 py-3 font-semibold">Plan</th>
                  <th className="px-3 py-3 font-semibold">Cliente / nota</th><th className="px-3 py-3 font-semibold">Vence</th><th className="px-3 py-3 font-semibold">Estado</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((c) => {
                  const st = codeState(c);
                  return (
                    <tr key={c.id} className="align-top">
                      <td className="px-5 py-3 font-mono text-xs">E360-…-{c.code_hint}</td>
                      <td className="px-3 py-3">{PURPOSE_LABEL[c.purpose]}{c.kind && <div className="text-xs text-muted">{MODALITIES[c.kind].short}</div>}</td>
                      <td className="px-3 py-3">{c.plans?.name ?? "—"}<div className="text-xs text-muted">
                        {c.plans ? `${c.duration_days ?? c.plans.duration_days} días` : ""}{c.specialty_keys.length ? ` · ${c.specialty_keys.map(specName).join(", ")}` : ""}</div></td>
                      <td className="px-3 py-3">{c.label ?? <span className="text-faint">—</span>}{c.max_uses > 1 && <div className="text-xs text-muted">{c.use_count}/{c.max_uses} usos</div>}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDate(c.expires_at)}</td>
                      <td className="px-3 py-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td className="px-5 py-3 text-right">
                        {st.label === "Disponible" && (
                          <button onClick={() => void revoke(c.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-danger hover:underline"><Ban className="size-3.5" />Anular</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <NewCodeDialog plans={plans.data ?? []} isOwner={platformRole === "owner"} onClose={() => setOpen(false)}
          onCreated={async (c) => { setOpen(false); setCreated(c); await qc.invalidateQueries({ queryKey: ["admin-codes"] }); }} />
      )}
      {created && <CreatedDialog created={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function NewCodeDialog({ plans, isOwner, onClose, onCreated }: {
  plans: Plan[]; isOwner: boolean; onClose: () => void;
  onCreated: (c: { code: string; purpose: AccessCodePurpose; plan?: string; kind?: WorkspaceKind }) => void;
}) {
  const { data: specialties } = useSpecialties();
  const [purpose, setPurpose] = useState<AccessCodePurpose>("signup");
  const [kind, setKind] = useState<WorkspaceKind>("personal");
  const [planId, setPlanId] = useState("");
  const [days, setDays] = useState("");
  const [specs, setSpecs] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [targetWs, setTargetWs] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [expiresIn, setExpiresIn] = useState("30");
  const [maxUses, setMaxUses] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kindPlans = useMemo(() => plans.filter((p) => p.kind === kind && p.is_active), [plans, kind]);
  const plan = kindPlans.find((p) => p.id === planId) ?? kindPlans[0];

  const workspaces = useQuery({
    queryKey: ["admin-ws-for-code", kind],
    enabled: purpose === "renewal",
    queryFn: async () => unwrap<{ id: string; name: string; owner_username: string | null }[]>(await supabase.rpc("admin_list_workspaces", { p_kind: kind })),
  });
  const payments = useQuery({
    queryKey: ["admin-unlinked-payments"],
    queryFn: async () => unwrap<{ id: string; payer_name: string; amount: number; currency_code: string; paid_at: string }[]>(
      await supabase.from("manual_payments").select("id, payer_name, amount, currency_code, paid_at").is("workspace_id", null).order("created_at", { ascending: false }).limit(30)),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const expires = new Date(Date.now() + Number(expiresIn || 30) * 86_400_000).toISOString();
    const { data, error: err } = await supabase.rpc("admin_create_access_code", {
      p_purpose: purpose,
      p_plan_id: purpose === "platform_admin" ? null : plan?.id,
      p_duration_days: days ? Number(days) : null,
      p_specialty_keys: purpose === "signup" && kind === "business" ? specs : [],
      p_label: label || null,
      p_expires_at: expires,
      p_target_workspace_id: purpose === "renewal" && targetWs ? targetWs : null,
      p_payment_id: paymentId || null,
      p_max_uses: Number(maxUses || 1),
    });
    setBusy(false);
    if (err) return setError(err.message);
    const row = (data as { code: string }[])[0];
    if (row) onCreated({ code: row.code, purpose, plan: plan?.name, kind: purpose === "platform_admin" ? undefined : kind });
  }

  return (
    <Dialog open onClose={onClose} title="Nuevo código de acceso" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="new-code" loading={busy}>Generar código</Button></>}>
      <form id="new-code" onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-3 gap-2">
          {(["signup", "renewal", ...(isOwner ? ["platform_admin"] : [])] as AccessCodePurpose[]).map((p) => (
            <button key={p} type="button" onClick={() => setPurpose(p)}
              className={cx("rounded-xl border px-3 py-2.5 text-sm font-semibold", purpose === p ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-line-strong")}>
              {PURPOSE_LABEL[p]}
            </button>
          ))}
        </div>
        {purpose === "platform_admin" ? (
          <Alert tone="warn">Este código crea una cuenta con acceso total al panel de administración. Entrégalo solo a personas de confianza.</Alert>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Modalidad">
                {(id) => (
                  <Select id={id} value={kind} onChange={(e) => { setKind(e.target.value as WorkspaceKind); setPlanId(""); setSpecs([]); setTargetWs(""); }}>
                    {(Object.keys(MODALITIES) as WorkspaceKind[]).map((k) => <option key={k} value={k}>{MODALITIES[k].product}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Plan">
                {(id) => (
                  <Select id={id} value={plan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)}>
                    {kindPlans.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price, p.currency_code)} / {p.duration_days} días</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Días de servicio" hint={`Vacío = duración del plan (${plan?.duration_days ?? "—"} días)`} optional>
                {(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} />}
              </Field>
              {purpose === "renewal" && (
                <Field label="Cuenta a renovar" hint="Si eliges una, solo esa cuenta podrá usar el código." optional>
                  {(id, d) => (
                    <Select id={id} aria-describedby={d} value={targetWs} onChange={(e) => setTargetWs(e.target.value)}>
                      <option value="">Cualquier cuenta de esta modalidad</option>
                      {(workspaces.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}{w.owner_username ? ` (@${w.owner_username})` : ""}</option>)}
                    </Select>
                  )}
                </Field>
              )}
            </div>
            {purpose === "signup" && kind === "business" && (
              <div>
                <div className="mb-1.5 text-sm font-medium">Especialidades predefinidas <span className="font-normal text-faint">(opcional: si no eliges, el cliente las selecciona)</span></div>
                <div className="flex flex-wrap gap-2">
                  {(specialties ?? []).map((s) => {
                    const on = specs.includes(s.key);
                    return (
                      <button key={s.key} type="button" onClick={() => setSpecs((c) => (on ? c.filter((k) => k !== s.key) : [...c, s.key]))}
                        className={cx("rounded-full border px-3 py-1 text-xs font-semibold", on ? "border-business bg-business text-white" : "border-line bg-card text-ink-soft")}>
                        {specs.indexOf(s.key) === 0 && "★ "}{s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cliente / nota interna" optional>
            {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej. Decoraciones Ana, pagó por BAC" />}
          </Field>
          <Field label="Pago asociado" optional>
            {(id) => (
              <Select id={id} value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
                <option value="">Sin pago asociado</option>
                {(payments.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.payer_name} · {formatMoney(p.amount, p.currency_code)} · {formatDate(p.paid_at)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="El código caduca en (días)" hint="Si no se usa en este plazo, deja de funcionar.">
            {(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} max={365} value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} />}
          </Field>
          <Field label="Usos permitidos">
            {(id) => <Input id={id} type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />}
          </Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

function CreatedDialog({ created, onClose }: { created: { code: string; purpose: AccessCodePurpose; plan?: string; kind?: WorkspaceKind }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const site = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
  const message = created.purpose === "renewal"
    ? `Tu código de renovación de Eventos360 (${created.plan}) es: ${created.code}\nIngresa a tu cuenta → Suscripción → Aplicar código.`
    : `¡Bienvenido a Eventos360! Tu código de acceso${created.kind ? ` para ${MODALITIES[created.kind].product}` : ""} es: ${created.code}\nCrea tu cuenta en ${site}/registro`;

  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopied(true); } catch { /* el usuario puede copiar manualmente */ }
  }
  return (
    <Dialog open onClose={onClose} title="Código generado" footer={<Button onClick={onClose}>Listo</Button>}>
      <Alert tone="warn">Copia el código ahora. Por seguridad no se guarda en claro y no podrás verlo de nuevo.</Alert>
      <div className="mt-5 rounded-2xl border-2 border-dashed border-line-strong bg-paper p-5 text-center">
        <div className="select-all break-all font-mono text-xl font-semibold tracking-wider sm:text-2xl">{created.code}</div>
        {created.plan && <div className="mt-2 text-sm text-muted">{created.plan}</div>}
      </div>
      <Field label="Mensaje para el cliente">
        {(id) => <textarea id={id} readOnly value={message} className="mt-1 h-28 w-full rounded-xl border border-line bg-card p-3 text-sm" />}
      </Field>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => void copy()}>{copied ? "¡Copiado!" : "Copiar mensaje"}</Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1f8b4c] px-4 text-sm font-semibold text-white hover:brightness-110">
          <MessageCircle className="size-4" /> Enviar por WhatsApp
        </a>
      </div>
    </Dialog>
  );
}
