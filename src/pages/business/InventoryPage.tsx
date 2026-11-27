import { useMemo, useRef, useState, type FormEvent } from "react";
import { Boxes, Download, FileSpreadsheet, ImagePlus, Pencil, Plus, Search, Trash2, Upload, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl, uploadImage } from "@/lib/events";
import { UNITS, useInvalidateRental, useAvailability, useMaintenance, useResources, type Resource } from "@/lib/rental";
import { formatMoney } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";
import { MaintenanceDialog } from "./rentalShared";

/** Inventario: cada artículo con su existencia total, lo que está en mantenimiento y lo disponible hoy. */
export default function InventoryPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useResources(ws.id, { includeInactive: true });
  const { data: maint } = useMaintenance(ws.id);
  const [range] = useState(() => {
    const from = new Date();
    return { from: from.toISOString(), to: new Date(from.getTime() + 60_000).toISOString() };
  });
  const { data: avail } = useAvailability(ws.id, range.from, range.to);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [damaging, setDamaging] = useState<Resource | null>(null);

  const categories = useMemo(() => [...new Set((data ?? []).map((r) => r.category).filter((c): c is string => !!c))].sort(), [data]);
  const list = useMemo(() => (data ?? []).filter((r) => (showInactive || r.is_active) && (!cat || r.category === cat)
    && (!q || `${r.name} ${r.sku ?? ""} ${r.category ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [data, q, cat, showInactive]);
  const oos = (id: string) => (maint ?? []).filter((m) => m.resource_id === id && m.status === "open").reduce((s, m) => s + m.quantity, 0);
  const now = (id: string) => avail?.find((a) => a.resource_id === id);
  const totalUnits = list.reduce((s, r) => s + r.total_qty, 0);

  async function exportExcel() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const header = ["Nombre", "Categoría", "Código", "Unidad", "Cantidad total", "En mantenimiento", "Fuera ahora (alquilado)", "Disponible hoy", "Precio de alquiler", "Costo de reposición", "Moneda", "Activo"]
      .map((value) => ({ value, fontWeight: "bold" as const }));
    const rows = list.map((r) => [r.name, r.category ?? "", r.sku ?? "", r.unit, r.total_qty, oos(r.id), now(r.id)?.committed ?? 0, now(r.id)?.available ?? "",
      Number(r.rent_price), r.replacement_cost == null ? "" : Number(r.replacement_cost), r.currency_code, r.is_active ? "Sí" : "No"].map((value) => ({ value: value as string | number })));
    await writeXlsxFile([header, ...rows], { columns: [{ width: 30 }, { width: 16 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 8 }, { width: 8 }] })
      .toFile("Inventario.xlsx");
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Inventario" description="Tus artículos de alquiler: existencias, precios, costo de reposición y lo que está disponible hoy."
        actions={<>
          {!!data?.length && <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportExcel()}>Excel</Button>}
          {!readOnly && <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>Importar</Button>}
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo artículo</Button>}
        </>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, código o categoría" className="h-10 pl-9" />
          </div>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 w-auto" aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <label className="flex items-center gap-2 px-1 text-sm text-muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-ink" />Ver inactivos</label>
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Boxes className="size-6" />} title="Tu inventario está vacío"
            action={!readOnly && <div className="flex flex-wrap justify-center gap-2"><Button variant="accent" onClick={() => setEditing("new")}>Agregar artículo</Button><Button variant="secondary" onClick={() => setImporting(true)}>Importar desde Excel</Button></div>}>
            Registra sillas, mesas, mantelería, carpas, vajilla o equipos con su cantidad total. El sistema calcula lo disponible en cada fecha y no te deja apartar más de lo que tienes.
          </EmptyState>
        ) : (
          <>
            <div className="hidden grid-cols-[1fr_90px_100px_100px_120px_40px] gap-3 border-b border-line px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
              <span>Artículo</span><span className="text-right">Total</span><span className="text-right">Mantenim.</span><span className="text-right">Libre hoy</span><span className="text-right">Precio</span><span />
            </div>
            <ul className="divide-y divide-line">
              {list.map((r) => {
                const a = now(r.id);
                const m = oos(r.id);
                const img = publicMediaUrl(r.image_path);
                return (
                  <li key={r.id} className={cx("grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:px-5 md:grid-cols-[1fr_90px_100px_100px_120px_40px]", !r.is_active && "opacity-60")}>
                    <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => !readOnly && setEditing(r)} disabled={readOnly}>
                      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                        {img ? <img src={img} alt="" className="size-full object-cover" /> : <Boxes className="size-5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{r.name}{!r.is_active && <Badge className="ml-2">Inactivo</Badge>}</span>
                        <span className="block truncate text-xs text-muted">{[r.category, r.sku && `Código ${r.sku}`].filter(Boolean).join(" · ") || "Sin categoría"}</span>
                        <span className="mt-0.5 block text-xs text-muted md:hidden">{r.total_qty} {r.unit}{r.total_qty === 1 ? "" : "s"} · libre hoy {a?.available ?? "—"}{m ? ` · ${m} en mantenimiento` : ""}</span>
                      </span>
                    </button>
                    <span className="hidden text-right tabular-nums md:block">{r.total_qty}</span>
                    <span className={cx("hidden text-right tabular-nums md:block", m > 0 ? "text-warn" : "text-faint")}>{m || "—"}</span>
                    <span className={cx("hidden text-right font-semibold tabular-nums md:block", a && a.available <= 0 && "text-danger")}>{a ? a.available : "—"}</span>
                    <span className="hidden text-right tabular-nums md:block">{formatMoney(Number(r.rent_price), r.currency_code, region.locale)}</span>
                    {!readOnly ? (
                      <span className="flex justify-end gap-0.5">
                        <button onClick={() => setDamaging(r)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink" title="Reportar daño o mantenimiento" aria-label={`Reportar daño de ${r.name}`}><Wrench className="size-4" /></button>
                        <button onClick={() => setEditing(r)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink md:hidden" aria-label={`Editar ${r.name}`}><Pencil className="size-4" /></button>
                      </span>
                    ) : <span />}
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">{list.length} artículos · {totalUnits.toLocaleString(region.locale)} unidades. "Libre hoy" descuenta lo alquilado en este momento y lo que está en mantenimiento.</p>
          </>
        )}
      </Card>
      {editing && <ResourceDialog resource={editing === "new" ? null : editing} categories={categories} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog existing={data ?? []} onClose={() => setImporting(false)} />}
      {damaging && <MaintenanceDialog resourceId={damaging.id} onClose={() => setDamaging(null)} />}
    </div>
  );
}

function ResourceDialog({ resource, categories, onClose }: { resource: Resource | null; categories: string[]; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateRental();
  const [f, setF] = useState({
    name: resource?.name ?? "", category: resource?.category ?? "", sku: resource?.sku ?? "", unit: resource?.unit ?? "unidad",
    total_qty: String(resource?.total_qty ?? ""), rent_price: String(resource?.rent_price ?? ""), replacement_cost: resource?.replacement_cost == null ? "" : String(resource.replacement_cost),
    currency_code: resource?.currency_code ?? region.currency_code, description: resource?.description ?? "", notes: resource?.notes ?? "", is_active: resource?.is_active ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeImg, setRemoveImg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const preview = file ? URL.createObjectURL(file) : removeImg ? null : publicMediaUrl(resource?.image_path);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del artículo.");
    const qty = Number(f.total_qty);
    if (!Number.isInteger(qty) || qty < 0) return setError("La cantidad total debe ser un número entero (0 o más).");
    setBusy(true);
    setError(null);
    try {
      let image_path = removeImg ? null : resource?.image_path ?? null;
      if (file) image_path = await uploadImage("event-media", `${ws.id}/inventario/${crypto.randomUUID()}.webp`, file, 1200);
      const row = {
        name: f.name.trim(), category: f.category.trim() || null, sku: f.sku.trim() || null, unit: f.unit, total_qty: qty,
        rent_price: Number(f.rent_price) || 0, replacement_cost: f.replacement_cost === "" ? null : Number(f.replacement_cost),
        currency_code: f.currency_code, description: f.description.trim() || null, notes: f.notes.trim() || null, is_active: f.is_active, image_path,
      };
      const res = resource ? await supabase.from("resources").update(row).eq("id", resource.id) : await supabase.from("resources").insert({ ...row, workspace_id: ws.id });
      if (res.error) throw new Error(res.error.code === "23505" ? "Ya tienes otro artículo con ese código." : res.error.message);
      if (resource?.image_path && image_path !== resource.image_path) await supabase.storage.from("event-media").remove([resource.image_path]);
      await invalidate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!resource || !confirm(`¿Eliminar "${resource.name}" del inventario?`)) return;
    const { error: err } = await supabase.from("resources").delete().eq("id", resource.id);
    if (err) return setError(err.code === "23503" ? "Este artículo ya se usó en reservaciones. Desactívalo en lugar de eliminarlo para conservar el historial." : err.message);
    if (resource.image_path) await supabase.storage.from("event-media").remove([resource.image_path]);
    await invalidate();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={resource ? "Editar artículo" : "Nuevo artículo"} wide
      footer={<>
        {resource && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="resource-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="resource-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <div>
          <label className="relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line-strong bg-paper text-muted hover:border-[var(--accent)]">
            {preview ? <img src={preview} alt="" className="absolute inset-0 size-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-xs"><ImagePlus className="size-6" />Foto</span>}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Foto del artículo" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemoveImg(false); e.target.value = ""; }} />
          </label>
          {preview && <button type="button" className="mt-1 text-xs text-muted hover:text-danger" onClick={() => { setFile(null); setRemoveImg(true); }}>Quitar foto</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Nombre">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Silla Tiffany dorada" autoFocus />}</Field></div>
          <Field label="Categoría" optional>{(id) => <><Input id={id} list="cats" value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Sillas, Mesas, Mantelería…" /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></>}</Field>
          <Field label="Código" optional>{(id) => <Input id={id} value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder="Ej. SIL-TIF-01" />}</Field>
          <Field label="Cantidad total" hint="Todas las unidades que tienes, incluidas las que estén alquiladas.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step={1} inputMode="numeric" value={f.total_qty} onChange={(e) => set("total_qty", e.target.value)} />}</Field>
          <Field label="Unidad">{(id) => <Select id={id} value={f.unit} onChange={(e) => set("unit", e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <Field label="Precio de alquiler">{(id) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={f.rent_price} onChange={(e) => set("rent_price", e.target.value)} />}</Field>
            <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option>NIO</option><option>USD</option></Select>}</Field>
          </div>
          <Field label="Costo de reposición" optional hint="Lo que cobras si se pierde o se daña.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.01" inputMode="decimal" value={f.replacement_cost} onChange={(e) => set("replacement_cost", e.target.value)} />}</Field>
          <div className="sm:col-span-2"><Field label="Descripción" optional hint="Medidas, color, material. Aparece en cotizaciones.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field></div>
          <div className="sm:col-span-2"><Field label="Notas internas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" />}</Field></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" />Activo (se puede alquilar)</label>
          {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
        </div>
      </form>
    </Dialog>
  );
}

const IMPORT_COLUMNS = ["Nombre", "Categoría", "Código", "Cantidad", "Precio de alquiler", "Costo de reposición", "Unidad", "Descripción"];

function ImportDialog({ existing, onClose }: { existing: Resource[]; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateRental();
  const fileRef = useRef<HTMLInputElement>(null);
  type Row = { name: string; category: string | null; sku: string | null; total_qty: number; rent_price: number; replacement_cost: number | null; unit: string; description: string | null };
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState(region.currency_code);

  async function downloadTemplate() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    await writeXlsxFile([
      IMPORT_COLUMNS.map((value) => ({ value, fontWeight: "bold" as const })),
      ["Silla Tiffany dorada", "Sillas", "SIL-01", 200, 35, 900, "unidad", "Silla de resina con cojín blanco"].map((value) => ({ value: value as string | number })),
      ["Mantel redondo blanco 3 m", "Mantelería", "MAN-01", 60, 80, 600, "unidad", ""].map((value) => ({ value: value as string | number })),
    ], { columns: IMPORT_COLUMNS.map(() => ({ width: 20 })) }).toFile("Plantilla de inventario.xlsx");
  }

  async function readFile(file: File) {
    setError(null);
    try {
      const { readSheet } = await import("read-excel-file/browser");
      const data = await readSheet(file);
      if (!data.length) throw new Error("El archivo está vacío.");
      const header = (data[0] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
      const col = { name: idx(["nombre", "artículo", "articulo"]), cat: idx(["categor"]), sku: idx(["código", "codigo", "sku"]),
        qty: idx(["cantidad", "existencia", "total"]), price: idx(["precio"]), cost: idx(["costo", "reposición", "reposicion"]), unit: idx(["unidad"]), desc: idx(["descrip"]) };
      if (col.name < 0 || col.qty < 0) throw new Error("No encontramos las columnas “Nombre” y “Cantidad”. Usa la plantilla.");
      const cell = (r: unknown[], i: number) => (i < 0 || r[i] == null ? "" : String(r[i]).trim());
      const num = (s: string) => Number(s.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
      const warn: string[] = [];
      const seen = new Set(existing.map((r) => r.name.toLowerCase()));
      const parsed = data.slice(1).map((r, n): Row | null => {
        const name = cell(r, col.name);
        if (!name) return null;
        if (seen.has(name.toLowerCase())) { warn.push(`Fila ${n + 2}: "${name}" ya existe, se omitirá.`); return null; }
        seen.add(name.toLowerCase());
        const qty = num(cell(r, col.qty) || "0");
        if (!Number.isInteger(qty) || qty < 0) { warn.push(`Fila ${n + 2}: cantidad no válida, se omitirá.`); return null; }
        const price = num(cell(r, col.price) || "0");
        const cost = cell(r, col.cost) ? num(cell(r, col.cost)) : null;
        const unit = cell(r, col.unit).toLowerCase();
        return {
          name: name.slice(0, 160), category: cell(r, col.cat).slice(0, 60) || null, sku: cell(r, col.sku).slice(0, 40) || null, total_qty: qty,
          rent_price: Number.isFinite(price) && price >= 0 ? price : 0, replacement_cost: cost != null && Number.isFinite(cost) && cost >= 0 ? cost : null,
          unit: UNITS.includes(unit) ? unit : "unidad", description: cell(r, col.desc).slice(0, 2000) || null,
        };
      }).filter((x): x is Row => !!x);
      if (!parsed.length) throw new Error(warn.length ? "No hay artículos nuevos en el archivo." : "No hay artículos en el archivo.");
      setRows(parsed);
      setWarnings(warn.slice(0, 6));
    } catch (e) {
      setRows([]);
      setError((e as Error).message || "No se pudo leer el archivo. Debe ser .xlsx");
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("resources").insert(rows.map((r) => ({ ...r, workspace_id: ws.id, currency_code: currency })));
    setBusy(false);
    if (err) return setError(err.code === "23505" ? "Hay códigos repetidos con artículos que ya tienes." : err.message);
    await invalidate();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Importar inventario desde Excel" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="accent" disabled={!rows.length} loading={busy} onClick={() => void confirmImport()}>Importar {rows.length || ""} artículos</Button></>}>
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          <li>Descarga la plantilla y llénala (una fila por artículo).</li>
          <li>Súbela aquí, revisa la vista previa y confirma.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => void downloadTemplate()}>Descargar plantilla</Button>
          <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Elegir archivo .xlsx</Button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readFile(f); }} />
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 w-auto" aria-label="Moneda de los precios"><option value="NIO">Precios en córdobas</option><option value="USD">Precios en dólares</option></Select>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {warnings.length > 0 && <Alert tone="warn"><ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
        {rows.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper text-left text-xs text-muted"><tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Categoría</th><th className="px-3 py-2 text-right">Cantidad</th><th className="px-3 py-2 text-right">Precio</th></tr></thead>
              <tbody className="divide-y divide-line">{rows.map((r) => <tr key={r.name}><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 text-muted">{r.category}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.total_qty}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(r.rent_price, currency, region.locale)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
