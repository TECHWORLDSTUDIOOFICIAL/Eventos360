import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Ban, CalendarCheck, CheckCircle2, ClipboardCheck, FileSignature, Lock, PackageCheck, Plus, Printer, RotateCcw,
  Search, Trash2, Truck, Undo2, Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { fromLocalInput, toLocalInput, useEvents } from "@/lib/events";
import { docNumber, useCustomers, usePayments, useQuotes, type Payment, type Quote, type QuoteItem } from "@/lib/pro";
import {
  RENTAL_STATUS, depositHeld, isOverdue, useAvailability, useInvalidateRental, useRentalItems, useRentals, useResources, type Rental, type RentalItem, type RentalStatus,
} from "@/lib/rental";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";
import { PaymentDialog } from "@/pages/pro/FinancePage";
import { DeliveryDialog, RentalStatusBadge, ReturnDialog, rentalRange } from "./rentalShared";

export default function RentalsPage() {
  const { itemId } = useParams();
  if (itemId === "nueva") return <NewRental />;
  return itemId ? <RentalEditor id={itemId} /> : <RentalList />;
}

const TABS: { key: string; label: string; statuses: RentalStatus[] | null }[] = [
  { key: "activas", label: "Activas", statuses: ["draft", "reserved", "out"] },
  { key: "cerradas", label: "Devueltas", statuses: ["returned"] },
  { key: "canceladas", label: "Canceladas", statuses: ["canceled"] },
  { key: "todas", label: "Todas", statuses: null },
];

