import { useMemo, useState, type FormEvent } from "react";
import { ChefHat, Plus, Search, Trash2, Wheat, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatMoney, plural } from "@/lib/format";
import {
  COURSES, DIM_LABEL, UNITS, purchaseLabel, unitsOf, useIngredients, useInvalidateCatering, useMenuItems, useRecipeItems, useRecipes,
  type Dim, type Ingredient, type Recipe,
} from "@/lib/catering";
import { useSuppliers } from "@/pages/personal/SuppliersPage";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { SupplierSelect } from "@/components/QuickCreate";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

/** Ingredientes (con unidad de compra, precio y merma) y recetas con su costo por porción. */
export default function IngredientsPage() {
  const { ws, readOnly } = useWorkspace();
  const [tab, setTab] = useState<"recetas" | "ingredientes">("recetas");
  const [editIng, setEditIng] = useState<Ingredient | "new" | null>(null);
  const [editRec, setEditRec] = useState<Recipe | "new" | null>(null);
  const { data: ings } = useIngredients(ws.id);
  return (
    <div className="animate-rise">
      <PageHeader title="Ingredientes y recetas" description="Registra lo que compras con su precio y aprovechamiento; arma cada plato y el sistema calcula cuánto te cuesta la porción."
        actions={!readOnly && (tab === "recetas"
          ? <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditRec("new")}>Nueva receta</Button>
          : <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditIng("new")}>Nuevo ingrediente</Button>)} />
      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        {([["recetas", "Recetas (platos)"], ["ingredientes", `Ingredientes${ings?.length ? ` (${ings.length})` : ""}`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
      {tab === "recetas" ? <RecipeList onEdit={setEditRec} onNewIngredient={() => { setTab("ingredientes"); setEditIng("new"); }} /> : <IngredientList onEdit={setEditIng} />}
      {editIng && <IngredientDialog ingredient={editIng === "new" ? null : editIng} onClose={() => setEditIng(null)} />}
      {editRec && <RecipeDialog recipe={editRec === "new" ? null : editRec} onClose={() => setEditRec(null)} />}
    </div>
  );
}

function IngredientList({ onEdit }: { onEdit: (i: Ingredient | "new") => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useIngredients(ws.id);
  const { data: suppliers } = useSuppliers();
  const [q, setQ] = useState("");
  const list = (data ?? []).filter((i) => !q || `${i.name} ${i.category ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Card><EmptyState icon={<Wheat className="size-6" />} title="Aún no tienes ingredientes" action={!readOnly && <Button variant="accent" onClick={() => onEdit("new")}>Agregar ingrediente</Button>}>
    Registra lo que compras tal como lo compras: pollo por libra, arroz por saco de 50 lb, huevos por cajilla. Si al limpiar se pierde parte (huesos, cáscaras), indica cuánto aprovechas.
  </EmptyState></Card>;
  return (
    <Card>
      <div className="border-b border-line p-3"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ingrediente" className="h-10 pl-9" /></div></div>
      <ul className="divide-y divide-line">
        {list.map((i) => (
          <li key={i.id}><button onClick={() => onEdit(i)} className={cx("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-paper sm:px-5", !i.is_active && "opacity-60")}>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.name}</span>
              <span className="block truncate text-xs text-muted">{[i.category, Number(i.yield_pct) < 100 && `aprovechas ${Number(i.yield_pct)}%`, suppliers?.find((s) => s.id === i.supplier_id)?.name].filter(Boolean).join(" · ")}</span></span>
            <span className="text-right"><span className="block font-semibold tabular-nums">{formatMoney(Number(i.price), i.currency_code, region.locale)} <span className="font-normal text-muted">/ {purchaseLabel(i)}</span></span></span>
          </button></li>
        ))}
      </ul>
    </Card>
  );
}

function IngredientDialog({ ingredient, onClose, onCreated }: { ingredient: Ingredient | null; onClose: () => void; onCreated?: (ing: Ingredient) => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const invalidate = useInvalidateCatering();
  const isPack = ingredient?.purchase_unit === "paquete";
  const [f, setF] = useState({
    name: ingredient?.name ?? "", category: ingredient?.category ?? "", kind: isPack ? "paquete" : "std", unit: isPack ? "lb" : ingredient?.purchase_unit ?? "lb",
    pack_name: ingredient?.pack_name ?? "", pack_size: ingredient?.pack_size ? String(ingredient.pack_size) : "", pack_unit: ingredient?.pack_unit ?? "lb",
    price: ingredient ? String(ingredient.price) : "", currency_code: ingredient?.currency_code ?? region.currency_code, yield_pct: ingredient ? String(ingredient.yield_pct) : "100",
    supplier_id: ingredient?.supplier_id ?? "", is_active: ingredient?.is_active ?? true, notes: ingredient?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const base = f.kind === "paquete" ? Number(f.pack_size) * (UNITS[f.pack_unit]?.factor ?? 0) : UNITS[f.unit]?.factor ?? 0;
  const dim = (f.kind === "paquete" ? UNITS[f.pack_unit] : UNITS[f.unit])?.dim ?? "mass";
  const refUnit = dim === "mass" ? "lb" : dim === "volume" ? "l" : "unidad";
  const realCost = base > 0 && Number(f.price) > 0 ? (Number(f.price) / base / (Number(f.yield_pct || 100) / 100)) * UNITS[refUnit]!.factor : null;

  async function submit(e: FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del ingrediente.");
    if (f.kind === "paquete" && (f.pack_name.trim().length < 2 || !(Number(f.pack_size) > 0))) return setError("Indica cómo se llama el paquete y cuánto trae (por ejemplo, saco de 50 lb).");
    if (f.price === "" || !(Number(f.price) >= 0)) return setError("Indica el precio de compra.");
    if (!(Number(f.yield_pct) > 0 && Number(f.yield_pct) <= 100)) return setError("El aprovechamiento debe estar entre 1 y 100 %.");
    setBusy(true);
    const row = { name: f.name.trim(), category: f.category.trim() || null, purchase_unit: f.kind === "paquete" ? "paquete" : f.unit,
      pack_name: f.kind === "paquete" ? f.pack_name.trim() : null, pack_size: f.kind === "paquete" ? Number(f.pack_size) : null, pack_unit: f.kind === "paquete" ? f.pack_unit : null,
      price: Number(f.price), currency_code: f.currency_code, yield_pct: Number(f.yield_pct), supplier_id: f.supplier_id || null, is_active: f.is_active, notes: f.notes.trim() || null };
    const res = ingredient ? await supabase.from("ingredients").update(row).eq("id", ingredient.id).select("*").single()
      : await supabase.from("ingredients").insert({ ...row, workspace_id: ws.id }).select("*").single();
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate();
    if (!ingredient && onCreated) onCreated(res.data as Ingredient); else onClose();
  }
  async function remove() {
    if (!ingredient || !confirm(`¿Eliminar ${ingredient.name}?`)) return;
    const { error: err } = await supabase.from("ingredients").delete().eq("id", ingredient.id);
    if (err) return setError(err.message.includes("foreign key") ? "Este ingrediente se usa en recetas: quítalo de ellas o márcalo como inactivo." : err.message);
    await invalidate(); onClose();
  }
  return (
    <Dialog open onClose={onClose} title={ingredient ? ingredient.name : "Nuevo ingrediente"}
      footer={!readOnly && <>
        {ingredient && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="ingredient-form" variant="accent" loading={busy}>{onCreated && !ingredient ? "Crear y usar" : "Guardar"}</Button>
      </>}>
      <form id="ingredient-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Pechuga de pollo" autoFocus />}</Field>
          <Field label="Categoría" optional>{(id) => <Input id={id} value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Carnes, verduras, abarrotes…" />}</Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">¿Cómo lo compras?</div>
          <div className="grid grid-cols-2 gap-2">
            {([["std", "Por unidad de medida", "lb, kg, litro, galón, cajilla…"], ["paquete", "Por paquete", "saco, caja, bolsa, fardo…"]] as const).map(([k, l, h]) => (
              <button key={k} type="button" onClick={() => set("kind", k)} className={cx("rounded-xl border px-3 py-2 text-left", f.kind === k ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-line")}>
                <span className={cx("block text-sm font-semibold", f.kind === k && "text-[var(--accent)]")}>{l}</span><span className="block text-xs text-muted">{h}</span></button>
            ))}
          </div>
        </div>
        {f.kind === "std" ? (
          <Field label="Unidad de compra">{(id) => <Select id={id} value={f.unit} onChange={(e) => set("unit", e.target.value)}>
            {(["mass", "volume", "count"] as Dim[]).map((d) => <optgroup key={d} label={DIM_LABEL[d]}>{unitsOf(d).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}</optgroup>)}
          </Select>}</Field>
        ) : (
          <div className="grid grid-cols-[1.2fr_0.8fr_1fr] gap-2">
            <Field label="Paquete">{(id) => <Input id={id} value={f.pack_name} onChange={(e) => set("pack_name", e.target.value)} placeholder="saco" />}</Field>
            <Field label="Trae">{(id) => <Input id={id} type="number" min="0.001" step="any" value={f.pack_size} onChange={(e) => set("pack_size", e.target.value)} placeholder="50" />}</Field>
            <Field label="Unidad">{(id) => <Select id={id} value={f.pack_unit} onChange={(e) => set("pack_unit", e.target.value)}>
              {(["mass", "volume", "count"] as Dim[]).map((d) => <optgroup key={d} label={DIM_LABEL[d]}>{unitsOf(d).map(([k, u]) => <option key={k} value={k}>{u.short}</option>)}</optgroup>)}
            </Select>}</Field>
          </div>
        )}
        <div className="grid grid-cols-[1fr_140px_1fr] gap-2">
          <Field label={`Precio por ${f.kind === "paquete" ? (f.pack_name || "paquete") : UNITS[f.unit]?.label.toLowerCase() ?? ""}`}>{(id) => <Input id={id} type="number" min="0" step="0.01" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option value="NIO">C$</option><option value="USD">US$</option></Select>}</Field>
          <Field label="Aprovechas (%)" hint="Lo que queda tras limpiar.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="1" max="100" step="any" value={f.yield_pct} onChange={(e) => set("yield_pct", e.target.value)} />}</Field>
        </div>
        {realCost !== null && <p className="rounded-xl bg-paper px-3 py-2 text-sm">Costo real de lo que usas: <span className="font-semibold">{formatMoney(realCost, f.currency_code, region.locale)} por {UNITS[refUnit]!.short}</span>{Number(f.yield_pct) < 100 && <span className="text-muted"> (incluye la merma)</span>}</p>}
        <Field label="Proveedor" optional>{(id) => <SupplierSelect id={id} value={f.supplier_id} onChange={(v) => set("supplier_id", v)} />}</Field>
        <Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-14" />}</Field>
        {ingredient && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" />Activo</label>}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

function RecipeList({ onEdit, onNewIngredient }: { onEdit: (r: Recipe | "new") => void; onNewIngredient: () => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useRecipes(ws.id);
  const { data: ings } = useIngredients(ws.id);
  const { data: mItems } = useMenuItems(ws.id);
  const [course, setCourse] = useState("");
  const list = (data ?? []).filter((r) => !course || r.course === course);
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Card><EmptyState icon={<ChefHat className="size-6" />} title="Aún no tienes recetas"
    action={!readOnly && (ings?.length ? <Button variant="accent" onClick={() => onEdit("new")}>Crear la primera receta</Button> : <Button variant="accent" onClick={onNewIngredient}>Primero, agrega ingredientes</Button>)}>
    Cada receta dice cuántas porciones rinde y qué lleva. El sistema calcula su costo por porción y lo actualiza cuando cambian los precios.
  </EmptyState></Card>;
  return (
    <Card>
      <div className="border-b border-line p-3"><Select value={course} onChange={(e) => setCourse(e.target.value)} className="h-10 w-auto" aria-label="Tiempo"><option value="">Todos los tiempos</option>{Object.entries(COURSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
      <ul className="divide-y divide-line">
        {list.map((r) => {
          const usedIn = (mItems ?? []).filter((m) => m.recipe_id === r.id).length;
          return (
            <li key={r.id}><button onClick={() => onEdit(r)} className={cx("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-paper sm:px-5", !r.is_active && "opacity-60")}>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-xs text-muted">{COURSES[r.course]} · rinde {Number(r.portions)} porciones{usedIn ? ` · en ${plural(usedIn, "menú", "menús")}` : ""}</span></span>
              {Number(r.cost_total) === 0 && <Badge tone="warn">Sin ingredientes</Badge>}
              <span className="text-right"><span className="block font-semibold tabular-nums">{formatMoney(Number(r.cost_portion), r.currency_code, region.locale)}</span><span className="block text-xs text-muted">por porción</span></span>
            </button></li>
          );
        })}
      </ul>
    </Card>
  );
}

interface Line { id?: string; ingredient_id: string; quantity: string; unit: string; note: string }

function RecipeDialog({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const invalidate = useInvalidateCatering();
  const { data: ings } = useIngredients(ws.id);
  const { data: items } = useRecipeItems(ws.id);
  const [f, setF] = useState({ name: recipe?.name ?? "", course: recipe?.course ?? "fuerte", portions: recipe ? String(recipe.portions) : "10",
    currency_code: recipe?.currency_code ?? region.currency_code, description: recipe?.description ?? "", instructions: recipe?.instructions ?? "", is_active: recipe?.is_active ?? true });
  const initial = useMemo(() => (items ?? []).filter((x) => x.recipe_id === recipe?.id).map((x) => ({ id: x.id, ingredient_id: x.ingredient_id, quantity: String(x.quantity), unit: x.unit, note: x.note ?? "" })), [items, recipe]);
  const [lines, setLines] = useState<Line[] | null>(null);
  const rows = lines ?? initial;
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const setRow = (i: number, patch: Partial<Line>) => setLines(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ing = (id: string) => ings?.find((x) => x.id === id);
  const lineCost = (l: Line) => { const i = ing(l.ingredient_id); const u = UNITS[l.unit]; return i && u && u.dim === i.dim ? Number(l.quantity || 0) * u.factor * Number(i.cost_base) : 0; };
  const total = rows.reduce((t, l) => t + lineCost(l), 0);
  const perPortion = Number(f.portions) > 0 ? total / Number(f.portions) : 0;
  const money = (n: number) => formatMoney(n, f.currency_code, region.locale);
  const available = (ings ?? []).filter((i) => i.currency_code === f.currency_code && (i.is_active || rows.some((r) => r.ingredient_id === i.id)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del plato.");
    if (!(Number(f.portions) > 0)) return setError("Indica cuántas porciones rinde.");
    const clean = rows.filter((l) => l.ingredient_id);
    if (clean.some((l) => !(Number(l.quantity) > 0))) return setError("Revisa las cantidades de los ingredientes.");
    setBusy(true); setError(null);
    const row = { name: f.name.trim(), course: f.course, portions: Number(f.portions), currency_code: f.currency_code, description: f.description.trim() || null, instructions: f.instructions.trim() || null, is_active: f.is_active };
    const res = recipe ? await supabase.from("recipes").update(row).eq("id", recipe.id).select("id").single() : await supabase.from("recipes").insert({ ...row, workspace_id: ws.id }).select("id").single();
    if (res.error) { setBusy(false); return setError(res.error.message); }
    const rid = (res.data as { id: string }).id;
    const removed = initial.filter((x) => !clean.some((l) => l.id === x.id)).map((x) => x.id!);
    const errs = [
      removed.length ? (await supabase.from("recipe_items").delete().in("id", removed)).error : null,
      ...(await Promise.all(clean.map((l, i) => {
        const r = { ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit: l.unit, note: l.note.trim() || null, sort: i };
        return l.id ? supabase.from("recipe_items").update(r).eq("id", l.id) : supabase.from("recipe_items").insert({ ...r, workspace_id: ws.id, recipe_id: rid });
      }))).map((x) => x.error),
    ].filter(Boolean);
    setBusy(false);
    await invalidate();
    if (errs.length) return setError(errs[0]!.message);
    onClose();
  }
  async function remove() {
    if (!recipe || !confirm(`¿Eliminar la receta ${recipe.name}?`)) return;
    const { error: err } = await supabase.from("recipes").delete().eq("id", recipe.id);
    if (err) return setError(err.message.includes("foreign key") ? "Esta receta está en un menú: quítala del menú o márcala como inactiva." : err.message);
    await invalidate(); onClose();
  }

  return (
    <Dialog open onClose={onClose} title={recipe ? recipe.name : "Nueva receta"} wide
      footer={!readOnly && <>
        {recipe && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="recipe-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="recipe-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr_0.8fr_0.7fr]">
          <Field label="Nombre del plato">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Pollo en salsa jalapeña" autoFocus={!recipe} />}</Field>
          <Field label="Tiempo">{(id) => <Select id={id} value={f.course} onChange={(e) => set("course", e.target.value)}>{Object.entries(COURSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Rinde (porciones)">{(id) => <Input id={id} type="number" min="0.5" step="any" value={f.portions} onChange={(e) => set("portions", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)} disabled={rows.length > 0}><option value="NIO">C$</option><option value="USD">US$</option></Select>}</Field>
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between"><span className="text-sm font-medium">Ingredientes de toda la receta</span><span className="text-xs text-muted">para {Number(f.portions) || "…"} porciones</span></div>
          <div className="space-y-2">
            {rows.map((l, i) => {
              const it = ing(l.ingredient_id);
              return (
                <div key={l.id ?? `n${i}`} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1.6fr_0.7fr_0.8fr_1fr_auto]">
                  <Select value={l.ingredient_id} aria-label="Ingrediente" onChange={(e) => {
                    if (e.target.value === "__nuevo__") return setCreatingFor(i);
                    const ni = ing(e.target.value); setRow(i, { ingredient_id: e.target.value, unit: ni ? (UNITS[ni.purchase_unit]?.dim === ni.dim ? ni.purchase_unit : ni.pack_unit ?? "unidad") : l.unit });
                  }} className="col-span-2 sm:col-span-1">
                    <option value="">Elegir ingrediente…</option>
                    {available.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    <option value="__nuevo__">+ Nuevo ingrediente…</option>
                  </Select>
                  <Input type="number" min="0.001" step="any" value={l.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} aria-label="Cantidad" placeholder="Cant." className="text-right" />
                  <Select value={l.unit} onChange={(e) => setRow(i, { unit: e.target.value })} aria-label="Unidad">
                    {(it ? unitsOf(it.dim) : Object.entries(UNITS)).map(([k, u]) => <option key={k} value={k}>{u.short}</option>)}
                  </Select>
                  <Input value={l.note} onChange={(e) => setRow(i, { note: e.target.value })} placeholder="picado, en cubos…" aria-label="Nota" className="hidden sm:block" />
                  <span className="flex items-center gap-1 justify-self-end">
                    <span className="w-24 text-right text-sm tabular-nums text-muted">{money(lineCost(l))}</span>
                    <button type="button" onClick={() => setLines(rows.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted hover:text-danger" aria-label="Quitar ingrediente"><X className="size-4" /></button>
                  </span>
                </div>
              );
            })}
          </div>
          <Button type="button" size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setLines([...rows, { ingredient_id: "", quantity: "", unit: "lb", note: "" }])}>Agregar ingrediente</Button>
          {!available.length && <p className="mt-1 text-xs text-muted">No tienes ingredientes en {f.currency_code === "USD" ? "dólares" : "córdobas"}; créalos con “+ Nuevo ingrediente…”.</p>}
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
          <div className="bg-paper p-3"><div className="text-xs text-muted">Costo de la receta</div><div className="font-display text-xl font-semibold tabular-nums">{money(total)}</div></div>
          <div className="bg-paper p-3"><div className="text-xs text-muted">Costo por porción</div><div className="font-display text-xl font-semibold tabular-nums">{money(perPortion)}</div></div>
        </div>
        <Field label="Descripción para el menú" optional hint="La ve el cliente en la cotización.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(e) => set("description", e.target.value)} className="min-h-14" placeholder="Pechuga a la plancha bañada en salsa jalapeña cremosa." />}</Field>
        <Field label="Preparación" optional hint="Solo la ve la cocina (sale en la hoja de producción).">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} className="min-h-20" />}</Field>
        {recipe && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" />Activa</label>}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
      {creatingFor !== null && <IngredientDialog ingredient={null} onClose={() => setCreatingFor(null)} onCreated={(ni) => {
        const idx = creatingFor; setCreatingFor(null);
        setRow(idx, { ingredient_id: ni.id, unit: ni.purchase_unit !== "paquete" ? ni.purchase_unit : ni.pack_unit ?? "lb" });
      }} />}
    </Dialog>
  );
}
