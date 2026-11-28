import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useCateringSettings } from "@/lib/catering";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, CardHeader, Field, Input } from "@/components/ui";

const DESCRIPTIONS: Record<string, string> = {
  tastings: "Agenda pruebas de menú con tus clientes: qué probaron, cuánto se cobró y qué cambios pidieron.",
};

/** Módulos que el negocio decide usar o no (por ejemplo, Degustaciones). */
export function OptionalModulesCard() {
  const { ws, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["optional-modules", ws.id],
    queryFn: async () => unwrap<{ module_key: string; name: string; enabled: boolean }[]>(await supabase.rpc("workspace_optional_modules", { p_ws: ws.id })),
  });
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  if (!data?.length) return null;
  async function toggle(key: string, enabled: boolean) {
    setError(null);
    setLocal((s) => ({ ...s, [key]: enabled }));
    const { error: err } = await supabase.rpc("workspace_set_module", { p_ws: ws.id, p_module: key, p_enabled: enabled });
    if (err) { setLocal((s) => ({ ...s, [key]: !enabled })); return setError(err.message); }
    await Promise.all([qc.invalidateQueries({ queryKey: ["optional-modules", ws.id] }), qc.invalidateQueries({ queryKey: ["ws-modules", ws.id] }), qc.invalidateQueries({ queryKey: ["workspace-modules"] })]);
  }
  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader title="Módulos opcionales" description="Actívalos solo si los usas; aparecen en el menú al encenderlos." />
      <ul className="divide-y divide-line">
        {data.map((m) => (
          <li key={m.module_key} className="flex items-center gap-4 px-5 py-4">
            <span className="min-w-0 flex-1"><span className="block font-medium">{m.name}</span><span className="block text-sm text-muted">{DESCRIPTIONS[m.module_key] ?? ""}</span></span>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" className="peer sr-only" checked={local[m.module_key] ?? m.enabled} disabled={readOnly} onChange={(e) => void toggle(m.module_key, e.target.checked)} aria-label={`Activar ${m.name}`} />
              <span className="h-6 w-11 rounded-full bg-line-strong transition peer-checked:bg-[var(--accent)] peer-disabled:opacity-50" />
              <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </label>
          </li>
        ))}
      </ul>
      {error && <div className="px-5 pb-4"><Alert tone="danger">{error}</Alert></div>}
    </Card>
  );
}

/** Reglas de catering del negocio (cada pedido puede cambiar su propio cierre). */
export function CateringSettingsCard() {
  const { ws, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const { data } = useCateringSettings(ws.id);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const v = f ?? { cutoff_days: String(data.cutoff_days), kids_portion: String(Number(data.kids_portion) * 100), guests_per_waiter: String(data.guests_per_waiter), food_cost_target: String(Number(data.food_cost_target)) };
  const set = (k: string, val: string) => setF({ ...v, [k]: val });
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const row = { workspace_id: ws.id, cutoff_days: Number(v.cutoff_days), kids_portion: Number(v.kids_portion) / 100, guests_per_waiter: Number(v.guests_per_waiter), food_cost_target: Number(v.food_cost_target), updated_at: new Date().toISOString() };
    const { error } = await supabase.from("catering_settings").upsert(row);
    setBusy(false);
    if (error) return setMsg({ tone: "danger", text: error.message.includes("check") ? "Revisa los valores: cierre 0–90 días, porción de niño 0–100 %, meseros 1–100, meta 1–100 %." : error.message });
    setMsg({ tone: "ok", text: "Ajustes de catering guardados." });
    await qc.invalidateQueries({ queryKey: ["catering-settings", ws.id] });
  }
  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader title="Catering" description="Reglas para tus pedidos. Cada pedido puede tener su propio cierre." />
      <form onSubmit={save} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <Field label="Cierre del número de invitados" hint="Días antes del evento; después solo se puede aumentar.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="0" max="90" value={v.cutoff_days} onChange={(e) => set("cutoff_days", e.target.value)} disabled={readOnly} />}</Field>
        <Field label="Porción de niño (%)" hint="De la porción de un adulto.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="0" max="100" value={v.kids_portion} onChange={(e) => set("kids_portion", e.target.value)} disabled={readOnly} />}</Field>
        <Field label="Invitados por mesero" hint="Para sugerir cuánto personal llevar.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="1" max="100" value={v.guests_per_waiter} onChange={(e) => set("guests_per_waiter", e.target.value)} disabled={readOnly} />}</Field>
        <Field label="Meta de costo de comida (%)" hint="Del precio sin IVA. Lo sano suele estar entre 28 y 35 %.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="1" max="100" value={v.food_cost_target} onChange={(e) => set("food_cost_target", e.target.value)} disabled={readOnly} />}</Field>
        {msg && <div className="sm:col-span-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={busy} disabled={readOnly}>Guardar ajustes de catering</Button></div>
      </form>
    </Card>
  );
}