function RentalList() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useRentals(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("activas");
  const cust = (id: string) => customers?.find((c) => c.id === id)?.name ?? "";
  const statuses = TABS.find((t) => t.key === tab)?.statuses;
  const list = useMemo(() => {
    const rows = (data ?? []).filter((r) => (!statuses || statuses.includes(r.status))
      && (!q || `${docNumber("RES", r.number)} ${r.title} ${cust(r.customer_id)}`.toLowerCase().includes(q.toLowerCase())));
    // Activas: por fecha de entrega; historial: lo más reciente primero.
    return tab === "activas" ? rows : [...rows].reverse();
  }, [data, q, tab, customers]); // eslint-disable-line react-hooks/exhaustive-deps
  const newUrl = workspacePath(ws.kind, ws.id, "m/reservations/nueva");

  return (
    <div className="animate-rise">
      <PageHeader title="Reservaciones" description="Órdenes de alquiler por fecha. Al apartarlas, el sistema bloquea las unidades y no permite reservar más de lo que tienes."
        actions={!readOnly && <Link to={newUrl}><Button variant="accent" icon={<Plus className="size-4" />}>Nueva reservación</Button></Link>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex gap-1 rounded-xl bg-ink/5 p-1 text-sm font-medium">
            {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={cx("rounded-lg px-3 py-1.5", tab === t.key ? "bg-card shadow-sm" : "text-muted")}>{t.label}</button>)}
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, título o cliente" className="h-10 pl-9" />
          </div>
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<CalendarCheck className="size-6" />} title="Aún no tienes reservaciones"
            action={!readOnly && <Link to={newUrl}><Button variant="accent">Crear la primera</Button></Link>}>
            Crea una reservación con el cliente, las fechas de entrega y devolución, y los artículos. También puedes convertir una cotización aceptada.
          </EmptyState>
        ) : !list.length ? <p className="px-5 py-10 text-center text-sm text-muted">No hay reservaciones en esta vista.</p> : (
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <li key={r.id}>
                <Link to={workspacePath(ws.kind, ws.id, `m/reservations/${r.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                  <span className="w-20 font-mono text-xs text-muted">{docNumber("RES", r.number)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="block truncate text-xs text-muted">{cust(r.customer_id)} · {rentalRange(r, region.timezone, region.locale)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatMoney(Number(r.total), r.currency_code, region.locale)}</span>
                  <RentalStatusBadge r={r} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Nueva
function NewRental() {
  const { ws, region } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invalidate = useInvalidateRental();
  const { data: customers, isLoading: loadingCustomers } = useCustomers(ws.id);
  const { data: events } = useEvents(ws.id);
  const quoteId = params.get("cotizacion");
  const fromQuote = useQuery({
    queryKey: ["quote-for-rental", quoteId], enabled: !!quoteId,
    queryFn: async () => ({
      q: unwrap<Quote>(await supabase.from("quotes").select("*").eq("id", quoteId!).single()),
      items: unwrap<(QuoteItem & { resource_id: string | null })[]>(await supabase.from("quote_items").select("*").eq("quote_id", quoteId!).order("sort").order("id")),
    }),
  });
  const [f, setF] = useState({
    customer_id: params.get("cliente") ?? "", event_id: params.get("evento") ?? "", title: "", starts: "", ends: "",
    delivery_mode: "delivery" as Rental["delivery_mode"], delivery_address: "", currency_code: region.currency_code,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    const q = fromQuote.data?.q;
    if (q) setF((s) => ({ ...s, customer_id: q.customer_id, event_id: q.event_id ?? "", title: q.title, currency_code: q.currency_code }));
  }, [fromQuote.data]);
  // Con un evento, propone entregar el día anterior y recoger el día siguiente.
  useEffect(() => {
    const ev = events?.find((e) => e.id === f.event_id);
    if (!ev?.starts_at) return;
    const start = new Date(ev.starts_at);
    const end = new Date(ev.ends_at ?? ev.starts_at);
    const dayBefore = toLocalInput(new Date(start.getTime() - 86_400_000).toISOString(), region.timezone).slice(0, 10);
    const dayAfter = toLocalInput(new Date(end.getTime() + 86_400_000).toISOString(), region.timezone).slice(0, 10);
    setF((s) => ({
      ...s, starts: s.starts || `${dayBefore}T14:00`, ends: s.ends || `${dayAfter}T10:00`,
      title: s.title || `Alquiler para ${ev.name}`, delivery_address: s.delivery_address || [ev.venue_name, ev.venue_address].filter(Boolean).join(", "),
    }));
  }, [f.event_id, events]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.customer_id) return setError("Elige el cliente.");
    if (f.title.trim().length < 2) return setError("Escribe un título.");
    const starts = fromLocalInput(f.starts, region.timezone);
    const ends = fromLocalInput(f.ends, region.timezone);
    if (!starts || !ends) return setError("Indica la fecha de entrega y la de devolución.");
    if (new Date(ends) <= new Date(starts)) return setError("La devolución debe ser después de la entrega.");
    setBusy(true);
    setError(null);
    const q = fromQuote.data?.q;
    const { data, error: err } = await supabase.from("rentals").insert({
      workspace_id: ws.id, customer_id: f.customer_id, event_id: f.event_id || null, quote_id: q?.id ?? null, title: f.title.trim(),
      starts_at: starts, ends_at: ends, delivery_mode: f.delivery_mode, delivery_address: f.delivery_address.trim() || null,
      currency_code: f.currency_code, tax_rate: q ? Number(q.tax_rate) : region.tax_rate, discount_amount: q ? Number(q.discount_amount) : 0,
      advance_pct: q ? Number(q.deposit_pct) : 50,
    }).select("id").single();
    if (err) { setBusy(false); return setError(err.message); }
    const id = (data as { id: string }).id;
    if (fromQuote.data?.items.length) {
      // Copia las líneas: artículos de inventario con su cantidad; servicios como líneas sin inventario.
      const rows = fromQuote.data.items.map((it, n) => {
        const qty = Number(it.quantity);
        const price = Number(it.unit_price) * (1 - Number(it.discount_pct) / 100);
        const whole = Number.isInteger(qty);
        return {
          workspace_id: ws.id, rental_id: id, resource_id: whole ? it.resource_id : null, sort: n + 1, description: it.description.slice(0, 300),
          quantity: whole ? qty : 1, unit_price: Math.round((whole ? price : Number(it.line_total)) * 100) / 100,
        };
      });
      const { error: e2 } = await supabase.from("rental_items").insert(rows);
      if (e2) setError(`La reservación se creó, pero no se copiaron las líneas: ${e2.message}`);
    }
    setBusy(false);
    await invalidate();
    navigate(workspacePath(ws.kind, ws.id, `m/reservations/${id}`), { replace: true });
  }

  const evs = (events ?? []).filter((e) => !f.customer_id || e.customer_id === f.customer_id);
  return (
    <div className="animate-rise mx-auto max-w-xl">
      <PageHeader title="Nueva reservación" description={fromQuote.data ? `A partir de la cotización ${docNumber("COT", fromQuote.data.q.number)}. Se copiarán sus ${fromQuote.data.items.length} líneas.` : "Después agregas los artículos y el sistema verifica la disponibilidad."} />
      <Card className="p-5">
        {loadingCustomers ? <Spinner /> : !customers?.length ? (
          <Alert tone="info">Primero registra un cliente en <Link to={workspacePath(ws.kind, ws.id, "m/customers")} className="font-semibold underline">Clientes</Link>.</Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Cliente">{(id) => <Select id={id} value={f.customer_id} onChange={(e) => setF((s) => ({ ...s, customer_id: e.target.value, event_id: "" }))}><option value="">Elegir…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            {evs.length > 0 && <Field label="Evento" optional>{(id) => <Select id={id} value={f.event_id} onChange={(e) => set("event_id", e.target.value)}><option value="">Sin evento</option>{evs.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}</Select>}</Field>}
            <Field label="Título">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej. Boda Castillo – mobiliario" />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Entrega" hint="Desde aquí se apartan las unidades.">{(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={f.starts} onChange={(e) => set("starts", e.target.value)} />}</Field>
              <Field label="Devolución / recolección" hint="Hasta aquí quedan ocupadas.">{(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={f.ends} onChange={(e) => set("ends", e.target.value)} />}</Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Modalidad">{(id) => <Select id={id} value={f.delivery_mode} onChange={(e) => set("delivery_mode", e.target.value)}><option value="delivery">Entregamos y recogemos</option><option value="pickup">El cliente retira y devuelve</option></Select>}</Field>
              <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option>NIO</option><option>USD</option></Select>}</Field>
            </div>
            {f.delivery_mode === "delivery" && <Field label="Dirección de entrega" optional>{(id) => <Input id={id} value={f.delivery_address} onChange={(e) => set("delivery_address", e.target.value)} />}</Field>}
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" variant="accent" className="w-full" loading={busy || (!!quoteId && fromQuote.isLoading)}>Crear y agregar artículos</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Editor
function RentalEditor({ id }: { id: string }) {
  const { ws, region, readOnly, modules } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateRental();
  const { data: customers } = useCustomers(ws.id);
  const { data: quotes } = useQuotes(ws.id);
  const rental = useQuery({ queryKey: ["rental", id], queryFn: async () => unwrap<Rental>(await supabase.from("rentals").select("*").eq("id", id).single()) });
  const items = useRentalItems(id);
  const hasFinance = modules.some((m) => m.module_key === "finance");
  const hasContracts = modules.some((m) => m.module_key === "contracts");
  const payments = usePayments(ws.id);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger" | "info"; text: string } | null>(null);
  const [dialog, setDialog] = useState<"deliver" | "return" | "pay" | null>(null);
  const [f, setF] = useState<Partial<Rental> & { starts?: string; ends?: string }>({});
  useEffect(() => {
    if (rental.data) setF({ ...rental.data, starts: toLocalInput(rental.data.starts_at, region.timezone), ends: toLocalInput(rental.data.ends_at, region.timezone) });
  }, [rental.data, region.timezone]);

  if (rental.isLoading) return <Spinner />;
  const r = rental.data;
  if (!r) return <Card><EmptyState title="Reservación no encontrada" /></Card>;
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const customer = customers?.find((c) => c.id === r.customer_id);
  const quote = quotes?.find((q) => q.id === r.quote_id);
  const money = (n: number) => formatMoney(n, r.currency_code, region.locale);
  const editable = !readOnly && (r.status === "draft" || r.status === "reserved");
  const myPayments = (payments.data ?? []).filter((p: Payment) => p.rental_id === r.id);
  const paid = myPayments.filter((p) => p.currency_code === r.currency_code).reduce((s, p) => s + Number(p.amount), 0);
  const charges = Number(r.total) + Number(r.damage_total);
  const balance = charges - paid - Number(r.deposit_retained);
  const advance = Math.round(Number(r.total) * Number(r.advance_pct)) / 100;

  async function save(patch: Partial<Rental>) {
    const { error } = await supabase.from("rentals").update(patch).eq("id", id);
    if (error) { setMsg({ tone: "danger", text: error.message }); await invalidate(); return false; }
    await invalidate();
    return true;
  }
  async function saveHeader() {
    const starts = f.starts ? fromLocalInput(f.starts, region.timezone) : null;
    const ends = f.ends ? fromLocalInput(f.ends, region.timezone) : null;
    if (!starts || !ends) return setMsg({ tone: "danger", text: "Indica las fechas de entrega y devolución." });
    if (new Date(ends) <= new Date(starts)) return setMsg({ tone: "danger", text: "La devolución debe ser después de la entrega." });
    const patch: Partial<Rental> = {
      title: f.title?.trim() || r!.title, delivery_mode: f.delivery_mode, delivery_address: f.delivery_address?.trim() || null,
      delivery_contact: f.delivery_contact?.trim() || null, delivery_phone: f.delivery_phone?.trim() || null, notes: f.notes?.trim() || null,
      discount_amount: Number(f.discount_amount) || 0, tax_rate: Number(f.tax_rate) || 0, advance_pct: Number(f.advance_pct) || 0,
    };
    if (r!.status !== "returned") patch.ends_at = ends;
    if (r!.status === "draft" || r!.status === "reserved" || r!.status === "canceled") { patch.starts_at = starts; patch.currency_code = f.currency_code; }
    await save(patch);
  }
  async function setStatus(status: RentalStatus, question?: string) {
    if (question && !confirm(question)) return;
    if (status === "reserved" && !(items.data ?? []).some((i) => i.resource_id)) {
      return setMsg({ tone: "danger", text: "Agrega al menos un artículo del inventario antes de apartar." });
    }
    if (await save({ status })) {
      setMsg(status === "reserved" ? { tone: "ok", text: "Inventario apartado: estas unidades ya no se pueden reservar para otras órdenes en esas fechas." } : null);
    }
  }
  async function remove() {
    if (!confirm(`¿Eliminar ${docNumber("RES", r!.number)}?`)) return;
    const { error } = await supabase.from("rentals").delete().eq("id", id);
    if (error) return setMsg({ tone: "danger", text: error.message });
    await invalidate();
    navigate(base("m/reservations"));
  }
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="animate-rise">
      <Link to={base("m/reservations")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Reservaciones</Link>
      <PageHeader eyebrow={<span className="inline-flex items-center gap-2">{docNumber("RES", r.number)} <RentalStatusBadge r={r} /></span>}
        title={r.title}
        description={<>{customer ? <Link to={base(`m/customers/${customer.id}`)} className="hover:underline">{customer.name}</Link> : null}{quote && <> · <Link to={base(`m/quotes/${quote.id}`)} className="hover:underline">{docNumber("COT", quote.number)}</Link></>}</>}
        actions={<>
          <Link to={base(`imprimir/alquiler?id=${id}`)}><Button variant="secondary" icon={<Printer className="size-4" />}>Orden</Button></Link>
          {r.status !== "draft" && r.status !== "canceled" && <Link to={base(`imprimir/alquiler?id=${id}&tipo=entrega`)}><Button variant="secondary" icon={<ClipboardCheck className="size-4" />}>Hoja de entrega</Button></Link>}
          {!readOnly && r.status === "draft" && <Button variant="accent" icon={<Lock className="size-4" />} onClick={() => void setStatus("reserved")}>Apartar inventario</Button>}
          {!readOnly && r.status === "reserved" && <Button variant="accent" icon={<Truck className="size-4" />} onClick={() => setDialog("deliver")}>Registrar entrega</Button>}
          {!readOnly && r.status === "out" && <Button variant="accent" icon={<RotateCcw className="size-4" />} onClick={() => setDialog("return")}>Registrar devolución</Button>}
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert></div>}
      {isOverdue(r) && <div className="mb-4"><Alert tone="danger" title="Devolución atrasada">Debía volver el {formatDate(r.ends_at, { timeZone: region.timezone, withTime: true })}. Mientras no se registre la devolución, estas unidades siguen bloqueadas para cualquier fecha.</Alert></div>}
      {r.status === "out" && !isOverdue(r) && <div className="mb-4"><Alert tone="info" title="Entregada">Entregada el {formatDate(r.out_at, { timeZone: region.timezone, withTime: true })}{r.out_received_by ? ` · recibió ${r.out_received_by}` : ""}. Devolución prevista: {formatDate(r.ends_at, { timeZone: region.timezone, withTime: true })}.</Alert></div>}
      {r.status === "returned" && <div className="mb-4"><Alert tone="ok" title="Devuelta y revisada">Recibida el {formatDate(r.returned_at, { timeZone: region.timezone, withTime: true })}.{Number(r.damage_total) > 0 ? ` Cargos por daños o faltantes: ${money(Number(r.damage_total))}.` : " Sin daños."}{r.return_notes ? ` ${r.return_notes}` : ""}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <ItemsCard rental={r} items={items.data ?? []} editable={editable} money={money} onError={(t) => setMsg({ tone: "danger", text: t })} />
          <Card>
            <CardHeader title="Entrega y devolución" description={RENTAL_STATUS[r.status].hint} />
            <fieldset disabled={readOnly || r.status === "returned"} className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Entrega">{(i) => <Input id={i} type="datetime-local" value={f.starts ?? ""} disabled={r.status === "out"} onChange={(e) => set("starts", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <Field label="Devolución">{(i) => <Input id={i} type="datetime-local" value={f.ends ?? ""} onChange={(e) => set("ends", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <Field label="Modalidad">{(i) => <Select id={i} value={f.delivery_mode ?? "delivery"} onChange={(e) => { set("delivery_mode", e.target.value); void save({ delivery_mode: e.target.value as Rental["delivery_mode"] }); }}><option value="delivery">Entregamos y recogemos</option><option value="pickup">El cliente retira y devuelve</option></Select>}</Field>
              <Field label="Título">{(i) => <Input id={i} value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              {f.delivery_mode !== "pickup" && <div className="sm:col-span-2"><Field label="Dirección de entrega" optional>{(i) => <Input id={i} value={f.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} onBlur={() => void saveHeader()} />}</Field></div>}
              <Field label="Contacto en el lugar" optional>{(i) => <Input id={i} value={f.delivery_contact ?? ""} onChange={(e) => set("delivery_contact", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <Field label="Teléfono del contacto" optional>{(i) => <Input id={i} type="tel" value={f.delivery_phone ?? ""} onChange={(e) => set("delivery_phone", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <div className="sm:col-span-2"><Field label="Notas" optional hint="Aparecen en la orden y en la hoja de entrega.">{(i, d) => <Textarea id={i} aria-describedby={d} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} onBlur={() => void saveHeader()} />}</Field></div>
            </fieldset>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{money(Number(r.subtotal))}</dd></div>
              {Number(r.discount_amount) > 0 && <div className="flex justify-between"><dt className="text-muted">Descuento</dt><dd className="tabular-nums">−{money(Math.min(Number(r.discount_amount), Number(r.subtotal)))}</dd></div>}
              {Number(r.tax_rate) > 0 && <div className="flex justify-between"><dt className="text-muted">IVA ({Number(r.tax_rate)}%)</dt><dd className="tabular-nums">{money(Number(r.tax_amount))}</dd></div>}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="font-display text-2xl tabular-nums">{money(Number(r.total))}</dd></div>
              {Number(r.advance_pct) > 0 && r.status !== "returned" && <div className="flex justify-between text-[var(--accent)]"><dt>Anticipo ({Number(r.advance_pct)}%)</dt><dd className="font-semibold tabular-nums">{money(advance)}</dd></div>}
              {Number(r.damage_total) > 0 && <div className="flex justify-between text-danger"><dt>Daños y faltantes</dt><dd className="tabular-nums">+{money(Number(r.damage_total))}</dd></div>}
              {hasFinance && <>
                <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Pagado</dt><dd className="tabular-nums">{money(paid)}</dd></div>
                {Number(r.deposit_retained) > 0 && <div className="flex justify-between"><dt className="text-muted">Cubierto con depósito</dt><dd className="tabular-nums">{money(Number(r.deposit_retained))}</dd></div>}
                <div className={cx("flex justify-between font-semibold", balance > 0.004 ? "text-warn" : "text-ok")}><dt>{balance > 0.004 ? "Saldo pendiente" : "Pagado por completo"}</dt><dd className="tabular-nums">{money(Math.max(0, balance))}</dd></div>
              </>}
            </dl>
            {hasFinance && !readOnly && r.status !== "canceled" && (
              <Button variant="secondary" className="mt-4 w-full" icon={<Wallet className="size-4" />} onClick={() => setDialog("pay")}>Registrar pago</Button>
            )}
            {hasFinance && myPayments.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
                {myPayments.map((p) => <li key={p.id} className="flex justify-between"><span>{formatDate(`${p.paid_at}T12:00:00Z`, { timeZone: "UTC" })}</span><span className="tabular-nums">{formatMoney(Number(p.amount), p.currency_code, region.locale)}</span></li>)}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Precios" />
            <fieldset disabled={!editable} className="grid grid-cols-2 gap-3 p-4">
              <Field label="Descuento">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.discount_amount ?? 0} onChange={(e) => set("discount_amount", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <Field label="IVA %">{(i) => <Input id={i} type="number" min={0} max={100} step="0.01" value={f.tax_rate ?? 0} onChange={(e) => set("tax_rate", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <Field label="Anticipo %">{(i) => <Input id={i} type="number" min={0} max={100} value={f.advance_pct ?? 0} onChange={(e) => set("advance_pct", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <Field label="Moneda">{(i) => <Select id={i} value={f.currency_code ?? "NIO"} disabled={r.status !== "draft" && r.status !== "reserved"} onChange={(e) => { set("currency_code", e.target.value); void save({ currency_code: e.target.value }); }}><option>NIO</option><option>USD</option></Select>}</Field>
            </fieldset>
          </Card>
          <DepositCard rental={r} money={money} readOnly={readOnly} onSave={save} />
          {!readOnly && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              {hasContracts && r.status !== "canceled" && <Link to={base(`m/contracts/nuevo?reserva=${id}`)} className="inline-flex items-center gap-1 text-muted hover:text-ink"><FileSignature className="size-3.5" />Crear contrato</Link>}
              {r.status === "reserved" && <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => void setStatus("draft", "¿Volver a borrador? Las unidades dejarán de estar apartadas.")}><Undo2 className="size-3.5" />Volver a borrador</button>}
              {r.status === "out" && <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => void setStatus("reserved", "¿Deshacer la entrega? Úsalo solo si se registró por error.")}><Undo2 className="size-3.5" />Deshacer entrega</button>}
              {(r.status === "draft" || r.status === "reserved") && <button className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => void setStatus("canceled", "¿Cancelar la reservación? Se liberan las unidades.")}><Ban className="size-3.5" />Cancelar</button>}
              {r.status === "canceled" && <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => void setStatus("draft")}><Undo2 className="size-3.5" />Reabrir como borrador</button>}
              {(r.status === "draft" || r.status === "canceled") && <button className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => void remove()}><Trash2 className="size-3.5" />Eliminar</button>}
            </div>
          )}
        </div>
      </div>

      {dialog === "deliver" && <DeliveryDialog rental={r} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setMsg({ tone: "ok", text: "Entrega registrada." }); }} />}
      {dialog === "return" && <ReturnDialog rental={r} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setMsg({ tone: "ok", text: "Devolución registrada. Lo dañado o faltante pasó a Daños y mantenimiento." }); }} />}
      {dialog === "pay" && <PaymentDialog defaults={{ customer_id: r.customer_id, event_id: r.event_id, quote_id: r.quote_id, rental_id: r.id, currency_code: r.currency_code, amount: Math.max(0, Math.round((paid > 0 ? balance : advance || balance) * 100) / 100) || undefined, kind: paid > 0 ? "final" : "deposit" }}
        onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void qc.invalidateQueries({ queryKey: ["payments", ws.id] }); setMsg({ tone: "ok", text: "Pago registrado." }); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ Artículos
function ItemsCard({ rental: r, items, editable, money, onError }: {
  rental: Rental; items: RentalItem[]; editable: boolean; money: (n: number) => string; onError: (t: string) => void;
}) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateRental();
  const { data: resources } = useResources(ws.id);
  const { data: avail } = useAvailability(ws.id, r.starts_at, r.ends_at, r.id);
  const [add, setAdd] = useState({ resource_id: "", quantity: "1" });
  const [service, setService] = useState({ description: "", price: "" });
  const [busy, setBusy] = useState(false);
  const res = (rid: string | null) => resources?.find((x) => x.id === rid);
  const free = (rid: string) => avail?.find((a) => a.resource_id === rid)?.available;
  const usedHere = (rid: string, except?: string) => items.filter((i) => i.resource_id === rid && i.id !== except).reduce((s, i) => s + i.quantity, 0);
  const shortage = items.filter((i) => i.resource_id).map((i) => ({ i, f: free(i.resource_id!) })).filter(({ i, f }) => f !== undefined && usedHere(i.resource_id!) > f);
  const sel = add.resource_id ? res(add.resource_id) : null;
  const selFree = sel ? (free(sel.id) ?? 0) - usedHere(sel.id) : null;
  const holds = r.status === "reserved" || r.status === "out";

  async function nextSort() {
    return (items.reduce((m, i) => Math.max(m, i.sort), 0) || 0) + 1;
  }
  async function addResource(e: FormEvent) {
    e.preventDefault();
    const qty = Number(add.quantity);
    if (!sel || !Number.isInteger(qty) || qty < 1) return;
    setBusy(true);
    const existing = items.find((i) => i.resource_id === sel.id);
    const resp = existing
      ? await supabase.from("rental_items").update({ quantity: existing.quantity + qty }).eq("id", existing.id)
      : await supabase.from("rental_items").insert({ workspace_id: ws.id, rental_id: r.id, resource_id: sel.id, description: sel.name, quantity: qty, unit_price: Number(sel.rent_price), sort: await nextSort() });
    setBusy(false);
    if (resp.error) onError(resp.error.message);
    else setAdd({ resource_id: "", quantity: "1" });
    await invalidate();
  }
  async function addService(e: FormEvent) {
    e.preventDefault();
    if (!service.description.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("rental_items").insert({ workspace_id: ws.id, rental_id: r.id, resource_id: null, description: service.description.trim(), quantity: 1, unit_price: Number(service.price) || 0, sort: await nextSort() });
    setBusy(false);
    if (error) onError(error.message);
    else setService({ description: "", price: "" });
    await invalidate();
  }
  async function update(it: RentalItem, patch: Partial<RentalItem>) {
    const { error } = await supabase.from("rental_items").update(patch).eq("id", it.id);
    if (error) onError(error.message);
    await invalidate();
  }
  async function remove(it: RentalItem) {
    const { error } = await supabase.from("rental_items").delete().eq("id", it.id);
    if (error) onError(error.message);
    await invalidate();
  }

  return (
    <Card>
      <CardHeader title="Artículos y servicios" description={holds ? "Estas unidades están bloqueadas para estas fechas." : r.status === "draft" ? "En borrador no se aparta nada todavía: la disponibilidad se confirma al apartar." : r.status === "returned" ? "Resultado de la revisión al recibir los artículos." : undefined} />
      {shortage.length > 0 && r.status === "draft" && (
        <div className="px-4 pt-4"><Alert tone="warn" title="No alcanza para estas fechas">{shortage.map(({ i, f }) => `${i.description}: pides ${usedHere(i.resource_id!)}, hay ${Math.max(0, f ?? 0)} libres`).join(" · ")}. Ajusta las cantidades o las fechas antes de apartar.</Alert></div>
      )}
      {!items.length ? <p className="px-5 py-6 text-sm text-muted">Sin artículos todavía.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr><th className="px-4 py-2 font-medium">Artículo</th><th className="px-2 py-2 text-right font-medium">Cant.</th><th className="px-2 py-2 text-right font-medium">Precio</th><th className="px-2 py-2 text-right font-medium">Total</th>{(r.status === "returned") && <th className="px-2 py-2 text-right font-medium">Revisión</th>}<th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((it) => {
                const resource = res(it.resource_id);
                const f = it.resource_id ? free(it.resource_id) : undefined;
                const live = r.status === "draft" || r.status === "reserved";   // la disponibilidad solo importa antes de entregar
                const over = live && f !== undefined && it.resource_id ? usedHere(it.resource_id) > f : false;
                return (
                  <tr key={it.id} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{it.description}</div>
                      <div className={cx("text-xs", over ? "font-semibold text-danger" : "text-muted")}>
                        {it.resource_id ? (!live ? (resource?.category ?? "Artículo de inventario") : f === undefined ? "Calculando…" : `${Math.max(0, f)} libres en estas fechas${resource ? ` de ${resource.total_qty}` : ""}`) : "Servicio (no usa inventario)"}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {editable ? <Input type="number" min={1} step={1} defaultValue={it.quantity} key={`q${it.quantity}`} className="ml-auto h-8 w-20 text-right" aria-label={`Cantidad de ${it.description}`}
                        onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== it.quantity) void update(it, { quantity: n }); }} /> : <span className="tabular-nums">{it.quantity}</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {editable ? <Input type="number" min={0} step="0.01" defaultValue={it.unit_price} key={`p${it.unit_price}`} className="ml-auto h-8 w-24 text-right" aria-label={`Precio de ${it.description}`}
                        onBlur={(e) => { const n = Number(e.target.value); if (n >= 0 && n !== Number(it.unit_price)) void update(it, { unit_price: n }); }} /> : <span className="tabular-nums">{money(Number(it.unit_price))}</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{money(Number(it.line_total))}</td>
                    {r.status === "returned" && <td className="px-2 py-2.5 text-right text-xs">{it.resource_id ? <>
                      <div className="text-ok">{it.returned_ok ?? 0} bien</div>
                      {it.damaged_qty > 0 && <div className="text-warn">{it.damaged_qty} dañados</div>}
                      {it.lost_qty > 0 && <div className="text-danger">{it.lost_qty} faltantes</div>}
                      {Number(it.damage_charge) > 0 && <div>Cargo {money(Number(it.damage_charge))}</div>}
                    </> : "—"}</td>}
                    <td className="px-2 py-2.5">{editable && <button onClick={() => void remove(it)} className="rounded-lg p-1.5 text-muted hover:text-danger" aria-label={`Quitar ${it.description}`}><Trash2 className="size-4" /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="space-y-3 border-t border-line bg-paper/50 p-4">
          <form onSubmit={addResource} className="grid gap-2 sm:grid-cols-[1fr_90px_auto]">
            <Select value={add.resource_id} onChange={(e) => setAdd((s) => ({ ...s, resource_id: e.target.value }))} aria-label="Artículo del inventario">
              <option value="">Agregar del inventario…</option>
              {(resources ?? []).map((x) => {
                const fr = free(x.id);
                return <option key={x.id} value={x.id}>{x.name}{fr !== undefined ? ` — ${Math.max(0, fr - usedHere(x.id))} libres` : ""} · {formatMoney(Number(x.rent_price), x.currency_code, region.locale)}</option>;
              })}
            </Select>
            <Input type="number" min={1} step={1} value={add.quantity} onChange={(e) => setAdd((s) => ({ ...s, quantity: e.target.value }))} aria-label="Cantidad" className="text-right" />
            <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} loading={busy} disabled={!sel}>Agregar</Button>
            {sel && selFree !== null && Number(add.quantity) > selFree && <p className="text-xs font-medium text-danger sm:col-span-3"><AlertTriangle className="mr-1 inline size-3.5" />Solo hay {Math.max(0, selFree)} libres en estas fechas.</p>}
            {sel && sel.currency_code !== r.currency_code && <p className="text-xs text-warn sm:col-span-3">El precio de este artículo está en {sel.currency_code}; la reservación es en {r.currency_code}. Ajusta el precio después de agregarlo.</p>}
          </form>
          <form onSubmit={addService} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
            <Input value={service.description} onChange={(e) => setService((s) => ({ ...s, description: e.target.value }))} placeholder="Servicio: transporte, montaje, limpieza…" aria-label="Servicio" />
            <Input type="number" min={0} step="0.01" value={service.price} onChange={(e) => setService((s) => ({ ...s, price: e.target.value }))} placeholder="Precio" aria-label="Precio del servicio" className="text-right" />
            <Button type="submit" variant="ghost" icon={<Plus className="size-4" />} disabled={!service.description.trim()}>Servicio</Button>
          </form>
          {!resources?.length && <p className="text-xs text-muted">Tu inventario está vacío. Agrégalo en el módulo Inventario.</p>}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ Depósito
function DepositCard({ rental: r, money, readOnly, onSave }: { rental: Rental; money: (n: number) => string; readOnly: boolean; onSave: (p: Partial<Rental>) => Promise<boolean> }) {
  const [f, setF] = useState({ amount: "", received: "", refunded: "", retained: "", notes: "" });
  useEffect(() => setF({ amount: String(r.deposit_amount), received: String(r.deposit_received), refunded: String(r.deposit_refunded), retained: String(r.deposit_retained), notes: r.deposit_notes ?? "" }),
    [r.deposit_amount, r.deposit_received, r.deposit_refunded, r.deposit_retained, r.deposit_notes]);
  const held = depositHeld(r);
  const commit = () => void onSave({ deposit_amount: Number(f.amount) || 0, deposit_received: Number(f.received) || 0, deposit_refunded: Number(f.refunded) || 0, deposit_retained: Number(f.retained) || 0, deposit_notes: f.notes.trim() || null });
  const settle = (retain: number) => void onSave({ deposit_retained: retain, deposit_refunded: Math.max(0, Number(r.deposit_received) - retain) });
  return (
    <Card>
      <CardHeader title="Depósito de garantía" description="Se devuelve al recibir los artículos en buen estado." />
      <fieldset disabled={readOnly || r.status === "canceled"} className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Solicitado">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} onBlur={commit} />}</Field>
          <Field label="Recibido">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.received} onChange={(e) => setF((s) => ({ ...s, received: e.target.value }))} onBlur={commit} />}</Field>
          {(r.status === "returned" || Number(r.deposit_refunded) > 0 || Number(r.deposit_retained) > 0) && <>
            <Field label="Devuelto">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.refunded} onChange={(e) => setF((s) => ({ ...s, refunded: e.target.value }))} onBlur={commit} />}</Field>
            <Field label="Retenido">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.retained} onChange={(e) => setF((s) => ({ ...s, retained: e.target.value }))} onBlur={commit} />}</Field>
          </>}
        </div>
        <Field label="Notas" optional>{(i) => <Input id={i} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} onBlur={commit} placeholder="Ej. efectivo, cheque, transferencia" />}</Field>
        <div className="flex justify-between rounded-xl bg-paper px-3 py-2 text-sm"><span className="text-muted">En tu poder</span><span className="font-semibold tabular-nums">{money(held)}</span></div>
        {r.status === "returned" && held > 0.004 && (
          <div className="space-y-2">
            {Number(r.damage_total) > 0 && <Button size="sm" variant="secondary" className="w-full" icon={<PackageCheck className="size-4" />} onClick={() => settle(Math.min(Number(r.deposit_received), Number(r.damage_total)))}>Cobrar daños del depósito ({money(Math.min(Number(r.deposit_received), Number(r.damage_total)))}) y devolver el resto</Button>}
            <Button size="sm" variant="accent" className="w-full" icon={<CheckCircle2 className="size-4" />} onClick={() => settle(Number(r.deposit_retained))}>Devolver {money(held)} al cliente</Button>
          </div>
        )}
      </fieldset>
    </Card>
  );
}

