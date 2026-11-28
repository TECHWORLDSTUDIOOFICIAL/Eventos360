import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CalendarClock, ClipboardList, Copy, Lock, Plus, Printer, ShoppingCart, Trash2, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { formatDate, formatMoney, plural } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { fromLocalInput, toLocalInput } from "@/lib/events";
import { docNumber, useCustomers, type Quote, type QuoteItem } from "@/lib/pro";
import { scheduleText } from "@/lib/venues";
import {
  COURSES, ORDER_STATUS, UNITS, cutoffDate, foodCost, priceFor, purchaseLabel, useCateringOrders, useCateringSettings, useIngredients, useInvalidateCatering,
  useMenuItems, useMenus, useOrderParts, usePriceTiers, useRecipes, useSheet, useShopping, type CateringOrder,
} from "@/lib/catering";
import { useSuppliers } from "@/pages/personal/SuppliersPage";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { CustomerSelect, SupplierSelect } from "@/components/QuickCreate";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

export default function OrdersPage() {
  const { itemId } = useParams();
  if (itemId === "nuevo") return <NewOrder />;
  return itemId ? <OrderDetail id={itemId} /> : <OrderList />;
}

const num = (n: number) => docNumber("PED", n);

function OrderList() {
  const { ws, region, readOnly } = useWorkspace();
  const { data: orders, isLoading } = useCateringOrders(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const { data: menus } = useMenus(ws.id);
  const { data: settings } = useCateringSettings(ws.id);
  const [tab, setTab] = useState<"proximos" | "pasados" | "compras">("proximos");
  const now = Date.now();
  const list = (orders ?? []).filter((o) => tab === "proximos" ? new Date(o.service_at).getTime() >= now - 864e5 / 2 : new Date(o.service_at).getTime() < now - 864e5 / 2);
  if (tab === "pasados") list.reverse();
  return (
    <div className="animate-rise">
      <PageHeader title="Pedidos" description="Cada evento de catering: invitados, menú, restricciones, hoja de cocina y compras. La lista de compras se arma sola."
        actions={!readOnly && <Link to={workspacePath(ws.kind, ws.id, "m/orders/nuevo")}><Button variant="accent" icon={<Plus className="size-4" />}>Nuevo pedido</Button></Link>} />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {([["proximos", "Próximos"], ["pasados", "Pasados"], ["compras", "Lista de compras"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
      {tab === "compras" ? <Shopping /> : isLoading ? <Spinner /> : !list.length ? (
        <Card><EmptyState icon={<ClipboardList className="size-6" />} title={tab === "proximos" ? "No hay pedidos próximos" : "Sin pedidos pasados"}>
          {tab === "proximos" && "Crea un pedido desde una cotización aceptada (botón “Crear pedido de catering”) o aquí mismo con “Nuevo pedido”."}
        </EmptyState></Card>
      ) : (
        <Card><ul className="divide-y divide-line">
          {list.map((o) => {
            const cut = settings ? cutoffDate(o, settings) : null;
            const closed = cut ? cut.getTime() <= now : false;
            const daysToCut = cut ? Math.ceil((cut.getTime() - now) / 864e5) : null;
            return (
              <li key={o.id}><Link to={workspacePath(ws.kind, ws.id, `m/orders/${o.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                <span className="w-28 text-sm text-muted">{formatDate(o.service_at, { timeZone: region.timezone })}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium"><span className="font-mono text-xs text-muted">{num(o.number)}</span> {o.title}</span>
                  <span className="block truncate text-xs text-muted">{[customers?.find((c) => c.id === o.customer_id)?.name, menus?.find((m) => m.id === o.menu_id)?.name, `${o.adults + o.kids} invitados`].filter(Boolean).join(" · ")}</span></span>
                {tab === "proximos" && o.status !== "canceled" && o.status !== "draft" && (closed ? <Badge><Lock className="mr-1 inline size-3" />Número cerrado</Badge>
                  : daysToCut !== null && daysToCut <= 3 && <Badge tone="warn">Cierre en {plural(daysToCut, "día", "días")}</Badge>)}
                <Badge tone={ORDER_STATUS[o.status]!.tone}>{ORDER_STATUS[o.status]!.label}</Badge>
              </Link></li>
            );
          })}
        </ul></Card>
      )}
    </div>
  );
}

/** Nuevo pedido: desde una cotización (el cobro va en la cotización) o directo con precio propio. */
function NewOrder() {
  const { ws, region } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const invalidate = useInvalidateCatering();
  const quoteId = params.get("cotizacion");
  const { data: menus } = useMenus(ws.id);
  const { data: tiers } = usePriceTiers(ws.id);
  const fromQuote = useQuery({
    enabled: !!quoteId, queryKey: ["quote-for-order", quoteId],
    queryFn: async () => {
      const q = unwrap<Quote>(await supabase.from("quotes").select("*").eq("id", quoteId).single());
      const items = unwrap<(QuoteItem & { menu_id: string | null })[]>(await supabase.from("quote_items").select("*").eq("quote_id", quoteId).order("sort"));
      const ev = q.event_id ? unwrap<{ starts_at: string | null; venue_name: string | null }>(await supabase.from("events").select("starts_at, venue_name").eq("id", q.event_id).single()) : null;
      return { q, items, ev };
    },
  });
  const [f, setF] = useState({ customer_id: "", title: "", date: "", time: "18:00", location: "", menu_id: "", adults: "", kids: "0", price: "", kids_price: "", other: "0", tax: String(region.tax_rate ?? 15), currency_code: region.currency_code });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    const d = fromQuote.data; if (!d) return;
    const line = d.items.find((x) => x.menu_id);
    const when = d.ev?.starts_at ? toLocalInput(d.ev.starts_at, region.timezone) : "";
    setF((s) => ({ ...s, customer_id: d.q.customer_id, title: d.q.title, currency_code: d.q.currency_code, menu_id: line?.menu_id ?? "", adults: line ? String(Number(line.quantity)) : "",
      date: when.slice(0, 10), time: when.slice(11, 16) || s.time, location: d.ev?.venue_name ?? "" }));
  }, [fromQuote.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const menu = menus?.find((m) => m.id === f.menu_id);
  // Precio sugerido según invitados (precios por volumen)
  useEffect(() => {
    if (!menu || quoteId) return;
    const g = Number(f.adults) || menu.min_guests;
    setF((s) => ({ ...s, currency_code: menu.currency_code, price: String(priceFor(menu, tiers ?? [], g)), kids_price: String(menu.kids_price ?? priceFor(menu, tiers ?? [], g)) }));
  }, [f.menu_id, f.adults]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.customer_id) return setError("Elige el cliente.");
    if (f.title.trim().length < 2) return setError("Escribe un nombre para el pedido.");
    if (!f.date) return setError("Elige la fecha del servicio.");
    if (!f.menu_id) return setError("Elige el menú.");
    if (!(Number(f.adults) > 0)) return setError("Indica cuántos adultos.");
    setBusy(true);
    const row = {
      workspace_id: ws.id, customer_id: f.customer_id, quote_id: quoteId ?? null, event_id: fromQuote.data?.q.event_id ?? null, title: f.title.trim(),
      service_at: fromLocalInput(`${f.date}T${f.time}`, region.timezone), location: f.location.trim() || null, menu_id: f.menu_id, adults: Number(f.adults), kids: Number(f.kids) || 0,
      currency_code: menu?.currency_code ?? f.currency_code,
      ...(quoteId ? {} : { price_per_person: Number(f.price) || 0, kids_price: Number(f.kids_price) || 0, other_charges: Number(f.other) || 0, tax_rate: Number(f.tax) || 0 }),
    };
    const { data, error: err } = await supabase.from("catering_orders").insert(row).select("id").single();
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate();
    navigate(workspacePath(ws.kind, ws.id, `m/orders/${(data as { id: string }).id}`), { replace: true });
  }
  const money = (n: number) => formatMoney(n, menu?.currency_code ?? f.currency_code, region.locale);
  const subtotal = (Number(f.adults) || 0) * (Number(f.price) || 0) + (Number(f.kids) || 0) * (Number(f.kids_price) || 0) + (Number(f.other) || 0);

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <PageHeader title="Nuevo pedido" description={fromQuote.data ? `A partir de la cotización ${docNumber("COT", fromQuote.data.q.number)}. El cobro sigue en la cotización.` : "Para un evento de catering. Si ya tienes la cotización aceptada, créalo desde ella."} />
      <Card className="p-5">
        {quoteId && fromQuote.isLoading ? <Spinner /> : (
          <form onSubmit={submit} className="space-y-4">
            {!quoteId && <Field label="Cliente">{(id) => <CustomerSelect id={id} value={f.customer_id} onChange={(v) => set("customer_id", v)} />}</Field>}
            <Field label="Nombre del pedido">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej. Boda Ruiz – cena" />}</Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_0.7fr]">
              <Field label="Fecha del servicio">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />}</Field>
              <Field label="Hora">{(id) => <Input id={id} type="time" value={f.time} onChange={(e) => set("time", e.target.value)} />}</Field>
            </div>
            <Field label="Lugar" optional>{(id) => <Input id={id} value={f.location} onChange={(e) => set("location", e.target.value)} />}</Field>
            <Field label="Menú">{(id) => <Select id={id} value={f.menu_id} onChange={(e) => set("menu_id", e.target.value)}><option value="">Elegir…</option>
              {(menus ?? []).filter((m) => m.is_active || m.id === f.menu_id).map((m) => <option key={m.id} value={m.id}>{m.name} · {formatMoney(Number(m.price_per_person), m.currency_code, region.locale)} p/p</option>)}</Select>}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Adultos" hint={menu && Number(f.adults) > 0 && Number(f.adults) < menu.min_guests ? `El mínimo del menú es ${menu.min_guests}.` : undefined}>{(id, d) => <Input id={id} aria-describedby={d} type="number" min="1" value={f.adults} onChange={(e) => set("adults", e.target.value)} />}</Field>
              <Field label="Niños" hint="Se calcula media porción (editable en Configuración).">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="0" value={f.kids} onChange={(e) => set("kids", e.target.value)} />}</Field>
            </div>
            {!quoteId && <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Precio adulto (sin IVA)">{(id) => <Input id={id} type="number" min="0" step="0.01" value={f.price} onChange={(e) => set("price", e.target.value)} />}</Field>
                <Field label="Precio niño">{(id) => <Input id={id} type="number" min="0" step="0.01" value={f.kids_price} onChange={(e) => set("kids_price", e.target.value)} />}</Field>
                <Field label="Otros cargos" hint="Meseros, mantelería…">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="0" step="0.01" value={f.other} onChange={(e) => set("other", e.target.value)} />}</Field>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-paper px-4 py-3 text-sm"><span className="text-muted">Subtotal sin IVA</span><span className="font-semibold tabular-nums">{money(subtotal)}</span></div>
            </>}
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" variant="accent" className="w-full" loading={busy}>Crear pedido</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

const RESTRICTIONS = ["Vegetariano", "Vegano", "Sin gluten", "Sin lactosa", "Alergia a mariscos", "Alergia al maní", "Plato infantil", "Diabético"];

function OrderDetail({ id }: { id: string }) {
  const { ws, region, readOnly } = useWorkspace();
  const invalidate = useInvalidateCatering();
  const { data: orders, isLoading } = useCateringOrders(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const { data: menus } = useMenus(ws.id);
  const { data: menuItems } = useMenuItems(ws.id);
  const { data: recipes } = useRecipes(ws.id);
  const { data: settings } = useCateringSettings(ws.id);
  const { data: suppliers } = useSuppliers();
  const parts = useOrderParts(id);
  const sheet = useSheet(id);
  const [error, setError] = useState<string | null>(null);
  const [restr, setRestr] = useState({ label: "", people: "1", notes: "" });
  const [buy, setBuy] = useState({ date: new Date().toISOString().slice(0, 10), description: "", amount: "", supplier_id: "" });
  const o = orders?.find((x) => x.id === id);
  if (isLoading || !settings) return <Spinner />;
  if (!o) return <EmptyState title="Pedido no encontrado"><Link to={workspacePath(ws.kind, ws.id, "m/orders")} className="underline">Volver a pedidos</Link></EmptyState>;
  const order = o;
  const menu = menus?.find((m) => m.id === order.menu_id);
  const money = (n: number) => formatMoney(n, order.currency_code, region.locale);
  const people = order.adults + order.kids;
  const cut = cutoffDate(order, settings);
  const closed = cut.getTime() <= Date.now() && order.status !== "draft";
  const editable = !readOnly && order.status !== "canceled" && order.status !== "delivered";
  const waiters = Math.ceil(people / settings.guests_per_waiter);
  const groups = Object.entries((menuItems ?? []).filter((m) => m.menu_id === order.menu_id && m.option_group).reduce<Record<string, typeof menuItems>>((acc, m) => { (acc[m.option_group!] ??= []).push(m); return acc; }, {}));
  const choice = (mid: string) => parts.data?.choices.find((c) => c.menu_item_id === mid);
  const cost = Math.max(Number(order.cost_estimated), Number(order.cost_actual));
  const fc = order.quote_id ? null : foodCost(cost, Number(order.subtotal), Number(settings.food_cost_target));

  async function update(patch: Partial<CateringOrder>) {
    setError(null);
    const { error: err } = await supabase.from("catering_orders").update(patch).eq("id", order.id);
    if (err) setError(err.message);
    await invalidate();
  }
  async function setChoice(menuItemId: string, plates: string) {
    const c = choice(menuItemId);
    const v = plates === "" ? null : Math.max(0, Math.round(Number(plates)));
    const res = v === null ? (c ? await supabase.from("catering_order_choices").delete().eq("id", c.id) : null)
      : c ? await supabase.from("catering_order_choices").update({ plates: v }).eq("id", c.id)
      : await supabase.from("catering_order_choices").insert({ workspace_id: ws.id, order_id: order.id, menu_item_id: menuItemId, plates: v });
    if (res?.error) setError(res.error.message);
    await invalidate();
  }
  async function addRestriction(e: FormEvent) {
    e.preventDefault();
    if (restr.label.trim().length < 2) return;
    const { error: err } = await supabase.from("catering_order_restrictions").insert({ workspace_id: ws.id, order_id: order.id, label: restr.label.trim(), people: Number(restr.people) || 1, notes: restr.notes.trim() || null });
    if (err) return setError(err.message);
    setRestr({ label: "", people: "1", notes: "" }); await invalidate();
  }
  async function addPurchase(e: FormEvent) {
    e.preventDefault();
    if (buy.description.trim().length < 2 || !(Number(buy.amount) >= 0) || buy.amount === "") return setError("Describe la compra y su monto.");
    const { error: err } = await supabase.from("catering_purchases").insert({ workspace_id: ws.id, order_id: order.id, purchased_on: buy.date, description: buy.description.trim(), amount: Number(buy.amount), supplier_id: buy.supplier_id || null });
    if (err) return setError(err.message);
    setBuy((s) => ({ ...s, description: "", amount: "", supplier_id: "" })); await invalidate();
  }
  async function del(table: string, rid: string) { await supabase.from(table).delete().eq("id", rid); await invalidate(); }

  return (
    <div className="animate-rise">
      <Link to={workspacePath(ws.kind, ws.id, "m/orders")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink print:hidden"><ArrowLeft className="size-4" />Pedidos</Link>
      <PageHeader eyebrow={num(order.number)} title={order.title}
        description={<span className="flex flex-col gap-0.5"><span className="first-letter:uppercase">{scheduleText(order.service_at, order.service_at, region.timezone, region.locale).split(" – ")[0]}{order.location ? ` · ${order.location}` : ""}</span>
          <span>{customers?.find((c) => c.id === order.customer_id)?.name}{order.quote_id && <> · <Link to={workspacePath(ws.kind, ws.id, `m/quotes/${order.quote_id}`)} className="underline print:no-underline">cobro en la cotización</Link></>}</span></span>}
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          <Select value={order.status} disabled={readOnly} onChange={(e) => void update({ status: e.target.value })} className="h-10 w-auto" aria-label="Estado">{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Hoja de cocina</Button>
        </div>} />
      {error && <div className="mb-4 print:hidden"><Alert tone="danger" onClose={() => setError(null)}>{error}</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <div className="space-y-5">
          <Card>
            <CardHeader title={`${people} invitados · ${menu?.name ?? "Sin menú"}`} description={closed ? `Número cerrado desde el ${formatDate(cut.toISOString(), { timeZone: region.timezone })}: solo puede aumentar.` : order.status === "draft" ? "Borrador: no entra a compras." : `Puedes ajustar el número hasta el ${formatDate(cut.toISOString(), { timeZone: region.timezone })}.`} />
            <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
              <label className="text-xs text-muted">Adultos<Input type="number" min={closed ? order.adults : 0} defaultValue={order.adults} key={`a${order.adults}`} disabled={!editable} className="mt-1 h-10"
                onBlur={(e) => { const v = Number(e.target.value); if (v !== order.adults) void update({ adults: v }); }} /></label>
              <label className="text-xs text-muted">Niños<Input type="number" min={0} defaultValue={order.kids} key={`k${order.kids}`} disabled={!editable} className="mt-1 h-10"
                onBlur={(e) => { const v = Number(e.target.value); if (v !== order.kids) void update({ kids: v }); }} /></label>
              <label className="text-xs text-muted">Cierre (días antes)<Input type="number" min={0} max={90} placeholder={String(settings.cutoff_days)} defaultValue={order.cutoff_days ?? ""} disabled={!editable} className="mt-1 h-10"
                onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== order.cutoff_days) void update({ cutoff_days: v }); }} /></label>
              <label className="text-xs text-muted">Fecha y hora<Input type="datetime-local" defaultValue={toLocalInput(order.service_at, region.timezone)} disabled={!editable} className="mt-1 h-10"
                onBlur={(e) => { const v = fromLocalInput(e.target.value, region.timezone); if (v && v !== order.service_at) void update({ service_at: v }); }} /></label>
            </div>
            {closed && <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted"><Lock className="size-3.5" />Si el cliente aumenta invitados después del cierre, cobra la diferencia{order.quote_id ? " con una cotización adicional" : " (se actualiza el total)"}.</p>}
          </Card>

          {groups.length > 0 && (
            <Card className="print:hidden">
              <CardHeader title="Lo que eligieron los invitados" description={`Cuántos platos de cada opción (deben sumar ${people}). Si lo dejas vacío, se reparte en partes iguales.`} />
              <div className="space-y-4 px-5 pb-5">
                {groups.map(([g, list]) => {
                  const sum = list!.reduce((t, m) => t + (choice(m.id)?.plates ?? 0), 0);
                  return (
                    <div key={g}>
                      <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{g}</span>{sum > 0 && <span className={cx("text-xs", sum === people ? "text-ok" : "text-warn")}>{sum} de {people}</span>}</div>
                      <div className="grid gap-2 sm:grid-cols-2">{list!.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{recipes?.find((r) => r.id === m.recipe_id)?.name}</span>
                          <Input type="number" min={0} defaultValue={choice(m.id)?.plates ?? ""} key={`${m.id}${choice(m.id)?.plates}`} disabled={!editable} className="h-9 w-20 text-right" placeholder="—"
                            onBlur={(e) => { if (e.target.value !== String(choice(m.id)?.plates ?? "")) void setChoice(m.id, e.target.value); }} aria-label={`Platos de ${recipes?.find((r) => r.id === m.recipe_id)?.name}`} />
                        </label>))}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Hoja de producción" description={`Para ${people} invitados (${order.adults} adultos, ${order.kids} niños a ${Number(settings.kids_portion) * 100}% de porción).`} />
            {sheet.isLoading ? <Spinner /> : !sheet.data?.dishes.length ? <p className="px-5 pb-5 text-sm text-muted">El menú no tiene platos.</p> : (
              <div className="divide-y divide-line">
                {sheet.data.dishes.map((d) => (
                  <div key={d.recipe_id} className="no-break px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-semibold">{d.name} <span className="text-xs font-normal text-muted">{COURSES[d.course]}{d.option_group ? ` · opción de ${d.option_group}` : ""}</span></h3>
                      <span className="font-display text-lg font-semibold tabular-nums">{Math.ceil(Number(d.portions))} porciones</span>
                    </div>
                    <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      {d.ingredients.map((i, k) => <li key={k} className="flex justify-between gap-3 border-b border-dashed border-line py-0.5"><span>{i.name}{i.note ? <span className="text-muted"> ({i.note})</span> : ""}</span><span className="tabular-nums">{Number(i.quantity)} {UNITS[i.unit]?.short ?? i.unit}</span></li>)}
                    </ul>
                    {d.instructions && <p className="mt-2 whitespace-pre-line text-xs text-muted">{d.instructions}</p>}
                  </div>
                ))}
              </div>
            )}
            {(parts.data?.restrictions.length ?? 0) > 0 && <div className="border-t border-line px-5 py-3 text-sm"><span className="font-semibold">Platos especiales:</span> {parts.data!.restrictions.map((r) => `${r.people} ${r.label.toLowerCase()}${r.notes ? ` (${r.notes})` : ""}`).join(" · ")}</div>}
            {order.kitchen_notes && <div className="border-t border-line px-5 py-3 text-sm"><span className="font-semibold">Notas para cocina:</span> {order.kitchen_notes}</div>}
          </Card>
        </div>

        <div className="space-y-5 print:hidden">
          <Card>
            <CardHeader title="Costo y ganancia" />
            <dl className="space-y-1.5 px-5 pb-5 text-sm">
              {!order.quote_id && <><div className="flex justify-between"><dt className="text-muted">Venta sin IVA</dt><dd className="tabular-nums">{money(Number(order.subtotal))}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Total con IVA</dt><dd className="tabular-nums">{money(Number(order.total))}</dd></div></>}
              <div className="flex justify-between"><dt className="text-muted">Costo estimado (menú)</dt><dd className="tabular-nums">{money(Number(order.cost_estimated))}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Compras registradas</dt><dd className={cx("tabular-nums", Number(order.cost_actual) > Number(order.cost_estimated) && "font-semibold text-danger")}>{money(Number(order.cost_actual))}</dd></div>
              {fc && <div className="flex justify-between border-t border-line pt-1.5 font-semibold"><dt>Ganancia</dt><dd className={cx("tabular-nums", Number(order.subtotal) - cost < 0 && "text-danger")}>{money(Number(order.subtotal) - cost)}{fc.pct !== null && <span className={cx("ml-1 text-xs", fc.tone)}>· {fc.pct}% comida</span>}</dd></div>}
              {Number(order.cost_actual) > Number(order.cost_estimated) && <p className="flex items-start gap-1.5 pt-1 text-xs text-danger"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />Gastaste más de lo estimado: revisa precios de ingredientes o porciones.</p>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Restricciones" description="Vegetarianos, alergias, platos de niños." />
            <ul className="divide-y divide-line">{(parts.data?.restrictions ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-5 py-2 text-sm"><span className="flex-1">{r.people} × {r.label}{r.notes && <span className="text-muted"> · {r.notes}</span>}</span>
                {editable && <button onClick={() => void del("catering_order_restrictions", r.id)} className="rounded p-1 text-muted hover:text-danger" aria-label={`Quitar ${r.label}`}><X className="size-4" /></button>}</li>))}
            </ul>
            {editable && <form onSubmit={addRestriction} className="grid grid-cols-[1fr_64px_auto] gap-2 border-t border-line p-3">
              <datalist id="restr-list">{RESTRICTIONS.map((r) => <option key={r} value={r} />)}</datalist>
              <Input list="restr-list" value={restr.label} onChange={(e) => setRestr((s) => ({ ...s, label: e.target.value }))} placeholder="Vegetariano…" className="h-9" aria-label="Restricción" />
              <Input type="number" min="1" value={restr.people} onChange={(e) => setRestr((s) => ({ ...s, people: e.target.value }))} className="h-9 text-right" aria-label="Personas" />
              <Button type="submit" size="sm" variant="secondary" className="h-9" disabled={restr.label.trim().length < 2}>Agregar</Button>
              <Input value={restr.notes} onChange={(e) => setRestr((s) => ({ ...s, notes: e.target.value }))} placeholder="Detalle (opcional): sin cebolla, alérgico severo…" className="col-span-3 h-9" aria-label="Detalle de la restricción" />
            </form>}
          </Card>

          <Card>
            <CardHeader title="Compras reales" description="Lo que pagaste por este pedido. Se compara con lo estimado." />
            <ul className="divide-y divide-line">{(parts.data?.purchases ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-5 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{p.description}<span className="block text-xs text-muted">{[formatDate(`${p.purchased_on}T12:00:00Z`, { timeZone: "UTC" }), suppliers?.find((s) => s.id === p.supplier_id)?.name].filter(Boolean).join(" · ")}</span></span>
                <span className="tabular-nums">{money(Number(p.amount))}</span>
                {!readOnly && <button onClick={() => void del("catering_purchases", p.id)} className="rounded p-1 text-muted hover:text-danger" aria-label={`Quitar ${p.description}`}><X className="size-4" /></button>}</li>))}
            </ul>
            {!readOnly && <form onSubmit={addPurchase} className="grid grid-cols-2 gap-2 border-t border-line p-3">
              <Input value={buy.description} onChange={(e) => setBuy((s) => ({ ...s, description: e.target.value }))} placeholder="Ej. Mercado Oriental" className="col-span-2 h-9" aria-label="Descripción de la compra" />
              <Input type="number" min="0" step="0.01" value={buy.amount} onChange={(e) => setBuy((s) => ({ ...s, amount: e.target.value }))} placeholder="Monto" className="h-9 text-right" aria-label="Monto de la compra" />
              <Input type="date" value={buy.date} onChange={(e) => setBuy((s) => ({ ...s, date: e.target.value }))} className="h-9" aria-label="Fecha de la compra" />
              <SupplierSelect value={buy.supplier_id} onChange={(v) => setBuy((s) => ({ ...s, supplier_id: v }))} className="col-span-2 h-9" aria-label="Proveedor de la compra" />
              <Button type="submit" size="sm" variant="secondary" className="col-span-2">Registrar compra</Button>
            </form>}
          </Card>

          <Card className="p-5">
            <div className="flex items-start gap-3"><Users className="mt-0.5 size-5 text-muted" />
              <div className="text-sm"><div className="font-semibold">Personal sugerido: {plural(waiters, "mesero", "meseros")}</div>
                <div className="text-muted">1 por cada {settings.guests_per_waiter} invitados.</div>
                <Link to={workspacePath(ws.kind, ws.id, order.event_id ? `m/shifts?evento=${order.event_id}` : "m/shifts")} className="mt-1 inline-block font-semibold text-[var(--accent)]">Crear turno →</Link></div></div>
          </Card>
          <Card className="p-5">
            <Field label="Notas para cocina" optional>{(i) => <Textarea id={i} defaultValue={order.kitchen_notes ?? ""} disabled={readOnly} className="min-h-16"
              onBlur={(e) => { if ((e.target.value || null) !== order.kitchen_notes) void update({ kitchen_notes: e.target.value.trim() || null }); }} placeholder="Servir a las 7 p. m.; buffet; llevar 6 chafing dishes…" />}</Field>
          </Card>
          {!readOnly && order.status !== "delivered" && <Button variant="ghost" className="w-full text-danger" icon={<Trash2 className="size-4" />}
            onClick={() => { if (confirm("¿Eliminar este pedido? Se borran sus compras y restricciones.")) void supabase.from("catering_orders").delete().eq("id", order.id).then(() => { void invalidate(); history.back(); }); }}>Eliminar pedido</Button>}
        </div>
      </div>
    </div>
  );
}

/** Lista de compras de un rango de fechas: suma de todos los pedidos confirmados, en unidades de compra y con la merma. */
function Shopping() {
  const { ws, region } = useWorkspace();
  const { data: ingredients } = useIngredients(ws.id);
  const { data: suppliers } = useSuppliers();
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [range, setRange] = useState({ from: iso(today), to: iso(new Date(today.getTime() + 7 * 864e5)) });
  const { data, isLoading } = useShopping(ws.id, range.from, range.to);
  const [copied, setCopied] = useState(false);
  const bySupplier = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>>();
    for (const r of data ?? []) { const k = suppliers?.find((s) => s.id === r.supplier_id)?.name ?? "Sin proveedor"; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()].sort((a, b) => (a[0] === "Sin proveedor" ? 1 : b[0] === "Sin proveedor" ? -1 : a[0].localeCompare(b[0])));
  }, [data, suppliers]);
  const totals = (data ?? []).reduce<Record<string, number>>((acc, r) => { acc[r.currency_code] = (acc[r.currency_code] ?? 0) + Number(r.est_cost); return acc; }, {});
  const qtyText = (r: NonNullable<typeof data>[number]) => {
    const q = Number(r.purchase_qty);
    const label = purchaseLabel(r);
    const whole = Math.ceil(q - 1e-9);
    return r.purchase_unit === "paquete" || ["cajilla", "docena", "ciento", "botella", "quintal", "gal"].includes(r.purchase_unit) ? `${whole} ${label}${q % 1 ? ` (usas ${q})` : ""}` : `${q} ${label}`;
  };
  function copy() {
    const text = [`*Compras ${formatDate(`${range.from}T12:00:00Z`, { timeZone: "UTC" })} – ${formatDate(`${range.to}T12:00:00Z`, { timeZone: "UTC" })}*`,
      ...bySupplier.flatMap(([s, rows]) => ["", `*${s}*`, ...rows.map((r) => `• ${r.name}: ${qtyText(r)}`)])].join("\n");
    void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Input type="date" value={range.from} onChange={(e) => setRange((s) => ({ ...s, from: e.target.value }))} className="h-10 w-auto" aria-label="Desde" />
        <span className="text-muted">a</span>
        <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange((s) => ({ ...s, to: e.target.value }))} className="h-10 w-auto" aria-label="Hasta" />
        {!!data?.length && <><Button variant="secondary" icon={<Copy className="size-4" />} onClick={copy}>{copied ? "Copiada" : "Copiar para WhatsApp"}</Button>
          <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir</Button></>}
      </div>
      {isLoading ? <Spinner /> : !data?.length ? (
        <Card><EmptyState icon={<ShoppingCart className="size-6" />} title="Nada que comprar en estas fechas">
          {(ingredients?.length ?? 0) === 0 ? "Primero registra ingredientes y recetas." : "Aquí aparece lo que necesitas para los pedidos confirmados o en producción de las fechas elegidas."}
        </EmptyState></Card>
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-3 p-4"><CalendarClock className="size-5 text-muted" />
            <span className="flex-1 text-sm">Incluye la merma de cada ingrediente. Costo estimado: <span className="font-semibold">{Object.entries(totals).map(([c, n]) => formatMoney(n, c, region.locale)).join(" + ")}</span></span></Card>
          {bySupplier.map(([s, rows]) => (
            <Card key={s} className="no-break">
              <CardHeader title={s} />
              <ul className="divide-y divide-line">{rows.map((r) => (
                <li key={r.ingredient_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1"><span className="block font-medium">{r.name}</span><span className="block text-xs text-muted">{plural(r.orders, "pedido", "pedidos")}{r.category ? ` · ${r.category}` : ""}</span></span>
                  <span className="font-semibold tabular-nums">{qtyText(r)}</span>
                  <span className="w-28 text-right tabular-nums text-muted">{formatMoney(Number(r.est_cost), r.currency_code, region.locale)}</span>
                </li>))}
              </ul>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
