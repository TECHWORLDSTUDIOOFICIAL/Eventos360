import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CalendarDays, CalendarRange, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EVENT_CATEGORIES, fromLocalInput, toLocalInput, useEventSummary, useEvents, type EventRow } from "@/lib/events";
import { CONTRACT_STATUS, QUOTE_STATUS, docNumber, useContracts, useCustomers, usePayments, useQuotes } from "@/lib/pro";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Guests } from "@/pages/personal/GuestsPage";
import { Invitations } from "@/pages/personal/InvitationsPage";
import { Seating } from "@/pages/personal/SeatingPage";
import { Schedule } from "@/pages/personal/SchedulePage";
import { Tasks } from "@/pages/personal/TasksPage";
import { Budget } from "@/pages/personal/BudgetPage";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

const STATUS: Record<EventRow["status"], { label: string; tone: "info" | "ok" | "neutral" | "danger" }> = {
  planning: { label: "En organización", tone: "info" }, confirmed: { label: "Confirmado", tone: "ok" },
  done: { label: "Realizado", tone: "neutral" }, canceled: { label: "Cancelado", tone: "danger" },
};

export default function ProEventsPage() {
  const { itemId } = useParams();
  return itemId ? <EventDetail id={itemId} /> : <EventList />;
}

function EventList() {
  const { ws, region, readOnly } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useEvents(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const [q, setQ] = useState("");
  const [when, setWhen] = useState<"upcoming" | "past" | "all">("upcoming");
  const [creating, setCreating] = useState(params.get("nuevo") === "1");
  const navigate = useNavigate();
  const now = Date.now();
  const custName = (id: string | null | undefined) => customers?.find((c) => c.id === id)?.name;
  const list = useMemo(() => (data ?? []).filter((e) => {
    const t = e.starts_at ? new Date(e.starts_at).getTime() : Infinity;
    if (when === "upcoming" && (t < now - 86_400_000 || e.status === "done")) return false;
    if (when === "past" && !(t < now - 86_400_000 || e.status === "done")) return false;
    return !q || `${e.name} ${custName(e.customer_id) ?? ""} ${e.venue_name ?? ""}`.toLowerCase().includes(q.toLowerCase());
  }), [data, when, q, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="animate-rise">
      <PageHeader title="Eventos" description="Los eventos de tus clientes: fecha, lugar, invitados, cronograma, costos y cobros."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nuevo evento</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por evento, cliente o lugar" className="h-10 pl-9" />
          </div>
          {(["upcoming", "past", "all"] as const).map((w) => (
            <button key={w} onClick={() => setWhen(w)} className={cx("rounded-full px-3 py-1.5 text-sm font-medium", when === w ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5")}>
              {w === "upcoming" ? "Próximos" : w === "past" ? "Pasados" : "Todos"}
            </button>
          ))}
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<CalendarRange className="size-6" />} title="Aún no tienes eventos"
            action={!readOnly && <Button variant="accent" onClick={() => setCreating(true)}>Crear evento</Button>}>
            Crea el evento de tu cliente para organizar invitados, cronograma, proveedores, costos y cobros.
          </EmptyState>
        ) : !list.length ? <p className="px-5 py-10 text-center text-sm text-muted">No hay eventos en esta vista.</p> : (
          <ul className="divide-y divide-line">
            {list.map((e) => (
              <li key={e.id}>
                <Link to={workspacePath(ws.kind, ws.id, `m/events/${e.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                  <div className="grid w-14 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] py-1.5 text-center text-[var(--accent)]">
                    {e.starts_at ? <>
                      <span className="text-[11px] font-semibold uppercase">{new Intl.DateTimeFormat(region.locale, { month: "short", timeZone: region.timezone }).format(new Date(e.starts_at))}</span>
                      <span className="font-display text-xl font-semibold leading-none">{new Intl.DateTimeFormat(region.locale, { day: "numeric", timeZone: region.timezone }).format(new Date(e.starts_at))}</span>
                    </> : <span className="text-xs">s/f</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.name}</div>
                    <div className="truncate text-xs text-muted">{[custName(e.customer_id), EVENT_CATEGORIES[e.category], e.venue_name].filter(Boolean).join(" · ")}</div>
                  </div>
                  <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <ProEventDialog event={null} defaultCustomer={params.get("cliente") ?? ""}
        onClose={() => { setCreating(false); if (params.get("nuevo")) setParams({}); }}
        onSaved={(id) => navigate(workspacePath(ws.kind, ws.id, `m/events/${id}`))} />}
    </div>
  );
}

export function ProEventDialog({ event, defaultCustomer, onClose, onSaved }: { event: EventRow | null; defaultCustomer?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { ws, region } = useWorkspace();
  const qc = useQueryClient();
  const { data: customers } = useCustomers(ws.id);
  const [f, setF] = useState({
    name: event?.name ?? "", customer_id: event?.customer_id ?? defaultCustomer ?? "", category: event?.category ?? "boda", honorees: event?.honorees ?? "",
    starts_at: toLocalInput(event?.starts_at ?? null, region.timezone), ends_at: toLocalInput(event?.ends_at ?? null, region.timezone),
    venue_name: event?.venue_name ?? "", venue_address: event?.venue_address ?? "", venue_map_url: event?.venue_map_url ?? "",
    guests_estimate: String(event?.guests_estimate ?? ""), budget: String(event?.budget ?? ""), currency_code: event?.currency_code ?? region.currency_code,
    status: event?.status ?? "planning", description: event?.description ?? "",
  });
  const [conflicts, setConflicts] = useState<{ id: string; name: string; starts_at: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  // Aviso de conflicto de fechas (no bloquea: puedes tener ayuda en dos eventos).
  useEffect(() => {
    const start = fromLocalInput(f.starts_at, region.timezone);
    if (!start) { setConflicts([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("event_conflicts", { p_ws: ws.id, p_starts: start, p_ends: fromLocalInput(f.ends_at, region.timezone), p_exclude: event?.id ?? null });
      setConflicts((data as { id: string; name: string; starts_at: string }[]) ?? []);
    }, 400);
    return () => clearTimeout(t);
  }, [f.starts_at, f.ends_at, ws.id, region.timezone, event?.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del evento.");
    if (f.venue_map_url && !/^https:\/\//i.test(f.venue_map_url)) return setError("El enlace del mapa debe empezar con https://");
    setBusy(true);
    const row = {
      name: f.name.trim(), customer_id: f.customer_id || null, category: f.category, honorees: f.honorees.trim() || null,
      starts_at: fromLocalInput(f.starts_at, region.timezone), ends_at: fromLocalInput(f.ends_at, region.timezone),
      venue_name: f.venue_name.trim() || null, venue_address: f.venue_address.trim() || null, venue_map_url: f.venue_map_url.trim() || null,
      guests_estimate: f.guests_estimate ? Number(f.guests_estimate) : null, budget: Number(f.budget) || 0, currency_code: f.currency_code,
      status: f.status, description: f.description.trim() || null,
    };
    const res = event ? await supabase.from("events").update(row).eq("id", event.id).select("id").single()
      : await supabase.from("events").insert({ ...row, workspace_id: ws.id }).select("id").single();
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await qc.invalidateQueries({ queryKey: ["events", ws.id] });
    onSaved((res.data as { id: string }).id);
  }

  return (
    <Dialog open onClose={onClose} title={event ? "Editar evento" : "Nuevo evento"} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="pro-event-form" variant="accent" loading={busy}>Guardar</Button></>}>
      <form id="pro-event-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Cliente">
          {(id) => (
            <Select id={id} value={f.customer_id} onChange={(e) => set("customer_id", e.target.value)}>
              <option value="">Sin cliente asignado</option>
              {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Nombre del evento">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Boda Rodríguez – López" />}</Field>
        <Field label="Tipo">{(id) => <Select id={id} value={f.category} onChange={(e) => set("category", e.target.value)}>{Object.entries(EVENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Festejado(s)" optional>{(id) => <Input id={id} value={f.honorees} onChange={(e) => set("honorees", e.target.value)} />}</Field>
        <Field label="Inicio">{(id) => <Input id={id} type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} />}</Field>
        <Field label="Fin" optional hint="Si lo dejas vacío se asumen 6 horas para revisar choques de fecha.">{(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} />}</Field>
        {conflicts.length > 0 && (
          <div className="sm:col-span-2">
            <Alert tone="warn" title="Choque de fechas">
              {conflicts.map((c) => `${c.name} (${formatDate(c.starts_at, { timeZone: region.timezone, withTime: true })})`).join(" · ")} se cruza con este horario.
            </Alert>
          </div>
        )}
        <Field label="Lugar" optional>{(id) => <Input id={id} value={f.venue_name} onChange={(e) => set("venue_name", e.target.value)} />}</Field>
        <Field label="Dirección" optional>{(id) => <Input id={id} value={f.venue_address} onChange={(e) => set("venue_address", e.target.value)} />}</Field>
        <Field label="Enlace de Google Maps" optional>{(id) => <Input id={id} value={f.venue_map_url} onChange={(e) => set("venue_map_url", e.target.value)} placeholder="https://…" />}</Field>
        <Field label="Invitados estimados" optional>{(id) => <Input id={id} type="number" min={0} value={f.guests_estimate} onChange={(e) => set("guests_estimate", e.target.value)} />}</Field>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <Field label="Presupuesto del cliente" optional>{(id) => <Input id={id} type="number" min={0} step="0.01" value={f.budget} onChange={(e) => set("budget", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option>NIO</option><option>USD</option></Select>}</Field>
        </div>
        <Field label="Estado">{(id) => <Select id={id} value={f.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}

const TABS = [
  ["resumen", "Resumen"], ["invitados", "Invitados"], ["invitacion", "Invitación"], ["mesas", "Mesas"],
  ["cronograma", "Cronograma"], ["tareas", "Tareas"], ["costos", "Costos"],
] as const;

function EventDetail({ id }: { id: string }) {
  const { ws, region, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") ?? "resumen") as (typeof TABS)[number][0];
  const { data: events, isLoading } = useEvents(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const [editing, setEditing] = useState(false);
  const event = events?.find((e) => e.id === id);
  if (isLoading) return <Spinner />;
  if (!event) return <Card><EmptyState title="Evento no encontrado" /></Card>;
  const customer = customers?.find((c) => c.id === event.customer_id);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const one = { event, events: [event], select: () => undefined };

  async function remove() {
    if (!confirm(`¿Eliminar "${event!.name}" con sus invitados, mesas, cronograma y costos? Las cotizaciones, contratos y pagos se conservan sin evento.`)) return;
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) return alert(error.message);
    await qc.invalidateQueries({ queryKey: ["events", ws.id] });
    navigate(base("m/events"));
  }

  return (
    <div className="animate-rise">
      <Link to={base("m/events")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink print:hidden"><ArrowLeft className="size-4" />Eventos</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            {EVENT_CATEGORIES[event.category]} <Badge tone={STATUS[event.status].tone}>{STATUS[event.status].label}</Badge>
          </div>
          <h1 className="font-display text-3xl font-semibold">{event.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {customer && <Link to={base(`m/customers/${customer.id}`)} className="font-medium text-ink hover:underline">{customer.name}</Link>}
            <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" />{event.starts_at ? formatDate(event.starts_at, { timeZone: region.timezone, locale: region.locale, withTime: true }) : "Sin fecha"}</span>
            {event.venue_name && <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{event.venue_name}</span>}
          </div>
        </div>
        {!readOnly && <div className="flex gap-2">
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>
          <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()} aria-label="Eliminar evento" />
        </div>}
      </div>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === "resumen" ? {} : { tab: k })}
            className={cx("shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "resumen" && <EventSummary event={event} />}
      {tab === "invitados" && <Guests {...one} />}
      {tab === "invitacion" && <Invitations {...one} />}
      {tab === "mesas" && <Seating {...one} />}
      {tab === "cronograma" && <Schedule {...one} />}
      {tab === "tareas" && <Tasks {...one} />}
      {tab === "costos" && <Budget {...one} />}
      {editing && <ProEventDialog event={event} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}

/** Resumen financiero y comercial del evento: contratado, cobrado, costos y ganancia. */
function EventSummary({ event }: { event: EventRow }) {
  const { ws, region, readOnly } = useWorkspace();
  const { data: s } = useEventSummary(event.id);
  const { data: quotes } = useQuotes(ws.id, { eventId: event.id });
  const { data: contracts } = useContracts(ws.id, { eventId: event.id });
  const { data: payments } = usePayments(ws.id, { eventId: event.id });
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const accepted = (quotes ?? []).filter((q) => q.status === "accepted");
  const cur = accepted[0]?.currency_code ?? event.currency_code;
  const money = (n: number, c = cur) => formatMoney(n, c, region.locale);
  const contracted = accepted.reduce((a, q) => a + Number(q.total), 0);
  const received = (payments ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const costs = s?.committed_total ?? 0;
  const profit = contracted - costs;
  const margin = contracted > 0 ? Math.round((profit / contracted) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Contratado", v: money(contracted), h: `${accepted.length} cotización(es) aceptada(s)` },
          { l: "Cobrado", v: money(received), h: contracted ? `Saldo ${money(Math.max(0, contracted - received))}` : "Registra pagos en Finanzas" },
          { l: "Costos", v: money(costs), h: `Pagado a proveedores ${money(s?.paid_total ?? 0)}` },
          { l: "Ganancia estimada", v: money(profit), h: margin === null ? "Sin monto contratado" : `Margen ${margin}%`, warn: profit < 0 },
        ].map((x) => (
          <Card key={x.l} className="p-4">
            <div className="text-xs text-muted">{x.l}</div>
            <div className={cx("mt-1 font-display text-xl font-semibold tabular-nums sm:text-2xl", x.warn && "text-danger")}>{x.v}</div>
            <div className="text-xs text-muted">{x.h}</div>
          </Card>
        ))}
      </div>
      {cur !== event.currency_code && costs > 0 && <Alert tone="info">La cotización está en {cur} y los costos en {event.currency_code}. Usa la misma moneda en ambos para que la ganancia sea exacta.</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Cotizaciones" action={!readOnly && <Link to={base(`m/quotes/nueva?cliente=${event.customer_id ?? ""}&evento=${event.id}`)} className="text-sm font-semibold text-[var(--accent)]">+ Nueva</Link>} />
          {!quotes?.length ? <p className="px-5 py-5 text-sm text-muted">Sin cotizaciones.</p> : (
            <ul className="divide-y divide-line">{quotes.map((q) => (
              <li key={q.id}><Link to={base(`m/quotes/${q.id}`)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-paper">
                <span className="font-mono text-xs">{docNumber("COT", q.number)}</span>
                <span className="flex items-center gap-2 tabular-nums">{money(Number(q.total), q.currency_code)}<Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge></span>
              </Link></li>))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Contratos" action={!readOnly && event.customer_id && <Link to={base(`m/contracts/nuevo?cliente=${event.customer_id}&evento=${event.id}`)} className="text-sm font-semibold text-[var(--accent)]">+ Nuevo</Link>} />
          {!contracts?.length ? <p className="px-5 py-5 text-sm text-muted">Sin contratos.</p> : (
            <ul className="divide-y divide-line">{contracts.map((k) => (
              <li key={k.id}><Link to={base(`m/contracts/${k.id}`)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-paper">
                <span className="font-mono text-xs">{docNumber("CON", k.number)}</span><Badge tone={CONTRACT_STATUS[k.status].tone}>{CONTRACT_STATUS[k.status].label}</Badge>
              </Link></li>))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Invitados" />
          <div className="space-y-1 px-5 py-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Estimados</span><span className="font-semibold">{event.guests_estimate ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted">En lista</span><span className="font-semibold">{s?.guests_total ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted">Personas confirmadas</span><span className="font-semibold">{s?.people_confirmed ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tareas pendientes</span><span className={cx("font-semibold", (s?.tasks_overdue ?? 0) > 0 && "text-danger")}>{(s?.tasks_total ?? 0) - (s?.tasks_done ?? 0)}</span></div>
          </div>
        </Card>
      </div>
      {!event.customer_id && <div className="flex items-center gap-2 text-sm text-warn"><AlertTriangle className="size-4" />Asigna un cliente al evento para crear cotizaciones y contratos.</div>}
    </div>
  );
}
