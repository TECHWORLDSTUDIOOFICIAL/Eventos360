import { useEffect, useState, type FormEvent } from "react";
import { CookingPot, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fromLocalInput, toLocalInput } from "@/lib/events";
import { formatMoney } from "@/lib/format";
import { useCustomers } from "@/lib/pro";
import { scheduleText } from "@/lib/venues";
import { TASTING_STATUS, useInvalidateCatering, useMenuItems, useMenus, useRecipes, useTastings, type Tasting } from "@/lib/catering";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { CustomerSelect } from "@/components/QuickCreate";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

/** Degustaciones: pruebas de menú con el cliente antes de contratar (módulo opcional). */
export default function TastingsPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useTastings(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const { data: menus } = useMenus(ws.id);
  const [tab, setTab] = useState<"proximas" | "pasadas">("proximas");
  const [editing, setEditing] = useState<Tasting | "new" | null>(null);
  const now = Date.now();
  const list = (data ?? []).filter((t) => (tab === "proximas" ? new Date(t.scheduled_at).getTime() >= now - 36e5 * 3 : new Date(t.scheduled_at).getTime() < now - 36e5 * 3));
  if (tab === "pasadas") list.reverse();
  return (
    <div className="animate-rise">
      <PageHeader title="Degustaciones" description="Pruebas de menú con tus clientes: qué probaron, cuánto se cobró y qué cambios pidieron."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agendar degustación</Button>} />
      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        {([["proximas", "Próximas"], ["pasadas", "Pasadas"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
      {isLoading ? <Spinner /> : !list.length ? (
        <Card><EmptyState icon={<CookingPot className="size-6" />} title={tab === "proximas" ? "No hay degustaciones agendadas" : "Sin degustaciones pasadas"}
          action={tab === "proximas" && !readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Agendar degustación</Button>}>
          {tab === "proximas" && "Agenda la prueba de menú con fecha, cuántas personas vienen y qué platos van a probar."}
        </EmptyState></Card>
      ) : (
        <Card><ul className="divide-y divide-line">{list.map((t) => (
          <li key={t.id}><button onClick={() => setEditing(t)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-paper sm:px-5">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{customers?.find((c) => c.id === t.customer_id)?.name}</span>
              <span className="block truncate text-xs text-muted first-letter:uppercase">{[scheduleText(t.scheduled_at, t.scheduled_at, region.timezone, region.locale).split(" – ")[0], `${t.people} personas`, menus?.find((m) => m.id === t.menu_id)?.name].filter(Boolean).join(" · ")}</span></span>
            {Number(t.price) > 0 && <span className="text-sm tabular-nums">{formatMoney(Number(t.price), t.currency_code, region.locale)}</span>}
            <Badge tone={TASTING_STATUS[t.status]!.tone}>{TASTING_STATUS[t.status]!.label}</Badge>
          </button></li>))}
        </ul></Card>
      )}
      {editing && <TastingDialog tasting={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TastingDialog({ tasting, onClose }: { tasting: Tasting | null; onClose: () => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const invalidate = useInvalidateCatering();
  const { data: menus } = useMenus(ws.id);
  const { data: menuItems } = useMenuItems(ws.id);
  const { data: recipes } = useRecipes(ws.id);
  const [f, setF] = useState({
    customer_id: tasting?.customer_id ?? "", menu_id: tasting?.menu_id ?? "", when: tasting ? toLocalInput(tasting.scheduled_at, region.timezone) : "",
    people: tasting ? String(tasting.people) : "2", dishes: tasting?.dishes ?? "", price: tasting ? String(tasting.price) : "0", currency_code: tasting?.currency_code ?? region.currency_code,
    credit_on_hire: tasting?.credit_on_hire ?? true, status: tasting?.status ?? "scheduled", result: tasting?.result ?? "", notes: tasting?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const dishesOf = (id: string) => (menuItems ?? []).filter((m) => m.menu_id === id).map((m) => recipes?.find((r) => r.id === m.recipe_id)?.name).filter(Boolean).join(", ");
  function pickMenu(id: string) {
    setF((s) => ({ ...s, menu_id: id, dishes: s.dishes || dishesOf(id), currency_code: menus?.find((m) => m.id === id)?.currency_code ?? s.currency_code }));
  }
  // Si los platos aún no habían cargado al elegir el menú, se completan al llegar.
  useEffect(() => { if (f.menu_id && !f.dishes && menuItems && recipes) set("dishes", dishesOf(f.menu_id)); }, [menuItems, recipes]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.customer_id) return setError("Elige el cliente.");
    if (!f.when) return setError("Elige fecha y hora.");
    setBusy(true);
    const row = { customer_id: f.customer_id, menu_id: f.menu_id || null, scheduled_at: fromLocalInput(f.when, region.timezone), people: Number(f.people) || 1, dishes: f.dishes.trim() || null,
      price: Number(f.price) || 0, currency_code: f.currency_code, credit_on_hire: f.credit_on_hire, status: f.status, result: f.result.trim() || null, notes: f.notes.trim() || null };
    const res = tasting ? await supabase.from("tastings").update(row).eq("id", tasting.id) : await supabase.from("tastings").insert({ ...row, workspace_id: ws.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate(); onClose();
  }
  async function remove() {
    if (!tasting || !confirm("¿Eliminar esta degustación?")) return;
    await supabase.from("tastings").delete().eq("id", tasting.id); await invalidate(); onClose();
  }
  return (
    <Dialog open onClose={onClose} title={tasting ? "Degustación" : "Agendar degustación"} wide
      footer={!readOnly && <>
        {tasting && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="tasting-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="tasting-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Cliente">{(id) => <CustomerSelect id={id} value={f.customer_id} onChange={(v) => set("customer_id", v)} />}</Field>
        <Field label="Menú a probar" optional>{(id) => <Select id={id} value={f.menu_id} onChange={(e) => pickMenu(e.target.value)}><option value="">—</option>{(menus ?? []).filter((m) => m.is_active || m.id === f.menu_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="Fecha y hora">{(id) => <Input id={id} type="datetime-local" value={f.when} onChange={(e) => set("when", e.target.value)} />}</Field>
        <Field label="Personas">{(id) => <Input id={id} type="number" min="1" max="50" value={f.people} onChange={(e) => set("people", e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label="Qué van a probar" optional>{(id) => <Textarea id={id} value={f.dishes} onChange={(e) => set("dishes", e.target.value)} className="min-h-14" />}</Field></div>
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <Field label="Precio de la degustación" hint="0 si es gratis.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="0" step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option value="NIO">C$</option><option value="USD">US$</option></Select>}</Field>
        </div>
        <Field label="Estado">{(id) => <Select id={id} value={f.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(TASTING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
        {Number(f.price) > 0 && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.credit_on_hire} onChange={(e) => set("credit_on_hire", e.target.checked)} className="size-4 accent-ink" />
          Si contrata, se le descuenta del total (aplícalo como descuento en la cotización)</label>}
        {(f.status === "done" || tasting) && <div className="sm:col-span-2"><Field label="Resultado" optional hint="Qué le gustó, qué cambios pidió.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.result} onChange={(e) => set("result", e.target.value)} className="min-h-16" />}</Field></div>}
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-14" />}</Field></div>
        {f.status === "done" && Number(f.price) > 0 && <p className="text-xs text-muted sm:col-span-2">Una degustación realizada y cobrada cuenta como venta en Finanzas. Registra el pago en Finanzas → Registrar pago.</p>}
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
