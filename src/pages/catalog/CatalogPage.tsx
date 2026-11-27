import { useMemo, useState, type FormEvent } from "react";
import { ImagePlus, Plus, Search, Tag, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl, uploadImage } from "@/lib/events";
import { COST_KINDS, ITEM_KINDS, marginTone, priceForMargin, profit, useCatalog, useCatalogCosts, useInvalidateCatalog, type CatalogCost, type CatalogItem, type CostKind } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { SupplierSelect } from "@/components/QuickCreate";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

/** Catálogo: servicios y productos con su precio, su costo real y la ganancia que dejan. */
export default function CatalogPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useCatalog(ws.id);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const categories = useMemo(() => [...new Set((data ?? []).map((i) => i.category).filter((c): c is string => !!c))].sort(), [data]);
  const list = (data ?? []).filter((i) => (!cat || i.category === cat) && (!q || `${i.name} ${i.category ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const money = (n: number, c: string) => formatMoney(n, c, region.locale);
  const noCost = (data ?? []).filter((i) => i.is_active && Number(i.cost_total) === 0).length;

  return (
    <div className="animate-rise">
      <PageHeader title="Catálogo" description="Tus servicios y productos con su precio y su costo real (materiales, mano de obra, proveedores, transporte). Así sabes cuánto ganas de verdad."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo servicio</Button>} />
      {noCost > 0 && <div className="mb-4"><Alert tone="warn">{noCost === 1 ? "1 servicio no tiene" : `${noCost} servicios no tienen`} costos registrados: su "ganancia" aparece igual al precio, y eso no es real. Agrega lo que te cuesta prestarlo.</Alert></div>}
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className="h-10 pl-9" />
          </div>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 w-auto" aria-label="Categoría"><option value="">Todas las categorías</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select>
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Tag className="size-6" />} title="Tu catálogo está vacío" action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Agregar el primero</Button>}>
            Agrega cada servicio o producto que vendes, con su foto y precio. Lo importante: anota lo que te cuesta. Luego lo agregas a cotizaciones o paquetes con un clic.
          </EmptyState>
        ) : (
          <>
            <div className="hidden grid-cols-[1fr_110px_110px_110px_70px] gap-3 border-b border-line px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
              <span>Servicio / producto</span><span className="text-right">Precio</span><span className="text-right">Costo</span><span className="text-right">Ganancia</span><span className="text-right">Margen</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((i) => {
                const p = profit(i.price, i.cost_total);
                const img = publicMediaUrl(i.image_path);
                return (
                  <li key={i.id}>
                    <button disabled={readOnly} onClick={() => setEditing(i)} className={cx("grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-paper sm:px-5 md:grid-cols-[1fr_110px_110px_110px_70px]", !i.is_active && "opacity-60")}>
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">{img ? <img src={img} alt="" className="size-full object-cover" /> : <Tag className="size-5" />}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{i.name}{!i.is_active && <Badge className="ml-2">Inactivo</Badge>}</span>
                          <span className="block truncate text-xs text-muted">{[ITEM_KINDS[i.kind], i.category, `por ${i.unit}`].filter(Boolean).join(" · ")}</span>
                          <span className="block text-xs md:hidden">{money(i.price, i.currency_code)} · costo {money(i.cost_total, i.currency_code)} · <b className={marginTone(p.margin)}>gana {money(p.gain, i.currency_code)}</b></span>
                        </span>
                      </span>
                      <span className="hidden text-right tabular-nums md:block">{money(i.price, i.currency_code)}</span>
                      <span className={cx("hidden text-right tabular-nums md:block", Number(i.cost_total) === 0 && "text-warn")}>{Number(i.cost_total) === 0 ? "Sin costos" : money(i.cost_total, i.currency_code)}</span>
                      <span className={cx("hidden text-right font-semibold tabular-nums md:block", marginTone(p.margin))}>{money(p.gain, i.currency_code)}</span>
                      <span className={cx("text-right text-sm font-semibold tabular-nums", marginTone(p.margin))}>{Math.round(p.margin)}%</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">Los precios del catálogo son <b>sin IVA</b>; el IVA se agrega en la cotización y no es ganancia. La ganancia aquí es por servicio: todavía no descuenta los gastos fijos del negocio (alquiler, salarios…), que ves en Finanzas.</p>
          </>
        )}
      </Card>
      {editing && <ItemDialog item={editing === "new" ? null : editing} categories={categories} onClose={() => setEditing(null)} />}
    </div>
  );
}

type CostDraft = { id?: string; kind: CostKind; description: string; amount: string; supplier_id: string };

/** Desglose de costos editable (servicio o paquete). */
export function CostEditor({ rows, setRows, currency }: { rows: CostDraft[]; setRows: (r: CostDraft[]) => void; currency: string }) {
  const { region } = useWorkspace();
  const upd = (i: number, patch: Partial<CostDraft>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-line p-2 sm:grid-cols-[150px_1fr_170px_110px_auto]">
          <Select value={r.kind} onChange={(e) => upd(i, { kind: e.target.value as CostKind })} aria-label="Tipo de costo" className="h-10">{(Object.keys(COST_KINDS) as CostKind[]).map((k) => <option key={k} value={k}>{COST_KINDS[k].label}</option>)}</Select>
          <Input value={r.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder={COST_KINDS[r.kind].hint} aria-label="Detalle del costo" className="h-10" />
          <SupplierSelect value={r.supplier_id} onChange={(v) => upd(i, { supplier_id: v, kind: v && r.kind === "material" ? "supplier" : r.kind })} className="h-10" aria-label="Proveedor del costo" />
          <Input type="number" min={0} step="0.01" inputMode="decimal" value={r.amount} onChange={(e) => upd(i, { amount: e.target.value })} placeholder="Monto" aria-label="Monto del costo" className="h-10 text-right" />
          <button type="button" onClick={() => setRows(rows.filter((_, k) => k !== i))} className="rounded-lg p-2 text-muted hover:text-danger" aria-label="Quitar costo"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setRows([...rows, { kind: rows.length ? "labor" : "material", description: "", amount: "", supplier_id: "" }])}>Agregar costo</Button>
        <span className="text-sm">Costo total: <b className="tabular-nums">{formatMoney(total, currency, region.locale)}</b></span>
      </div>
    </div>
  );
}

/** Guarda el desglose: actualiza, crea y quita filas. */
export async function saveCosts(wsId: string, owner: { item_id?: string; package_id?: string }, rows: CostDraft[], previous: CatalogCost[]) {
  const keep = rows.filter((r) => r.description.trim() || Number(r.amount) > 0);
  const removed = previous.filter((p) => !keep.some((r) => r.id === p.id));
  for (const p of removed) await supabase.from("catalog_costs").delete().eq("id", p.id);
  for (const [n, r] of keep.entries()) {
    const row = { kind: r.kind, description: r.description.trim() || COST_KINDS[r.kind].label, amount: Number(r.amount) || 0, supplier_id: r.supplier_id || null, sort: n };
    const res = r.id ? await supabase.from("catalog_costs").update(row).eq("id", r.id) : await supabase.from("catalog_costs").insert({ ...row, ...owner, workspace_id: wsId });
    if (res.error) throw new Error(res.error.message);
  }
}
export const toDrafts = (costs: CatalogCost[]): CostDraft[] => costs.map((c) => ({ id: c.id, kind: c.kind, description: c.description, amount: String(c.amount), supplier_id: c.supplier_id ?? "" }));

/** Ganancia en vivo y precio sugerido para un margen. */
export function ProfitBox({ price, cost, currency, onUsePrice }: { price: number; cost: number; currency: string; onUsePrice?: (p: number) => void }) {
  const { region } = useWorkspace();
  const [target, setTarget] = useState("35");
  const p = profit(price, cost);
  const m = (n: number) => formatMoney(n, currency, region.locale);
  const suggested = priceForMargin(cost, Number(target) || 0);
  return (
    <div className="rounded-2xl bg-paper p-4">
      <div className="text-sm font-semibold">¿Cuánto ganas?</div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Precio (sin IVA)</dt><dd className="font-semibold tabular-nums">{m(price)}</dd></div>
        <div><dt className="text-xs text-muted">Costo</dt><dd className="font-semibold tabular-nums">{m(cost)}</dd></div>
        <div><dt className="text-xs text-muted">Ganancia</dt><dd className={cx("font-semibold tabular-nums", marginTone(p.margin))}>{m(p.gain)}</dd></div>
        <div><dt className="text-xs text-muted">Margen</dt><dd className={cx("font-semibold tabular-nums", marginTone(p.margin))}>{Math.round(p.margin)}%</dd></div>
      </dl>
      {cost === 0 && <p className="mt-2 text-xs text-warn">Sin costos registrados la ganancia no es real.</p>}
      {p.gain < 0 && <p className="mt-2 text-xs font-semibold text-danger">Estás vendiendo por debajo del costo.</p>}
      {onUsePrice && cost > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
          Para ganar el <Input type="number" min={0} max={95} value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-16 text-right" aria-label="Margen deseado" />% del precio, cobra
          <b className="text-ink">{m(suggested)}</b>
          <Button type="button" size="sm" variant="secondary" onClick={() => onUsePrice(suggested)}>Usar este precio</Button>
        </div>
      )}
    </div>
  );
}

function ItemDialog({ item, categories, onClose }: { item: CatalogItem | null; categories: string[]; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateCatalog();
  const { data: allCosts } = useCatalogCosts(ws.id);
  const previous = (allCosts ?? []).filter((c) => c.item_id === item?.id);
  const [f, setF] = useState({
    kind: item?.kind ?? "service", name: item?.name ?? "", category: item?.category ?? "", unit: item?.unit ?? "unidad", description: item?.description ?? "",
    price: item ? String(item.price) : "", currency_code: item?.currency_code ?? region.currency_code, notes: item?.notes ?? "", is_active: item?.is_active ?? true,
  });
  const [rows, setRows] = useState<CostDraft[] | null>(null);
  const costRows = rows ?? (item ? toDrafts(previous) : [{ kind: "material" as CostKind, description: "", amount: "", supplier_id: "" }]);
  const [file, setFile] = useState<File | null>(null);
  const [removeImg, setRemoveImg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const preview = file ? URL.createObjectURL(file) : removeImg ? null : publicMediaUrl(item?.image_path);
  const costTotal = costRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Escribe el nombre.");
    if (f.price === "" || !(Number(f.price) >= 0)) return setError("Indica el precio de venta.");
    setBusy(true); setError(null);
    try {
      let image_path = removeImg ? null : item?.image_path ?? null;
      if (file) image_path = await uploadImage("event-media", `${ws.id}/catalogo/${crypto.randomUUID()}.webp`, file, 1400);
      const row = { kind: f.kind, name: f.name.trim(), category: f.category.trim() || null, unit: f.unit.trim() || "unidad", description: f.description.trim() || null,
        price: Number(f.price), currency_code: f.currency_code, notes: f.notes.trim() || null, is_active: f.is_active, image_path };
      const res = item ? await supabase.from("catalog_items").update(row).eq("id", item.id).select("id").single()
        : await supabase.from("catalog_items").insert({ ...row, workspace_id: ws.id }).select("id").single();
      if (res.error) throw new Error(res.error.message);
      await saveCosts(ws.id, { item_id: (res.data as { id: string }).id }, costRows, previous);
      if (item?.image_path && image_path !== item.image_path) await supabase.storage.from("event-media").remove([item.image_path]);
      await invalidate();
      onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!item || !confirm(`¿Eliminar "${item.name}"? Se quitará también de los paquetes donde esté.`)) return;
    const { error: err } = await supabase.from("catalog_items").delete().eq("id", item.id);
    if (err) return setError(err.message);
    if (item.image_path) await supabase.storage.from("event-media").remove([item.image_path]);
    await invalidate();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={item ? `Editar: ${item.name}` : "Nuevo servicio o producto"} wide
      footer={<>
        {item && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="item-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="item-form" onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
          <div>
            <label className="relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line-strong bg-paper text-muted hover:border-[var(--accent)]">
              {preview ? <img src={preview} alt="" className="absolute inset-0 size-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-xs"><ImagePlus className="size-6" />Foto</span>}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Foto" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemoveImg(false); e.target.value = ""; }} />
            </label>
            {preview && <button type="button" className="mt-1 text-xs text-muted hover:text-danger" onClick={() => { setFile(null); setRemoveImg(true); }}>Quitar foto</button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Nombre">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Arco floral 2.5 m" autoFocus />}</Field></div>
            <Field label="Tipo">{(id) => <Select id={id} value={f.kind} onChange={(e) => set("kind", e.target.value)}>{Object.entries(ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
            <Field label="Categoría" optional>{(id) => <><Input id={id} list="item-cats" value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Decoración, Sonido, Comida…" /><datalist id="item-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></>}</Field>
            <Field label="Se cobra por" hint="Ej. unidad, persona, hora, evento.">{(id, d) => <Input id={id} aria-describedby={d} value={f.unit} onChange={(e) => set("unit", e.target.value)} />}</Field>
            <div className="grid grid-cols-[1fr_150px] gap-2">
              <Field label="Precio de venta (sin IVA)">{(id) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} />}</Field>
              <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>}</Field>
            </div>
            <div className="sm:col-span-2"><Field label="Descripción" optional hint="Aparece en la cotización: qué incluye, medidas, colores…">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field></div>
          </div>
        </div>
        <section>
          <h3 className="text-sm font-semibold">¿Cuánto te cuesta prestarlo? <span className="font-normal text-muted">(por {f.unit || "unidad"})</span></h3>
          <p className="mb-2 text-xs text-muted">Anota todo lo que pagas: materiales, personal, proveedores, transporte. Si el proveedor no existe, créalo desde la lista.</p>
          <CostEditor rows={costRows} setRows={setRows} currency={f.currency_code} />
        </section>
        <ProfitBox price={Number(f.price) || 0} cost={costTotal} currency={f.currency_code} onUsePrice={(p) => set("price", String(p))} />
        <Field label="Notas internas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" />Activo (se puede cotizar)</label>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
