import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, MessageCircle, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatAccessCode } from "@/lib/accounts";
import { formatDate, formatMoney } from "@/lib/format";
import { MODALITIES, STATUS_LABEL, STATUS_TONE } from "@/lib/modalities";
import { unwrap, useFeatures, usePlatformSettings, useWorkspaceEntitlements, whatsappLink } from "@/lib/queries";
import { featureReady } from "@/lib/modules";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Spinner } from "@/components/ui";

const ACTION_LABEL: Record<string, string> = {
  created: "Alta de la cuenta", renewed: "Renovación con código", extended: "Extensión por soporte",
  plan_changed: "Cambio de plan", status_changed: "Cambio de estado",
};

export default function SubscriptionPage() {
  const { ws, canManage } = useWorkspace();
  const qc = useQueryClient();
  const { data: features } = useFeatures();
  const { data: ent } = useWorkspaceEntitlements(ws.id);
  const { data: settings } = usePlatformSettings();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const history = useQuery({
    queryKey: ["ws-sub-history", ws.id],
    enabled: canManage,
    queryFn: async () =>
      unwrap<{ id: number; action: string; status: string | null; period_end: string | null; days_added: number | null; created_at: string; plans: { name: string } | null }[]>(
        await supabase.from("subscription_history").select("id, action, status, period_end, days_added, created_at, plans(name)")
          .eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(50),
      ),
  });
  const payments = useQuery({
    queryKey: ["ws-payments", ws.id],
    enabled: canManage,
    queryFn: async () =>
      unwrap<{ id: string; amount: number; currency_code: string; method: string; paid_at: string; reference: string | null }[]>(
        await supabase.from("manual_payments").select("id, amount, currency_code, method, paid_at, reference").eq("workspace_id", ws.id).order("paid_at", { ascending: false }),
      ),
  });

  async function redeem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("redeem_renewal_code", { p_workspace_id: ws.id, p_code: code });
    setBusy(false);
    if (error) return setMsg({ tone: "danger", text: error.message });
    const r = data as { ok: boolean; message?: string; plan_name?: string; period_end?: string };
    if (!r.ok) return setMsg({ tone: "danger", text: r.message ?? "Código no válido" });
    setCode("");
    setMsg({ tone: "ok", text: `Renovación aplicada: ${r.plan_name}, vigente hasta el ${formatDate(r.period_end)}.` });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["my-workspaces"] }),
      qc.invalidateQueries({ queryKey: ["ws-sub-history", ws.id] }),
      qc.invalidateQueries({ queryKey: ["ws-entitlements", ws.id] }),
      qc.invalidateQueries({ queryKey: ["ws-modules", ws.id] }),
    ]);
  }

  const wa = whatsappLink(settings, `Hola, quiero renovar mi plan de ${MODALITIES[ws.kind].product} (${ws.name}).`);
  const entMap = new Map((ent ?? []).map((e) => [e.feature_key, e]));

  return (
    <div className="animate-rise">
      <PageHeader title="Suscripción" description="Tu plan, sus límites y la renovación con código." />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title={ws.plan_name ?? "Sin plan"} description={MODALITIES[ws.kind].product}
            action={ws.subscription_status && <Badge tone={STATUS_TONE[ws.subscription_status]}>{STATUS_LABEL[ws.subscription_status]}</Badge>} />
          <div className="px-5 py-4 text-sm">
            Vigente hasta el <strong>{formatDate(ws.period_end, { withTime: true })}</strong>
          </div>
          <div className="border-t border-line px-5 py-4">
            <h3 className="mb-3 text-sm font-semibold">Incluye</h3>
            {!features || !ent ? <Spinner /> : (
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {features.filter((f) => featureReady(f.key, ws.kind) && (entMap.get(f.key)?.is_enabled || f.value_type === "boolean")).map((f) => {
                  const e = entMap.get(f.key);
                  const on = !!e?.is_enabled;
                  return (
                    <li key={f.key} className="flex items-center gap-2 text-sm">
                      {on ? <Check className="size-4 text-ok" /> : <Minus className="size-4 text-faint" />}
                      <span className={on ? "" : "text-faint"}>{f.name}</span>
                      {on && f.value_type === "limit" && <span className="ml-auto font-semibold tabular-nums">{e?.limit_value ?? "Ilimitado"}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Renovar" description="Ingresa el código que recibiste al pagar tu renovación." />
          <div className="px-5 py-5">
            {canManage ? (
              <form onSubmit={redeem} className="space-y-4">
                <Field label="Código de renovación">
                  {(id) => <Input id={id} value={code} onChange={(e) => setCode(formatAccessCode(e.target.value))} placeholder="E360-____-____-____-____" className="font-mono tracking-wider" autoComplete="off" />}
                </Field>
                {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
                <Button type="submit" className="w-full" loading={busy} disabled={code.length < 24} icon={<KeyRound className="size-4" />}>Aplicar código</Button>
              </form>
            ) : (
              <Alert tone="info">Solo el propietario o un administrador del espacio puede renovar la suscripción.</Alert>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline">
                <MessageCircle className="size-4" /> Solicitar renovación por WhatsApp
              </a>
            )}
          </div>
        </Card>
      </div>

      {canManage && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Historial" />
            {history.isLoading ? <Spinner /> : (
              <ul className="divide-y divide-line">
                {(history.data ?? []).map((h) => (
                  <li key={h.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <div className="font-medium">{ACTION_LABEL[h.action] ?? h.action}{h.days_added ? ` · +${h.days_added} días` : ""}</div>
                      <div className="text-xs text-muted">{h.plans?.name ?? ""}{h.period_end ? ` · hasta ${formatDate(h.period_end)}` : ""}</div>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{formatDate(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Pagos registrados" />
            {payments.isLoading ? <Spinner /> : (payments.data ?? []).length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No hay pagos asociados a este espacio.</p>
            ) : (
              <ul className="divide-y divide-line">
                {(payments.data ?? []).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <div className="font-semibold tabular-nums">{formatMoney(p.amount, p.currency_code)}</div>
                      <div className="text-xs capitalize text-muted">{p.method}{p.reference ? ` · Ref. ${p.reference}` : ""}</div>
                    </div>
                    <span className="text-xs text-muted">{formatDate(p.paid_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
