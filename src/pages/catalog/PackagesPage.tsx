import { useState, type FormEvent } from "react";
import { ImagePlus, Package as PackageIcon, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl, uploadImage } from "@/lib/events";
import { marginTone, profit, useCatalog, useCatalogCosts, useInvalidateCatalog, usePackageItems, usePackages, type Package } from "@/lib/catalog";
import { formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";
import { CostEditor, ProfitBox, saveCosts, toDrafts } from "./CatalogPage";
import { Link } from "react-router";

/** Paquetes: combinaciones de tu catálogo con un precio propio, su costo real y lo que ahorra el cliente. */
export default function PackagesPage() {
  const { ws, region, readOnly, modules } = useWorkspace();
  const { data, isLoading } = usePackages(ws.id);
  const { data: items } = useCatalog(ws.id);
  const { data: pitems } = usePackageItems(ws.id);
  const [editing, setEditing] = useState<Package | "new" | null>(null);
  const money = (n: number, c: string) => formatMoney(n, c, region.locale);
  const hasCatalog = modules.some((m) => m.module_key === "catalog");

  return (
    <div className="animate-rise">
      <PageHeader title="Paquetes" description="Combina servicios de tu catálogo en una oferta con precio propio. El sistema suma el costo real y te dice cuánto ganas y cuánto ahorra el cliente."
        actions={!readOnly && !!items?.length && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo paquete</Button>} />
      {isLoading ? <Spinner /> : !items?.length ? (
        <Card><EmptyState icon={<PackageIcon className="size-6" />} title="Primero arma tu catálogo"
          action={hasCatalog && <Link to={workspacePath(ws.kind, ws.id, "m/catalog")}><Button variant="accent">Ir al catálogo</Button></Link>}>
          Un paquete se forma con servicios del catálogo (por ejemplo: decoración + flores + sonido).
        </EmptyState></Card>
      ) : !data?.length ? (
        <Card><EmptyState icon={<PackageIcon className="size-6" />} title="Aún no tienes paquetes" action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Crear el primero</Button>}>
          Ejemplo: "Boda Clásica" con arco floral, 20 centros de mesa y montaje, a un precio especial.
        </EmptyState></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => {
            const pr = profit(p.price, p.cost_total);
            const savings = Number(p.items_value) - Number(p.price);
            const content = (pitems ?? []).filter((x) => x.package_id === p.id);
            const img = publicMediaUrl(p.image_path);
            return (
              <button key={p.id} disabled={readOnly} onClick={() => setEditing(p)} className={cx("overflow-hidden rounded-2xl border border-line bg-card text-left shadow-[var(--shadow-card)] hover:border-line-strong", !p.is_active && "opacity-60")}>
                <div className="aspect-[16/8] bg-paper">{img ? <img src={img} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-faint"><PackageIcon className="size-9" /></div>}</div>
                <div className="p-4">
                  <div className="flex items-center gap-2 font-semibold">{p.name}{!p.is_active && <Badge>Inactivo</Badge>}</div>
                  <div className="text-xs text-muted">{content.length} {content.length === 1 ? "elemento" : "elementos"}{savings > 0 ? ` · el cliente ahorra ${money(savings, p.currency_code)}` : ""}</div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div className="font-display text-2xl font-semibold tabular-nums">{money(p.price, p.currency_code)}</div>
                    <div className="text-right text-xs"><div className="text-muted">Costo {money(p.cost_total, p.currency_code)}</div><div className={cx("font-semibold", marginTone(pr.margin))}>Ganas {money(pr.gain, p.currency_code)} ({Math.round(pr.margin)}%)</div></div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {editing && <PackageDialog pkg={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PackageDialog({ pkg, onClose }: { pkg: Package | null; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateCatalog();
  const { data: items } = useCatalog(ws.id);
  const { data: pitems } = usePackageItems(ws.id);
  const { data: costs } = useCatalogCosts(ws.id);
  const prevItems = (pitems ?? []).filter((x) => x.package_id === pkg?.id);
  const prevCosts = (costs ?? []).filter((c) => c.package_id === pkg?.id);
  const [f, setF] = useState({ name: pkg?.name ?? "", description: pkg?.description ?? "", price: pkg ? String(pkg.price) : "", currency_code: pkg?.currency_code ?? region.currency_code, is_active: pkg?.is_active ?? true });
  const [lines, setLines] = useState<{ item_id: string; quantity: string }[] | null>(null);
  const content = lines ?? prevItems.map((x) => ({ item_id: x.item_id, quantity: String(x.quantity) }));
  const [rows, setRows] = useState<ReturnType<typeof toDrafts> | null>(null);
  const extra = rows ?? toDrafts(prevCosts);
  const [pick, setPick] = useState({ item_id: "", quantity: "1" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const item = (id: string) => items?.find((i) => i.id === id);
  const money = (n: number) => formatMoney(n, f.currency_code, region.locale);
  const itemsCost = content.reduce((s, l) => s + Number(item(l.item_id)?.cost_total ?? 0) * (Number(l.quantity) || 0), 0);
  const itemsValue = content.reduce((s, l) => s + Number(item(l.item_id)?.price ?? 0) * (Number(l.quantity) || 0), 0);
  const extraCost = extra.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const otherCurrency = content.some((l) => item(l.item_id) && item(l.item_id)!.currency_code !== f.currency_code);
  const preview = file ? URL.createObjectURL(file) : publicMediaUrl(pkg?.image_path);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Ponle un nombre al paquete.");
    if (!content.length) return setError("Agrega al menos un servicio del catálogo.");
    if (f.price === "" || !(Number(f.price) >= 0)) return setError("Indica el precio del paquete.");
    setBusy(true); setError(null);
    try {
      let image_path = pkg?.image_path ?? null;
      if (file) image_path = await uploadImage("event-media", `${ws.id}/paquetes/${crypto.randomUUID()}.webp`, file, 1400);
      const row = { name: f.name.trim(), description: f.description.trim() || null, price: Number(f.price), currency_code: f.currency_code, is_active: f.is_active, image_path };
      const res = pkg ? await supabase.from("packages").update(row).eq("id", pkg.id).select("id").single() : await supabase.from("packages").insert({ ...row, workspace_id: ws.id }).select("id").single();
      if (res.error) throw new Error(res.error.message);
      const id = (res.data as { id: string }).id;
      // Contenido: reemplaza lo que cambió
      for (const p of prevItems.filter((p) => !content.some((l) => l.item_id === p.item_id))) await supabase.from("package_items").delete().eq("id", p.id);
      for (const [n, l] of content.entries()) {
        const existing = prevItems.find((p) => p.item_id === l.item_id);
        const r = existing ? await supabase.from("package_items").update({ quantity: Number(l.quantity) || 1, sort: n }).eq("id", existing.id)
          : await supabase.from("package_items").insert({ workspace_id: ws.id, package_id: id, item_id: l.item_id, quantity: Number(l.quantity) || 1, sort: n });
        if (r.error) throw new Error(r.error.message);
      }
      await saveCosts(ws.id, { package_id: id }, extra, prevCosts);
      if (pkg?.image_path && image_path !== pkg.image_path) await supabase.storage.from("event-media").remove([pkg.image_path]);
      await invalidate();
      onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!pkg || !confirm(`¿Eliminar el paquete "${pkg.name}"?`)) return;
    await supabase.from("packages").delete().eq("id", pkg.id);
    if (pkg.image_path) await supabase.storage.from("event-media").remove([pkg.image_path]);
    await invalidate();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={pkg ? `Editar: ${pkg.name}` : "Nuevo paquete"} wide
      footer={<>
        {pkg && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="pkg-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="pkg-form" onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
          <label className="relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line-strong bg-paper text-muted hover:border-[var(--accent)]">
            {preview ? <img src={preview} alt="" className="absolute inset-0 size-full object-cover" /> : <span className="flex flex-col items-center gap-1 text-xs"><ImagePlus className="size-6" />Foto</span>}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Foto del paquete" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          </label>
          <div className="space-y-3">
            <Field label="Nombre del paquete">{(id) => <Input id={id} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Ej. Boda Clásica" autoFocus />}</Field>
            <Field label="Descripción" optional hint="Aparece en la cotización.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} className="min-h-16" />}</Field>
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold">¿Qué incluye?</h3>
          {content.length > 0 && (
            <ul className="mb-2 divide-y divide-line rounded-xl border border-line">
              {content.map((l, i) => {
                const it = item(l.item_id);
                return (
                  <li key={l.item_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <Input type="number" min={0.01} step="any" value={l.quantity} onChange={(e) => setLines(content.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)))} className="h-9 w-20 text-right" aria-label={`Cantidad de ${it?.name}`} />
                    <span className="min-w-0 flex-1">{it?.name ?? "—"} <span className="text-xs text-muted">· {formatMoney(Number(it?.price ?? 0), it?.currency_code, region.locale)} c/u · costo {formatMoney(Number(it?.cost_total ?? 0), it?.currency_code, region.locale)}</span></span>
                    <button type="button" onClick={() => setLines(content.filter((_, k) => k !== i))} className="rounded-lg p-1.5 text-muted hover:text-danger" aria-label={`Quitar ${it?.name}`}><Trash2 className="size-4" /></button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_90px_auto]">
            <Select value={pick.item_id} onChange={(e) => setPick((s) => ({ ...s, item_id: e.target.value }))} aria-label="Servicio del catálogo">
              <option value="">Agregar del catálogo…</option>
              {(items ?? []).filter((i) => i.is_active && !content.some((l) => l.item_id === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} · {formatMoney(Number(i.price), i.currency_code, region.locale)}</option>)}
            </Select>
            <Input type="number" min={0.01} step="any" value={pick.quantity} onChange={(e) => setPick((s) => ({ ...s, quantity: e.target.value }))} aria-label="Cantidad" className="text-right" />
            <Button type="button" variant="secondary" icon={<Plus className="size-4" />} disabled={!pick.item_id} onClick={() => { setLines([...content, pick]); setPick({ item_id: "", quantity: "1" }); }}>Agregar</Button>
          </div>
          {otherCurrency && <p className="mt-1 text-xs text-warn">Hay servicios en otra moneda; los montos se suman tal cual. Usa la misma moneda para cifras exactas.</p>}
        </section>

        <section>
          <h3 className="text-sm font-semibold">Costos propios del paquete <span className="font-normal text-muted">(además de los de cada servicio)</span></h3>
          <p className="mb-2 text-xs text-muted">Ej. transporte, coordinador del día, viáticos.</p>
          <CostEditor rows={extra} setRows={setRows} currency={f.currency_code} />
        </section>

        <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
          <Field label="Precio del paquete (sin IVA)" hint={`Por separado costaría ${money(itemsValue)}${itemsValue > Number(f.price || 0) && f.price ? ` · el cliente ahorra ${money(itemsValue - Number(f.price))}` : ""}`}>{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.01" value={f.price} onChange={(e) => setF((s) => ({ ...s, price: e.target.value }))} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => setF((s) => ({ ...s, currency_code: e.target.value }))}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>}</Field>
        </div>
        <ProfitBox price={Number(f.price) || 0} cost={itemsCost + extraCost} currency={f.currency_code} onUsePrice={(p) => setF((s) => ({ ...s, price: String(p) }))} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF((s) => ({ ...s, is_active: e.target.checked }))} className="size-4 accent-ink" />Activo (se puede cotizar)</label>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
