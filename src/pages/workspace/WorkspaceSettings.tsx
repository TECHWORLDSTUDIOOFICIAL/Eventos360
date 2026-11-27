import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";
import BusinessProfileCard from "./BusinessProfileCard";

interface WsRow { id: string; name: string; currency_code: string; timezone: string; locale: string; tax_rate: number; country_code: string }

const TIMEZONES = ["America/Managua", "America/Costa_Rica", "America/Tegucigalpa", "America/El_Salvador", "America/Guatemala",
  "America/Panama", "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santo_Domingo", "America/New_York", "Europe/Madrid"];
const LOCALES = [{ v: "es-NI", l: "Español (Nicaragua)" }, { v: "es-CR", l: "Español (Costa Rica)" }, { v: "es-HN", l: "Español (Honduras)" },
  { v: "es-MX", l: "Español (México)" }, { v: "es-CO", l: "Español (Colombia)" }, { v: "es-ES", l: "Español (España)" }, { v: "en-US", l: "English (US)" }];

export default function WorkspaceSettings() {
  const { ws, canManage, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const row = useQuery({
    queryKey: ["ws-row", ws.id],
    queryFn: async () => unwrap<WsRow>(await supabase.from("workspaces").select("id, name, currency_code, timezone, locale, tax_rate, country_code").eq("id", ws.id).single()),
  });
  const currencies = useQuery({
    queryKey: ["currencies"],
    queryFn: async () => unwrap<{ code: string; name: string }[]>(await supabase.from("currencies").select("code, name").eq("is_active", true).order("code")),
  });
  const [form, setForm] = useState<WsRow | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (row.data) setForm(row.data); }, [row.data]);

  if (!canManage) return <NotFound />;
  if (!form) return <Spinner />;

  const set = <K extends keyof WsRow>(k: K, v: WsRow[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setMsg(null);
    const { error, count } = await supabase.from("workspaces")
      .update({ name: form.name.trim(), currency_code: form.currency_code, timezone: form.timezone, locale: form.locale, tax_rate: Number(form.tax_rate) }, { count: "exact" })
      .eq("id", ws.id);
    setBusy(false);
    if (error) return setMsg({ tone: "danger", text: error.message });
    if (!count) return setMsg({ tone: "danger", text: "No se guardaron los cambios: tu suscripción no permite modificaciones." });
    setMsg({ tone: "ok", text: "Cambios guardados." });
    await qc.invalidateQueries({ queryKey: ["my-workspaces"] });
    await qc.invalidateQueries({ queryKey: ["ws-row", ws.id] });
    await qc.invalidateQueries({ queryKey: ["ws-region", ws.id] });
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Configuración" description="Datos generales y formato regional de tu espacio." />
      <Card className="max-w-2xl">
        <CardHeader title="General" />
        <form onSubmit={save} className="space-y-5 px-5 py-5">
          {readOnly && <Alert tone="warn">El espacio está en modo solo lectura hasta que renueves tu suscripción.</Alert>}
          <Field label="Nombre">
            {(id) => <Input id={id} value={form.name} onChange={(e) => set("name", e.target.value)} disabled={readOnly} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Moneda principal" hint={`Ejemplo: ${formatMoney(1250.5, form.currency_code, form.locale)}`}>
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={form.currency_code} onChange={(e) => set("currency_code", e.target.value)} disabled={readOnly}>
                  {(currencies.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Impuesto por defecto (%)" hint="Se aplicará a cotizaciones cuando corresponda.">
              {(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} max={100} step="0.01" value={form.tax_rate} onChange={(e) => set("tax_rate", Number(e.target.value))} disabled={readOnly} />}
            </Field>
            <Field label="Zona horaria" hint={`Ahora: ${formatDate(new Date(), { timeZone: form.timezone, locale: form.locale, withTime: true })}`}>
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={form.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={readOnly}>
                  {Array.from(new Set([form.timezone, ...TIMEZONES])).map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Formato regional">
              {(id) => (
                <Select id={id} value={form.locale} onChange={(e) => set("locale", e.target.value)} disabled={readOnly}>
                  {LOCALES.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
                </Select>
              )}
            </Field>
          </div>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex justify-end"><Button type="submit" loading={busy} disabled={readOnly}>Guardar cambios</Button></div>
        </form>
      </Card>
      {ws.kind !== "personal" && <BusinessProfileCard />}
    </div>
  );
}
