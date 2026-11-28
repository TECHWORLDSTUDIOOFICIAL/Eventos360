import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, UtensilsCrossed, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatMoney, plural } from "@/lib/format";
import {
  COURSES, foodCost, useCateringSettings, useInvalidateCatering, useMenuItems, useMenus, usePriceTiers, useRecipes, type Menu,
} from "@/lib/catering";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

/** Menús por persona: platos (con opciones a elegir), precio, precios por volumen y % de costo de comida. */
export default function MenusPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data: menus, isLoading } = useMenus(ws.id);
  const { data: items } = useMenuItems(ws.id);
  const { data: recipes } = useRecipes(ws.id);
  const { data: settings } = useCateringSettings(ws.id);
  const [editing, setEditing] = useState<Menu | "new" | null>(null);
  const target = Number(settings?.food_cost_target ?? 33);
  return (
    <div className="animate-rise">
      <PageHeader title="Menús" description={`Tus menús por persona con su costo real. Meta de costo de comida: ${target}% del precio (se cambia en Configuración).`}
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo menú</Button>} />
      {isLoading ? <Spinner /> : !menus?.length ? (
        <Card><EmptyState icon={<UtensilsCrossed className="size-6" />} title="Aún no tienes menús"
          action={!readOnly && (recipes?.length ? <Button variant="accent" onClick={() => setEditing("new")}>Crear el primer menú</Button> : <span className="text-sm text-muted">Primero crea tus recetas en “Ingredientes y recetas”.</span>)}>
          Un menú junta tus platos (entrada, plato fuerte, acompañamientos, postre…) con un precio por persona. Puedes dar opciones, como “elige pollo o res”.
        </EmptyState></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {menus.map((m) => {
            const fc = foodCost(Number(m.cost_per_person), Number(m.price_per_person), target);
            const dishes = (items ?? []).filter((i) => i.menu_id === m.id);
            return (
              <button key={m.id} onClick={() => setEditing(m)} className={cx("rounded-2xl border border-line bg-card p-5 text-left shadow-sm transition hover:border-[var(--accent)]", !m.is_active && "opacity-60")}>
                <div className="flex items-start justify-between gap-2"><h3 className="font-display text-lg font-semibold">{m.name}</h3>{!m.is_active && <Badge>Inactivo</Badge>}</div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{dishes.map((d) => recipes?.find((r) => r.id === d.recipe_id)?.name).filter(Boolean).join(" · ") || "Sin platos"}</p>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <div><div className="font-display text-2xl font-semibold tabular-nums">{formatMoney(Number(m.price_per_person), m.currency_code, region.locale)}</div><div className="text-xs text-muted">por persona · mín. {m.min_guests}</div></div>
                  <div className="text-right text-xs"><div className="text-muted">Costo {formatMoney(Number(m.cost_per_person), m.currency_code, region.locale)}</div>
                    <div className={cx("font-semibold", fc.tone)}>{fc.pct === null ? "—" : `${fc.pct}% costo de comida`}</div></div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {editing && <MenuDialog menu={editing === "new" ? null : editing} target={target} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface Row { id?: string; recipe_id: string; portions: string; option_group: string }
interface Tier { id?: string; min_guests: string; price_per_person: string }

function MenuDialog({ menu, target, onClose }: { menu: Menu | null; target: number; onClose: () => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const invalidate = useInvalidateCatering();
  const { data: recipes } = useRecipes(ws.id);
  const { data: items } = useMenuItems(ws.id);
  const { data: tiers } = usePriceTiers(ws.id);
  const [f, setF] = useState({ name: menu?.name ?? "", description: menu?.description ?? "", currency_code: menu?.currency_code ?? region.currency_code,
    price: menu ? String(menu.price_per_person) : "", kids_price: menu?.kids_price != null ? String(menu.kids_price) : "", min_guests: menu ? String(menu.min_guests) : "50", is_active: menu?.is_active ?? true });
  const initRows = useMemo(() => (items ?? []).filter((i) => i.menu_id === menu?.id).map((i) => ({ id: i.id, recipe_id: i.recipe_id, portions: String(i.portions), option_group: i.option_group ?? "" })), [items, menu]);
  const initTiers = useMemo(() => (tiers ?? []).filter((t) => t.menu_id === menu?.id).map((t) => ({ id: t.id, min_guests: String(t.min_guests), price_per_person: String(t.price_per_person) })), [tiers, menu]);
  const [rowsS, setRows] = useState<Row[] | null>(null);
  const [tiersS, setTiers] = useState<Tier[] | null>(null);
  const rows = rowsS ?? initRows, tierRows = tiersS ?? initTiers;
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const rec = (id: string) => recipes?.find((r) => r.id === id);
  const money = (n: number) => formatMoney(n, f.currency_code, region.locale);
  const groups = [...new Set(rows.map((r) => r.option_group.trim()).filter(Boolean))];
  // Costo por persona: platos fijos + el más caro de cada grupo de opciones (así no te quedas corto).
  const cost = Object.values(rows.reduce<Record<string, number>>((acc, r, i) => {
    const key = r.option_group.trim() || `__${i}`; const c = Number(rec(r.recipe_id)?.cost_portion ?? 0) * Number(r.portions || 0);
    acc[key] = Math.max(acc[key] ?? 0, c); return acc;
  }, {})).reduce((t, x) => t + x, 0);
  const fc = foodCost(cost, Number(f.price), target);
  const suggested = cost > 0 ? Math.ceil(cost / (target / 100)) : null;
  const sorted = [...rows.map((r, i) => ({ r, i }))].sort((a, b) => Object.keys(COURSES).indexOf(rec(a.r.recipe_id)?.course ?? "otro") - Object.keys(COURSES).indexOf(rec(b.r.recipe_id)?.course ?? "otro"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del menú.");
    if (!(Number(f.price) >= 0) || f.price === "") return setError("Indica el precio por persona.");
    if (!rows.length) return setError("Agrega al menos un plato.");
    if (tierRows.some((t) => !(Number(t.min_guests) >= 2) || t.price_per_person === "")) return setError("Revisa los precios por volumen.");
    setBusy(true); setError(null);
    const row = { name: f.name.trim(), description: f.description.trim() || null, currency_code: f.currency_code, price_per_person: Number(f.price),
      kids_price: f.kids_price === "" ? null : Number(f.kids_price), min_guests: Math.max(1, Number(f.min_guests) || 1), is_active: f.is_active };
    const res = menu ? await supabase.from("menus").update(row).eq("id", menu.id).select("id").single() : await supabase.from("menus").insert({ ...row, workspace_id: ws.id }).select("id").single();
    if (res.error) { setBusy(false); return setError(res.error.message); }
    const mid = (res.data as { id: string }).id;
    const goneRows = initRows.filter((x) => !rows.some((r) => r.id === x.id)).map((x) => x.id!);
    const goneTiers = initTiers.filter((x) => !tierRows.some((t) => t.id === x.id)).map((x) => x.id!);
    const results = [
      goneRows.length ? await supabase.from("menu_items").delete().in("id", goneRows) : null,
      goneTiers.length ? await supabase.from("menu_price_tiers").delete().in("id", goneTiers) : null,
      ...(await Promise.all(rows.map((r, i) => {
        const v = { recipe_id: r.recipe_id, portions: Number(r.portions) || 1, option_group: r.option_group.trim() || null, sort: i };
        return r.id ? supabase.from("menu_items").update(v).eq("id", r.id) : supabase.from("menu_items").insert({ ...v, workspace_id: ws.id, menu_id: mid });
      }))),
      ...(await Promise.all(tierRows.map((t) => {
        const v = { min_guests: Number(t.min_guests), price_per_person: Number(t.price_per_person) };
        return t.id ? supabase.from("menu_price_tiers").update(v).eq("id", t.id) : supabase.from("menu_price_tiers").insert({ ...v, workspace_id: ws.id, menu_id: mid });
      }))),
    ];
    setBusy(false);
    await invalidate();
    const err = results.find((x) => x?.error)?.error;
    if (err) return setError(err.message.includes("duplicate") ? "Hay dos precios por volumen con la misma cantidad mínima." : err.message);
    onClose();
  }
  async function remove() {
    if (!menu || !confirm(`¿Eliminar el menú ${menu.name}?`)) return;
    const { error: err } = await supabase.from("menus").delete().eq("id", menu.id);
    if (err) return setError(err.message.includes("foreign key") ? "Este menú está en pedidos: márcalo como inactivo para no ofrecerlo más." : err.message);
    await invalidate(); onClose();
  }

  return (
    <Dialog open onClose={onClose} title={menu ? menu.name : "Nuevo menú"} wide
      footer={!readOnly && <>
        {menu && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="menu-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="menu-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1.6fr_0.6fr]">
          <Field label="Nombre del menú">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Menú Boda Clásico" autoFocus={!menu} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)} disabled={rows.length > 0}><option value="NIO">C$</option><option value="USD">US$</option></Select>}</Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">Platos del menú</div>
          <datalist id="option-groups">{[...groups, "Plato fuerte", "Postre", "Bebida"].map((g) => <option key={g} value={g} />)}</datalist>
          {rows.length > 0 && <div className="space-y-2">
            {sorted.map(({ r, i }) => {
              const rc = rec(r.recipe_id);
              return (
                <div key={r.id ?? `n${i}`} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1.5fr_0.6fr_1fr_auto]">
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{rc?.name}</span><span className="block text-xs text-muted">{COURSES[rc?.course ?? "otro"]} · {money(Number(rc?.cost_portion ?? 0))} por porción</span></span>
                  <label className="flex items-center gap-1 text-xs text-muted"><Input type="number" min="0.25" step="any" value={r.portions} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, portions: e.target.value } : x))} className="h-9 w-16 text-right" aria-label={`Porciones por invitado de ${rc?.name}`} />por inv.</label>
                  <Input list="option-groups" value={r.option_group} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, option_group: e.target.value } : x))} placeholder="Opción de… (si se elige)" className="h-9" aria-label={`Grupo de opciones de ${rc?.name}`} />
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted hover:text-danger" aria-label={`Quitar ${rc?.name}`}><X className="size-4" /></button>
                </div>
              );
            })}
          </div>}
          <div className="mt-2 flex gap-2">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Agregar plato" className="h-10">
              <option value="">Agregar plato…</option>
              {Object.entries(COURSES).map(([k, v]) => {
                const opts = (recipes ?? []).filter((r) => r.course === k && r.is_active && r.currency_code === f.currency_code && !rows.some((x) => x.recipe_id === r.id));
                return opts.length ? <optgroup key={k} label={v}>{opts.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup> : null;
              })}
            </Select>
            <Button type="button" variant="secondary" className="h-10" disabled={!pick} onClick={() => { setRows([...rows, { recipe_id: pick, portions: "1", option_group: "" }]); setPick(""); }}>Agregar</Button>
          </div>
          <p className="mt-1.5 text-xs text-muted">Si el invitado elige entre varios platos (por ejemplo pollo o res), escribe el mismo grupo en ambos, como “Plato fuerte”. Para el costo se toma el más caro del grupo.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Precio por persona (sin IVA)">{(id) => <Input id={id} type="number" min="0" step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} />}</Field>
          <Field label="Precio niño" optional hint="Si lo dejas vacío, el mismo.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="0" step="0.01" value={f.kids_price} onChange={(e) => set("kids_price", e.target.value)} />}</Field>
          <Field label="Mínimo de invitados">{(id) => <Input id={id} type="number" min="1" value={f.min_guests} onChange={(e) => set("min_guests", e.target.value)} />}</Field>
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line">
          <div className="bg-paper p-3"><div className="text-xs text-muted">Costo por persona</div><div className="font-display text-xl font-semibold tabular-nums">{money(cost)}</div></div>
          <div className="bg-paper p-3"><div className="text-xs text-muted">Ganas por persona</div><div className={cx("font-display text-xl font-semibold tabular-nums", Number(f.price) - cost < 0 ? "text-danger" : "text-ok")}>{money(Number(f.price || 0) - cost)}</div></div>
          <div className="bg-paper p-3"><div className="text-xs text-muted">Costo de comida</div><div className={cx("font-display text-xl font-semibold tabular-nums", fc.tone)}>{fc.pct === null ? "—" : `${fc.pct}%`}</div><div className="text-[11px] text-muted">meta {target}%</div></div>
        </div>
        {suggested !== null && fc.pct !== null && fc.pct > target && <p className="text-sm text-warn">Para llegar a tu meta de {target}% cobra al menos {money(suggested)} por persona.
          {!readOnly && <button type="button" onClick={() => set("price", String(suggested))} className="ml-2 font-semibold underline">Usar este precio</button>}</p>}
        <div>
          <div className="mb-1.5 text-sm font-medium">Precios por volumen <span className="font-normal text-faint">(opcional)</span></div>
          {tierRows.map((t, i) => (
            <div key={t.id ?? `t${i}`} className="mb-2 flex items-center gap-2 text-sm">
              <span className="text-muted">Desde</span><Input type="number" min="2" value={t.min_guests} onChange={(e) => setTiers(tierRows.map((x, j) => j === i ? { ...x, min_guests: e.target.value } : x))} className="h-9 w-24 text-right" aria-label="Desde cuántos invitados" />
              <span className="text-muted">invitados:</span><Input type="number" min="0" step="0.01" value={t.price_per_person} onChange={(e) => setTiers(tierRows.map((x, j) => j === i ? { ...x, price_per_person: e.target.value } : x))} className="h-9 w-28 text-right" aria-label="Precio por persona" />
              <span className="text-muted">c/u</span>
              <button type="button" onClick={() => setTiers(tierRows.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted hover:text-danger" aria-label="Quitar precio por volumen"><X className="size-4" /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setTiers([...tierRows, { min_guests: String((Number(tierRows.at(-1)?.min_guests) || Number(f.min_guests) || 50) * 2), price_per_person: "" }])}>Agregar precio por volumen</Button>
        </div>
        <Field label="Descripción" optional hint="Aparece en la cotización.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(e) => set("description", e.target.value)} className="min-h-14" />}</Field>
        {menu && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" />Activo (se puede cotizar)</label>}
        {error && <Alert tone="danger">{error}</Alert>}
        {!!groups.length && <p className="text-xs text-muted">Opciones: {groups.map((g) => `${g} (${plural(rows.filter((r) => r.option_group.trim() === g).length, "plato", "platos")})`).join(", ")}.</p>}
      </form>
    </Dialog>
  );
}
