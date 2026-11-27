import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Ban, CalendarCheck, CalendarClock, CheckCircle2, ClipboardList, FileSignature, Lock, MessageCircle, Plus, Printer,
  Search, Trash2, Undo2, Users, Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { fromLocalInput, toLocalInput } from "@/lib/events";
import { useCustomers, usePayments, waNumber, type Payment } from "@/lib/pro";
import {
  BOOKING_STATUS, SETUPS, SOURCES, capacityFor, docBooking, minutesText, scheduleText, useBookingItems, useBookings, useConflicts,
  useInvalidateVenues, usePriceSuggestion, useVenues, type Booking, type BookingItem, type BookingStatus, type Conflict, type SetupKey,
} from "@/lib/venues";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";
import { PaymentDialog } from "@/pages/pro/FinancePage";

export default function BookingsPage() {
  const { itemId } = useParams();
  if (itemId === "nueva") return <NewBooking />;
  return itemId ? <BookingEditor id={itemId} /> : <BookingList />;
}

export function BookingBadge({ b }: { b: Pick<Booking, "status" | "kind" | "hold_until"> }) {
  if (b.kind === "block" && b.status !== "canceled") return <Badge tone="neutral">Bloqueo</Badge>;
  return <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>;
}

const TABS = [
  { key: "proximas", label: "Próximas" }, { key: "consultas", label: "Consultas" }, { key: "pasadas", label: "Pasadas" }, { key: "canceladas", label: "Canceladas" },
] as const;

function BookingList() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useBookings(ws.id);
  const { data: venues } = useVenues(ws.id, { includeInactive: true });
  const { data: customers } = useCustomers(ws.id);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>((params.get("ver") as never) ?? "proximas");
  const [q, setQ] = useState("");
  const now = Date.now();
  const cust = (id: string | null) => customers?.find((c) => c.id === id)?.name ?? "";
  const venue = (id: string) => venues?.find((v) => v.id === id);
  const list = useMemo(() => {
    const rows = (data ?? []).filter((b) => {
      const past = new Date(b.ends_at).getTime() < now;
      if (tab === "proximas") return !past && (b.status === "hold" || b.status === "confirmed");
      if (tab === "consultas") return !past && b.status === "inquiry";
      if (tab === "pasadas") return past && b.status !== "canceled";
      return b.status === "canceled";
    }).filter((b) => !q || `${docBooking(b.number)} ${b.title} ${cust(b.customer_id)} ${venue(b.venue_id)?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    return tab === "pasadas" || tab === "canceladas" ? [...rows].reverse() : rows;
  }, [data, tab, q, customers, venues]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (k: string) => (data ?? []).filter((b) => k === "consultas" ? b.status === "inquiry" && new Date(b.ends_at).getTime() >= now : false).length;
  const newUrl = workspacePath(ws.kind, ws.id, "m/bookings/nueva");

  return (
    <div className="animate-rise">
      <PageHeader title="Reservas" description="Consultas, apartados provisionales y reservas confirmadas de tus espacios. El sistema no permite dos reservas en el mismo espacio y horario."
        actions={!readOnly && <Link to={newUrl}><Button variant="accent" icon={<Plus className="size-4" />}>Nueva reserva</Button></Link>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-ink/5 p-1 text-sm font-medium">
            {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={cx("whitespace-nowrap rounded-lg px-3 py-1.5", tab === t.key ? "bg-card shadow-sm" : "text-muted")}>
              {t.label}{t.key === "consultas" && count("consultas") > 0 && <span className="ml-1.5 rounded-full bg-warn px-1.5 text-[11px] text-white">{count("consultas")}</span>}
            </button>)}
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, cliente o espacio" className="h-10 pl-9" />
          </div>
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<CalendarCheck className="size-6" />} title="Aún no tienes reservas"
            action={!readOnly && <Link to={newUrl}><Button variant="accent">Crear la primera</Button></Link>}>
            Registra cada consulta aunque el cliente no haya decidido: así no pierdes a nadie. Cuando pague el anticipo, apártala o confírmala.
          </EmptyState>
        ) : !list.length ? <p className="px-5 py-10 text-center text-sm text-muted">No hay reservas en esta vista.</p> : (
          <ul className="divide-y divide-line">
            {list.map((b) => {
              const v = venue(b.venue_id);
              return (
                <li key={b.id}>
                  <Link to={workspacePath(ws.kind, ws.id, `m/bookings/${b.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                    <span className="w-1 self-stretch rounded-full" style={{ background: v?.color ?? "#ccc" }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{b.title}</span>
                      <span className="block truncate text-xs text-muted">{v?.name} · {scheduleText(b.starts_at, b.ends_at, region.timezone, region.locale)}{b.customer_id ? ` · ${cust(b.customer_id)}` : ""}{b.guests ? ` · ${b.guests} personas` : ""}</span>
                      {b.status === "hold" && b.hold_until && <span className="block text-xs font-medium text-warn">Apartado hasta {formatDate(b.hold_until, { timeZone: region.timezone, withTime: true })}</span>}
                      {b.status === "inquiry" && b.source === "web" && <span className="block text-xs font-medium text-[var(--accent)]">Llegó desde tu página de consultas</span>}
                    </span>
                    {b.kind === "event" && Number(b.total) > 0 && <span className="font-semibold tabular-nums">{formatMoney(Number(b.total), b.currency_code, region.locale)}</span>}
                    <BookingBadge b={b} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Disponibilidad en vivo
function ConflictBox({ conflicts, loading, tz, locale }: { conflicts: Conflict[] | undefined; loading: boolean; tz: string; locale: string }) {
  const { ws } = useWorkspace();
  if (loading) return <div className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-muted">Revisando disponibilidad…</div>;
  if (!conflicts) return null;
  if (!conflicts.length) return <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 text-sm font-semibold text-ok"><CheckCircle2 className="size-4" />Libre: el espacio está disponible (incluido el tiempo de montaje y desmontaje).</div>;
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />Ocupado en ese horario</div>
      <ul className="mt-1 space-y-0.5">
        {conflicts.map((c) => (
          <li key={c.id}><Link className="underline" to={workspacePath(ws.kind, ws.id, `m/bookings/${c.id}`)}>{docBooking(c.number)}</Link> · {c.kind === "block" ? "Bloqueo" : BOOKING_STATUS[c.status].label}{c.status === "hold" && c.hold_until ? ` hasta ${formatDate(c.hold_until, { timeZone: tz, locale })}` : ""} · {c.venue_name} · {scheduleText(c.starts_at, c.ends_at, tz, locale)}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs">Puedes guardarla como <b>consulta</b> (lista de espera): si se libera la fecha, la confirmas.</p>
    </div>
  );
}

/** Horas del formulario → rango ISO; si la hora final es menor, termina al día siguiente. */
function useRange(date: string, from: string, to: string, tz: string) {
  const start = date && from ? fromLocalInput(`${date}T${from}`, tz) : null;
  let end = date && to ? fromLocalInput(`${date}T${to}`, tz) : null;
  if (start && end && new Date(end) <= new Date(start)) end = new Date(new Date(end).getTime() + 86_400_000).toISOString();
  return { start, end };
}

// ------------------------------------------------------------------ Nueva
function NewBooking() {
  const { ws, region } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invalidate = useInvalidateVenues();
  const { data: venues, isLoading } = useVenues(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const defDate = params.get("fecha") ?? toLocalInput(new Date(Date.now() + 14 * 86_400_000).toISOString(), region.timezone).slice(0, 10);
  const [f, setF] = useState({
    kind: params.get("tipo") === "bloqueo" ? "block" : "event", venue_id: params.get("espacio") ?? "", date: defDate, from: "18:00", to: "23:00",
    setup: "banquet" as SetupKey, guests: "", customer_id: params.get("cliente") ?? "", new_name: "", new_phone: "", title: "", source: "",
    status: "inquiry" as BookingStatus, hold_days: "7", use_rate: true, notes: "",
  });
  useEffect(() => { if (!f.venue_id && venues?.length) setF((s) => ({ ...s, venue_id: venues[0]!.id })); }, [venues]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const v = venues?.find((x) => x.id === f.venue_id);
  const { start, end } = useRange(f.date, f.from, f.to, region.timezone);
  // El espacio debe estar libre también durante el montaje y desmontaje de esta reserva.
  const occFrom = start && v ? new Date(new Date(start).getTime() - v.setup_minutes * 60_000).toISOString() : start;
  const occTo = end && v ? new Date(new Date(end).getTime() + v.teardown_minutes * 60_000).toISOString() : end;
  const conflicts = useConflicts(ws.id, f.venue_id, occFrom, occTo);
  const price = usePriceSuggestion(ws.id, f.venue_id, start, end);
  const taken = !!conflicts.data?.length;
  const cap = capacityFor(v, f.setup);
  const overCap = cap != null && Number(f.guests) > cap;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isBlock = f.kind === "block";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v) return setError("Elige el espacio.");
    if (!start || !end) return setError("Indica la fecha y el horario.");
    if (!isBlock && !f.customer_id && f.new_name.trim().length < 2) return setError("Elige el cliente o escribe el nombre del cliente nuevo.");
    if (!isBlock && taken && f.status !== "inquiry") return setError("El espacio está ocupado: guárdala como consulta o cambia la fecha.");
    setBusy(true); setError(null);
    try {
      let customerId = f.customer_id;
      if (!isBlock && !customerId) {
        const { data, error: e1 } = await supabase.from("customers").insert({ workspace_id: ws.id, name: f.new_name.trim(), phone: f.new_phone.trim() || null, status: "lead" }).select("id").single();
        if (e1) throw new Error(e1.message);
        customerId = (data as { id: string }).id;
      }
      const custName = customers?.find((c) => c.id === customerId)?.name ?? f.new_name.trim();
      const p = price.data;
      const { data, error: e2 } = await supabase.from("bookings").insert({
        workspace_id: ws.id, kind: f.kind, venue_id: v.id, customer_id: isBlock ? null : customerId,
        title: f.title.trim() || (isBlock ? "Bloqueo" : `Evento de ${custName}`), setup: isBlock ? "other" : f.setup, guests: f.guests ? Number(f.guests) : null,
        starts_at: start, ends_at: end, setup_minutes: isBlock ? 0 : v.setup_minutes, teardown_minutes: isBlock ? 0 : v.teardown_minutes,
        status: isBlock ? "confirmed" : f.status, hold_until: f.status === "hold" ? new Date(Date.now() + Number(f.hold_days || 7) * 86_400_000).toISOString() : null,
        rate_id: !isBlock && f.use_rate && p ? p.rate_id : null, source: f.source || null, currency_code: !isBlock && f.use_rate && p ? p.currency_code : region.currency_code,
        tax_rate: isBlock ? 0 : region.tax_rate, deposit_amount: !isBlock && f.use_rate && p ? Number(p.deposit_amount) : 0, notes: f.notes.trim() || null,
      }).select("id").single();
      if (e2) throw new Error(e2.message);
      const id = (data as { id: string }).id;
      if (!isBlock && f.use_rate && p) {
        const lines = [{ workspace_id: ws.id, booking_id: id, sort: 1, description: `Alquiler de ${v.name} (${Number(p.base_hours)} h · tarifa ${p.rate_name})`, quantity: 1, unit_price: Number(p.base_price) }];
        if (p.extra_hours > 0) lines.push({ workspace_id: ws.id, booking_id: id, sort: 2, description: "Hora adicional", quantity: p.extra_hours, unit_price: Number(p.extra_hour_price) });
        await supabase.from("booking_items").insert(lines);
      }
      await invalidate();
      navigate(workspacePath(ws.kind, ws.id, `m/bookings/${id}`), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (isLoading) return <Spinner />;
  if (!venues?.length) return <Card><EmptyState title="Primero registra tus espacios" action={<Link to={workspacePath(ws.kind, ws.id, "m/venues")}><Button variant="accent">Ir a Espacios</Button></Link>}>Las reservas se hacen sobre un espacio (salón, jardín…).</EmptyState></Card>;

  return (
    <div className="animate-rise mx-auto max-w-2xl">
      <PageHeader title={isBlock ? "Bloquear fechas" : "Nueva reserva"} description={isBlock ? "Para mantenimiento, remodelación o uso propio: nadie podrá reservar ese espacio en ese horario." : "Elige espacio, fecha y horario: verás al instante si está libre y cuánto cobrar."} />
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {[["event", "Evento de un cliente"], ["block", "Bloqueo interno"]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => set("kind", k!)} className={cx("rounded-xl border px-3 py-2.5 text-sm font-semibold", f.kind === k ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-line")}>{l}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Espacio">{(id) => <Select id={id} value={f.venue_id} onChange={(e) => set("venue_id", e.target.value)}>{venues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field></div>
            <Field label="Fecha">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />}</Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Inicio">{(id) => <Input id={id} type="time" value={f.from} onChange={(e) => set("from", e.target.value)} />}</Field>
              <Field label="Fin">{(id) => <Input id={id} type="time" value={f.to} onChange={(e) => set("to", e.target.value)} />}</Field>
            </div>
          </div>
          {start && end && <p className="-mt-2 text-xs text-muted">{scheduleText(start, end, region.timezone, region.locale)}{v && !isBlock ? ` · el espacio queda ocupado desde ${minutesText(v.setup_minutes)} antes (montaje) hasta ${minutesText(v.teardown_minutes)} después (desmontaje)` : ""}.</p>}
          <ConflictBox conflicts={conflicts.data} loading={conflicts.isFetching} tz={region.timezone} locale={region.locale} />

          {!isBlock && <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Montaje">{(id) => <Select id={id} value={f.setup} onChange={(e) => set("setup", e.target.value)}>{(Object.keys(SETUPS) as SetupKey[]).map((k) => {
                const c = capacityFor(v, k);
                return <option key={k} value={k}>{SETUPS[k].label}{c ? ` (hasta ${c})` : ""}</option>;
              })}</Select>}</Field>
              <Field label="Invitados" error={overCap ? `La capacidad en ${SETUPS[f.setup].label.toLowerCase()} es de ${cap} personas.` : null}>{(id) => <Input id={id} type="number" min={0} inputMode="numeric" value={f.guests} onChange={(e) => set("guests", e.target.value)} />}</Field>
            </div>
            <div className="space-y-2">
              <Field label="Cliente">{(id) => <Select id={id} value={f.customer_id} onChange={(e) => set("customer_id", e.target.value)}><option value="">+ Cliente nuevo</option>{(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
              {!f.customer_id && <div className="grid gap-2 sm:grid-cols-2"><Input value={f.new_name} onChange={(e) => set("new_name", e.target.value)} placeholder="Nombre del cliente" aria-label="Nombre del cliente nuevo" /><Input type="tel" value={f.new_phone} onChange={(e) => set("new_phone", e.target.value)} placeholder="Teléfono / WhatsApp" aria-label="Teléfono del cliente nuevo" /></div>}
            </div>
            <Field label="Nombre del evento" optional>{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej. Boda Castillo – Herrera" />}</Field>
            <div>
              <div className="mb-1.5 text-sm font-medium">¿Cómo queda la fecha?</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {([["inquiry", "Solo consulta", "No aparta la fecha"], ["hold", "Apartar provisional", "Se libera sola si vence"], ["confirmed", "Confirmar", "Fecha reservada"]] as const).map(([k, l, h]) => {
                  const disabled = k !== "inquiry" && taken;
                  return (
                    <button key={k} type="button" disabled={disabled} onClick={() => set("status", k)}
                      className={cx("rounded-xl border p-3 text-left disabled:opacity-40", f.status === k ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-line")}>
                      <span className="block text-sm font-semibold">{l}</span><span className="block text-xs text-muted">{h}</span>
                    </button>
                  );
                })}
              </div>
              {f.status === "hold" && <div className="mt-2 flex items-center gap-2 text-sm">Apartar por <Input type="number" min={1} max={90} value={f.hold_days} onChange={(e) => set("hold_days", e.target.value)} className="h-9 w-20" aria-label="Días de apartado" /> días (hasta el {formatDate(new Date(Date.now() + Number(f.hold_days || 7) * 86_400_000), { timeZone: region.timezone })}).</div>}
            </div>
            <div className="rounded-xl border border-line p-4">
              {price.isFetching ? <span className="text-sm text-muted">Buscando la tarifa…</span> : price.data ? (
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={f.use_rate} onChange={(e) => set("use_rate", e.target.checked)} className="mt-1 size-4 accent-ink" />
                  <span className="flex-1">
                    <span className="block font-semibold">Usar la tarifa "{price.data.rate_name}": {formatMoney(Number(price.data.total), price.data.currency_code, region.locale)}</span>
                    <span className="block text-xs text-muted">{formatMoney(Number(price.data.base_price), price.data.currency_code, region.locale)} por {Number(price.data.base_hours)} h{price.data.extra_hours > 0 ? ` + ${price.data.extra_hours} h adicionales` : ""}{Number(price.data.deposit_amount) ? ` · garantía ${formatMoney(Number(price.data.deposit_amount), price.data.currency_code, region.locale)}` : ""}. Después puedes ajustar precios y agregar extras.</span>
                  </span>
                </label>
              ) : <p className="text-sm text-muted">No hay una tarifa para ese día. Podrás escribir el precio después. <Link to={workspacePath(ws.kind, ws.id, "m/venue_rates")} className="font-semibold underline">Configurar tarifas</Link></p>}
            </div>
            <Field label="¿Cómo te contactó?" optional>{(id) => <Select id={id} value={f.source} onChange={(e) => set("source", e.target.value)}><option value="">—</option>{Object.entries(SOURCES).filter(([k]) => k !== "web").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          </>}
          {isBlock && <Field label="Motivo">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej. Pintura y mantenimiento" />}</Field>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="accent" className="w-full" loading={busy} disabled={!isBlock && taken && f.status !== "inquiry"}>
            {isBlock ? "Bloquear fechas" : f.status === "inquiry" ? "Guardar consulta" : f.status === "hold" ? "Apartar la fecha" : "Confirmar reserva"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Editor
function BookingEditor({ id }: { id: string }) {
  const { ws, region, readOnly, modules } = useWorkspace();
  const navigate = useNavigate();
  const invalidate = useInvalidateVenues();
  const { data: venues } = useVenues(ws.id, { includeInactive: true });
  const { data: customers } = useCustomers(ws.id);
  const booking = useQuery({ queryKey: ["booking", id], queryFn: async () => unwrap<Booking>(await supabase.from("bookings").select("*").eq("id", id).single()) });
  const items = useBookingItems(id);
  const payments = usePayments(ws.id);
  const hasFinance = modules.some((m) => m.module_key === "finance");
  const hasContracts = modules.some((m) => m.module_key === "contracts");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger" | "info"; text: string } | null>(null);
  const [paying, setPaying] = useState(false);
  const [f, setF] = useState({ venue_id: "", date: "", from: "", to: "", setup: "banquet" as SetupKey, guests: "", title: "", setup_h: "", teardown_h: "", ops_notes: "", notes: "", discount: "0", tax: "0", advance: "50", hold_date: "" });
  const b = booking.data;
  useEffect(() => {
    if (!b) return;
    const s = toLocalInput(b.starts_at, region.timezone), e = toLocalInput(b.ends_at, region.timezone);
    setF({ venue_id: b.venue_id, date: s.slice(0, 10), from: s.slice(11), to: e.slice(11), setup: b.setup, guests: b.guests == null ? "" : String(b.guests), title: b.title,
      setup_h: String(b.setup_minutes / 60), teardown_h: String(b.teardown_minutes / 60), ops_notes: b.ops_notes ?? "", notes: b.notes ?? "",
      discount: String(b.discount_amount), tax: String(b.tax_rate), advance: String(b.advance_pct), hold_date: b.hold_until ? toLocalInput(b.hold_until, region.timezone).slice(0, 10) : "" });
  }, [b, region.timezone]);
  const range = useRange(f.date, f.from, f.to, region.timezone);
  const occFrom = range.start ? new Date(new Date(range.start).getTime() - Number(f.setup_h || 0) * 3_600_000).toISOString() : null;
  const occTo = range.end ? new Date(new Date(range.end).getTime() + Number(f.teardown_h || 0) * 3_600_000).toISOString() : null;
  const conflicts = useConflicts(ws.id, f.venue_id, occFrom, occTo, id);

  if (booking.isLoading) return <Spinner />;
  if (!b) return <Card><EmptyState title="Reserva no encontrada" /></Card>;
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const v = venues?.find((x) => x.id === b.venue_id);
  const customer = customers?.find((c) => c.id === b.customer_id);
  const money = (n: number) => formatMoney(n, b.currency_code, region.locale);
  const editable = !readOnly && b.status !== "done" && b.status !== "canceled";
  const isBlock = b.kind === "block";
  const myPayments = (payments.data ?? []).filter((p: Payment & { booking_id?: string | null }) => p.booking_id === b.id);
  const paid = myPayments.filter((p) => p.currency_code === b.currency_code).reduce((s, p) => s + Number(p.amount), 0);
  const advance = Math.round(Number(b.total) * Number(b.advance_pct)) / 100;
  const balance = Number(b.total) - paid - Number(b.deposit_retained);
  const cap = capacityFor(venues?.find((x) => x.id === f.venue_id), f.setup);
  const past = new Date(b.ends_at).getTime() < Date.now();

  async function save(patch: Partial<Booking>, ok?: string) {
    const { error } = await supabase.from("bookings").update(patch).eq("id", id);
    if (error) { setMsg({ tone: "danger", text: error.message }); await invalidate(); return false; }
    await invalidate();
    if (ok) setMsg({ tone: "ok", text: ok });
    return true;
  }
  async function saveDetails() {
    if (!range.start || !range.end) return setMsg({ tone: "danger", text: "Indica la fecha y el horario." });
    await save({ venue_id: f.venue_id, starts_at: range.start, ends_at: range.end, setup: f.setup, guests: f.guests ? Number(f.guests) : null, title: f.title.trim() || b!.title,
      setup_minutes: Math.round(Number(f.setup_h || 0) * 60), teardown_minutes: Math.round(Number(f.teardown_h || 0) * 60),
      ops_notes: f.ops_notes.trim() || null, notes: f.notes.trim() || null, discount_amount: Number(f.discount) || 0, tax_rate: Number(f.tax) || 0, advance_pct: Number(f.advance) || 0 });
  }
  async function setStatus(status: BookingStatus, ok: string, extra: Partial<Booking> = {}, question?: string) {
    if (question && !confirm(question)) return;
    await save({ status, ...extra }, ok);
  }
  async function remove() {
    if (!confirm(`¿Eliminar ${docBooking(b!.number)}?`)) return;
    const { error } = await supabase.from("bookings").delete().eq("id", id);
    if (error) return setMsg({ tone: "danger", text: error.message });
    await invalidate();
    navigate(base("m/bookings"));
  }
  const holdIso = (d: string) => fromLocalInput(`${d}T23:59`, region.timezone);
  const waText = `Hola ${customer?.name ?? ""}, ${b.status === "confirmed" ? "tu reserva está confirmada" : b.status === "hold" ? `apartamos tu fecha hasta el ${formatDate(b.hold_until, { timeZone: region.timezone })}` : "gracias por tu consulta"}: ${v?.name}, ${scheduleText(b.starts_at, b.ends_at, region.timezone, region.locale)}${Number(b.total) > 0 ? `. Total: ${money(Number(b.total))}` : ""}${b.status === "hold" && advance > 0 ? `. Para confirmar, el anticipo es de ${money(advance)}` : ""}.`;

  return (
    <div className="animate-rise">
      <Link to={base("m/bookings")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Reservas</Link>
      <PageHeader eyebrow={<span className="inline-flex items-center gap-2">{docBooking(b.number)} <BookingBadge b={b} /></span>} title={b.title}
        description={<>{v?.name} · {scheduleText(b.starts_at, b.ends_at, region.timezone, region.locale)}{customer && <> · <Link to={base(`m/customers/${customer.id}`)} className="hover:underline">{customer.name}</Link></>}</>}
        actions={<>
          {!isBlock && <Link to={base(`imprimir/reserva?id=${id}`)}><Button variant="secondary" icon={<Printer className="size-4" />}>Confirmación</Button></Link>}
          {!isBlock && <Link to={base(`imprimir/reserva?id=${id}&tipo=hoja`)}><Button variant="secondary" icon={<ClipboardList className="size-4" />}>Hoja del evento</Button></Link>}
          {!readOnly && !isBlock && b.status === "inquiry" && <Button variant="secondary" icon={<Lock className="size-4" />} onClick={() => void setStatus("hold", "Fecha apartada por 7 días.", { hold_until: new Date(Date.now() + 7 * 86_400_000).toISOString() })}>Apartar 7 días</Button>}
          {!readOnly && !isBlock && (b.status === "inquiry" || b.status === "hold") && <Button variant="accent" icon={<CheckCircle2 className="size-4" />} onClick={() => void setStatus("confirmed", "Reserva confirmada.")}>Confirmar</Button>}
          {!readOnly && !isBlock && b.status === "confirmed" && past && <Button variant="accent" icon={<CheckCircle2 className="size-4" />} onClick={() => void setStatus("done", "Evento marcado como realizado.")}>Marcar realizado</Button>}
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert></div>}
      {b.status === "hold" && b.hold_until && <div className="mb-4"><Alert tone="warn" title={`Apartado hasta el ${formatDate(b.hold_until, { timeZone: region.timezone, withTime: true })}`}>Si no se confirma antes, la fecha se libera sola y la reserva vuelve a "Consulta".</Alert></div>}
      {b.status === "inquiry" && b.hold_expired_at && <div className="mb-4"><Alert tone="info">El apartado venció el {formatDate(b.hold_expired_at, { timeZone: region.timezone, withTime: true })} y la fecha se liberó.</Alert></div>}
      {b.client_message && <div className="mb-4"><Alert tone="info" title="Mensaje del cliente">{b.client_message}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={isBlock ? "Bloqueo" : "Detalles del evento"} description={BOOKING_STATUS[b.status].hint} />
            <fieldset disabled={!editable} className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Espacio">{(i) => <Select id={i} value={f.venue_id} onChange={(e) => setF((s) => ({ ...s, venue_id: e.target.value }))} onBlur={() => void saveDetails()}>{(venues ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
                <Field label={isBlock ? "Motivo" : "Nombre del evento"}>{(i) => <Input id={i} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
                <Field label="Fecha">{(i) => <Input id={i} type="date" value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Inicio">{(i) => <Input id={i} type="time" value={f.from} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
                  <Field label="Fin">{(i) => <Input id={i} type="time" value={f.to} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
                </div>
                {!isBlock && <>
                  <Field label="Montaje">{(i) => <Select id={i} value={f.setup} onChange={(e) => setF((s) => ({ ...s, setup: e.target.value as SetupKey }))} onBlur={() => void saveDetails()}>{(Object.keys(SETUPS) as SetupKey[]).map((k) => <option key={k} value={k}>{SETUPS[k].label}</option>)}</Select>}</Field>
                  <Field label="Invitados" error={cap != null && Number(f.guests) > cap ? `Supera la capacidad (${cap}).` : null} hint={cap != null ? `Capacidad: ${cap}` : undefined}>{(i, d) => <Input id={i} aria-describedby={d} type="number" min={0} value={f.guests} onChange={(e) => setF((s) => ({ ...s, guests: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
                  <Field label="Horas de montaje (antes)">{(i) => <Input id={i} type="number" min={0} step="0.5" value={f.setup_h} onChange={(e) => setF((s) => ({ ...s, setup_h: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
                  <Field label="Horas de desmontaje (después)">{(i) => <Input id={i} type="number" min={0} step="0.5" value={f.teardown_h} onChange={(e) => setF((s) => ({ ...s, teardown_h: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
                </>}
              </div>
              {editable && (b.status === "hold" || b.status === "confirmed" || isBlock) && conflicts.data && conflicts.data.length > 0 && (
                <ConflictBox conflicts={conflicts.data} loading={false} tz={region.timezone} locale={region.locale} />
              )}
              {b.status === "inquiry" && <ConflictBox conflicts={conflicts.data} loading={conflicts.isFetching} tz={region.timezone} locale={region.locale} />}
              {!isBlock && <Field label="Indicaciones para el equipo" optional hint="Aparecen en la hoja del evento: decoración, proveedores, horarios de llegada, menú…">{(i, d) => <Textarea id={i} aria-describedby={d} value={f.ops_notes} onChange={(e) => setF((s) => ({ ...s, ops_notes: e.target.value }))} onBlur={() => void saveDetails()} className="min-h-24" />}</Field>}
              <Field label="Notas internas" optional hint="No aparecen en ningún documento.">{(i, d) => <Textarea id={i} aria-describedby={d} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} onBlur={() => void saveDetails()} />}</Field>
            </fieldset>
          </Card>
          {!isBlock && <LinesCard booking={b} items={items.data ?? []} editable={editable} money={money} onError={(t) => setMsg({ tone: "danger", text: t })} />}
        </div>

        <div className="space-y-6">
          {!isBlock && (
            <Card className="p-5">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{money(Number(b.subtotal))}</dd></div>
                {Number(b.discount_amount) > 0 && <div className="flex justify-between"><dt className="text-muted">Descuento</dt><dd className="tabular-nums">−{money(Math.min(Number(b.discount_amount), Number(b.subtotal)))}</dd></div>}
                {Number(b.tax_rate) > 0 && <div className="flex justify-between"><dt className="text-muted">IVA ({Number(b.tax_rate)}%)</dt><dd className="tabular-nums">{money(Number(b.tax_amount))}</dd></div>}
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="font-display text-2xl tabular-nums">{money(Number(b.total))}</dd></div>
                {Number(b.advance_pct) > 0 && <div className="flex justify-between text-[var(--accent)]"><dt>Anticipo para confirmar ({Number(b.advance_pct)}%)</dt><dd className="font-semibold tabular-nums">{money(advance)}</dd></div>}
                {hasFinance && <>
                  <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Pagado</dt><dd className="tabular-nums">{money(paid)}</dd></div>
                  <div className={cx("flex justify-between font-semibold", balance > 0.004 ? "text-warn" : "text-ok")}><dt>{balance > 0.004 ? "Saldo pendiente" : "Pagado por completo"}</dt><dd className="tabular-nums">{money(Math.max(0, balance))}</dd></div>
                </>}
              </dl>
              {hasFinance && !readOnly && b.status !== "canceled" && <Button variant="secondary" className="mt-4 w-full" icon={<Wallet className="size-4" />} onClick={() => setPaying(true)}>Registrar pago</Button>}
              {hasFinance && myPayments.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
                  {myPayments.map((p) => <li key={p.id} className="flex justify-between"><span>{formatDate(`${p.paid_at}T12:00:00Z`, { timeZone: "UTC" })}</span><span className="tabular-nums">{formatMoney(Number(p.amount), p.currency_code, region.locale)}</span></li>)}
                </ul>
              )}
              <fieldset disabled={!editable} className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
                <Field label="Descuento">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.discount} onChange={(e) => setF((s) => ({ ...s, discount: e.target.value }))} onBlur={() => void saveDetails()} className="h-9" />}</Field>
                <Field label="IVA %">{(i) => <Input id={i} type="number" min={0} max={100} value={f.tax} onChange={(e) => setF((s) => ({ ...s, tax: e.target.value }))} onBlur={() => void saveDetails()} className="h-9" />}</Field>
                <Field label="Anticipo %">{(i) => <Input id={i} type="number" min={0} max={100} value={f.advance} onChange={(e) => setF((s) => ({ ...s, advance: e.target.value }))} onBlur={() => void saveDetails()} className="h-9" />}</Field>
              </fieldset>
            </Card>
          )}
          {!isBlock && <GuaranteeCard booking={b} money={money} readOnly={readOnly} onSave={(p) => save(p)} />}
          {!readOnly && b.status === "hold" && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" />Cambiar el vencimiento del apartado</div>
              <div className="flex gap-2"><Input type="date" value={f.hold_date} onChange={(e) => setF((s) => ({ ...s, hold_date: e.target.value }))} className="h-9" aria-label="Nueva fecha de vencimiento" />
                <Button size="sm" variant="secondary" onClick={() => { const iso = holdIso(f.hold_date); if (iso) void save({ hold_until: iso }, "Vencimiento actualizado."); }}>Guardar</Button></div>
            </Card>
          )}
          {!readOnly && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              {customer?.phone && <a href={`https://wa.me/${waNumber(customer.phone)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-ink"><MessageCircle className="size-3.5 text-[#1f8b4c]" />Escribir al cliente</a>}
              {hasContracts && !isBlock && b.status !== "canceled" && <Link to={base(`m/contracts/nuevo?reserva_local=${id}`)} className="inline-flex items-center gap-1 text-muted hover:text-ink"><FileSignature className="size-3.5" />Crear contrato</Link>}
              {b.status === "hold" && <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => void setStatus("inquiry", "Fecha liberada; queda como consulta.", {}, "¿Liberar la fecha? La reserva queda como consulta.")}><Undo2 className="size-3.5" />Liberar la fecha</button>}
              {b.status === "confirmed" && !isBlock && <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => void setStatus("hold", "Vuelve a apartado provisional por 7 días.", { hold_until: new Date(Date.now() + 7 * 86_400_000).toISOString() })}><Undo2 className="size-3.5" />Volver a apartado</button>}
              {b.status === "done" && <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => void setStatus("confirmed", "Reabierta.")}><Undo2 className="size-3.5" />Reabrir</button>}
              {(b.status === "inquiry" || b.status === "hold" || b.status === "confirmed") && <button className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => void setStatus("canceled", isBlock ? "Bloqueo quitado." : "Reserva cancelada; la fecha quedó libre.", {}, isBlock ? "¿Quitar este bloqueo?" : "¿Cancelar la reserva? La fecha quedará libre.")}><Ban className="size-3.5" />{isBlock ? "Quitar bloqueo" : "Cancelar"}</button>}
              {b.status === "canceled" && <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => void setStatus("inquiry", "Reabierta como consulta.")}><Undo2 className="size-3.5" />Reabrir como consulta</button>}
              {(b.status === "inquiry" || b.status === "canceled") && <button className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => void remove()}><Trash2 className="size-3.5" />Eliminar</button>}
            </div>
          )}
          {!isBlock && v && (
            <Card className="p-4 text-sm">
              <div className="mb-1 flex items-center gap-2 font-semibold"><Users className="size-4" />{v.name}</div>
              <p className="text-xs text-muted">{(Object.keys(SETUPS) as SetupKey[]).filter((k) => capacityFor(v, k)).map((k) => `${SETUPS[k].label}: ${capacityFor(v, k)}`).join(" · ") || "Sin capacidades registradas"}</p>
              {v.rules && <p className="mt-2 whitespace-pre-line text-xs text-ink-soft"><b>Reglas:</b> {v.rules}</p>}
            </Card>
          )}
        </div>
      </div>
      {paying && <PaymentDialog defaults={{ customer_id: b.customer_id ?? undefined, event_id: b.event_id, booking_id: b.id, currency_code: b.currency_code, amount: Math.max(0, Math.round((paid > 0 ? balance : advance || balance) * 100) / 100) || undefined, kind: paid > 0 ? "final" : "deposit" }}
        onClose={() => setPaying(false)} onSaved={() => { setPaying(false); setMsg({ tone: "ok", text: "Pago registrado." }); }} />}
    </div>
  );
}

function LinesCard({ booking: b, items, editable, money, onError }: { booking: Booking; items: BookingItem[]; editable: boolean; money: (n: number) => string; onError: (t: string) => void }) {
  const { ws } = useWorkspace();
  const invalidate = useInvalidateVenues();
  const [line, setLine] = useState({ description: "", quantity: "1", price: "" });
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!line.description.trim()) return;
    const { error } = await supabase.from("booking_items").insert({ workspace_id: ws.id, booking_id: b.id, description: line.description.trim(), quantity: Number(line.quantity) || 1, unit_price: Number(line.price) || 0, sort: items.length + 1 });
    if (error) return onError(error.message);
    setLine({ description: "", quantity: "1", price: "" });
    await invalidate();
  }
  async function update(it: BookingItem, patch: Partial<BookingItem>) {
    const { error } = await supabase.from("booking_items").update(patch).eq("id", it.id);
    if (error) onError(error.message);
    await invalidate();
  }
  async function remove(it: BookingItem) {
    await supabase.from("booking_items").delete().eq("id", it.id);
    await invalidate();
  }
  return (
    <Card>
      <CardHeader title="Precio y extras" description="El alquiler del espacio y lo adicional: decoración, sonido, limpieza, horas extra…" />
      {!items.length ? <p className="px-5 py-4 text-sm text-muted">Sin conceptos todavía.</p> : (
        <ul className="divide-y divide-line">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:px-5">
              {editable ? <Input defaultValue={it.description} key={`d${it.description}`} className="h-9 min-w-0 flex-1" aria-label="Concepto" onBlur={(e) => e.target.value.trim() && e.target.value !== it.description && void update(it, { description: e.target.value.trim() })} />
                : <span className="min-w-0 flex-1">{it.description}</span>}
              {editable ? <>
                <Input type="number" min={0.01} step="any" defaultValue={it.quantity} key={`q${it.quantity}`} className="h-9 w-20 text-right" aria-label="Cantidad" onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== Number(it.quantity) && void update(it, { quantity: Number(e.target.value) })} />
                <Input type="number" min={0} step="0.01" defaultValue={it.unit_price} key={`p${it.unit_price}`} className="h-9 w-28 text-right" aria-label="Precio" onBlur={(e) => Number(e.target.value) >= 0 && Number(e.target.value) !== Number(it.unit_price) && void update(it, { unit_price: Number(e.target.value) })} />
              </> : <span className="text-muted">{Number(it.quantity)} × {money(Number(it.unit_price))}</span>}
              <span className="w-28 text-right font-semibold tabular-nums">{money(Number(it.line_total))}</span>
              {editable && <button onClick={() => void remove(it)} className="rounded-lg p-1.5 text-muted hover:text-danger" aria-label={`Quitar ${it.description}`}><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form onSubmit={add} className="grid gap-2 border-t border-line bg-paper/50 p-4 sm:grid-cols-[1fr_80px_120px_auto]">
          <Input value={line.description} onChange={(e) => setLine((s) => ({ ...s, description: e.target.value }))} placeholder="Concepto: decoración, DJ, limpieza, hora extra…" aria-label="Nuevo concepto" />
          <Input type="number" min={0.01} step="any" value={line.quantity} onChange={(e) => setLine((s) => ({ ...s, quantity: e.target.value }))} aria-label="Cantidad" className="text-right" />
          <Input type="number" min={0} step="0.01" value={line.price} onChange={(e) => setLine((s) => ({ ...s, price: e.target.value }))} placeholder="Precio" aria-label="Precio" className="text-right" />
          <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} disabled={!line.description.trim()}>Agregar</Button>
        </form>
      )}
    </Card>
  );
}

function GuaranteeCard({ booking: b, money, readOnly, onSave }: { booking: Booking; money: (n: number) => string; readOnly: boolean; onSave: (p: Partial<Booking>) => Promise<boolean> }) {
  const [f, setF] = useState({ amount: "", received: "", refunded: "", retained: "", notes: "" });
  useEffect(() => setF({ amount: String(b.deposit_amount), received: String(b.deposit_received), refunded: String(b.deposit_refunded), retained: String(b.deposit_retained), notes: b.deposit_notes ?? "" }),
    [b.deposit_amount, b.deposit_received, b.deposit_refunded, b.deposit_retained, b.deposit_notes]);
  const held = Number(b.deposit_received) - Number(b.deposit_refunded) - Number(b.deposit_retained);
  const commit = () => void onSave({ deposit_amount: Number(f.amount) || 0, deposit_received: Number(f.received) || 0, deposit_refunded: Number(f.refunded) || 0, deposit_retained: Number(f.retained) || 0, deposit_notes: f.notes.trim() || null });
  const after = b.status === "done" || new Date(b.ends_at).getTime() < Date.now();
  return (
    <Card>
      <CardHeader title="Garantía" description="Depósito reembolsable por daños. Se devuelve después del evento si todo está en orden." />
      <fieldset disabled={readOnly || b.status === "canceled"} className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Solicitada">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} onBlur={commit} />}</Field>
          <Field label="Recibida">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.received} onChange={(e) => setF((s) => ({ ...s, received: e.target.value }))} onBlur={commit} />}</Field>
          {(after || Number(b.deposit_refunded) > 0 || Number(b.deposit_retained) > 0) && <>
            <Field label="Devuelta">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.refunded} onChange={(e) => setF((s) => ({ ...s, refunded: e.target.value }))} onBlur={commit} />}</Field>
            <Field label="Retenida por daños">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.retained} onChange={(e) => setF((s) => ({ ...s, retained: e.target.value }))} onBlur={commit} />}</Field>
          </>}
        </div>
        <Field label="Notas" optional>{(i) => <Input id={i} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} onBlur={commit} />}</Field>
        <div className="flex justify-between rounded-xl bg-paper px-3 py-2 text-sm"><span className="text-muted">En tu poder</span><span className="font-semibold tabular-nums">{money(held)}</span></div>
        {after && held > 0.004 && <Button size="sm" variant="accent" className="w-full" icon={<CheckCircle2 className="size-4" />} onClick={() => void onSave({ deposit_refunded: Number(b.deposit_received) - Number(b.deposit_retained) })}>Devolver {money(held)} al cliente</Button>}
      </fieldset>
    </Card>
  );
}
