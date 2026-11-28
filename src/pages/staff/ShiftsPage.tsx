import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ClipboardCopy, Copy, MapPin, MessageCircle, Pencil, Plus, Trash2, UserPlus, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fromLocalInput, toLocalInput, useEvents } from "@/lib/events";
import { waNumber } from "@/lib/pro";
import { formatMoney, plural } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { docNumber } from "@/lib/pro";
import { useRentals } from "@/lib/rental";
import { scheduleText, useBookings } from "@/lib/venues";
import {
  ASSIGNMENT_STATUS, PAY_TYPES, POSITIONS, counts, estimatePay, hoursBetween, hoursText, shiftMessage, useAssignments, useCandidates,
  useInvalidateStaff, useShifts, useWorkers, workerPortalUrl, type Assignment, type AssignmentStatus, type PayType, type Shift,
} from "@/lib/staff";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

export default function ShiftsPage() {
  const { itemId } = useParams();
  return itemId ? <ShiftDetail id={itemId} /> : <ShiftList />;
}

/** Nombre y enlace de lo que cubre el turno (evento, reservación o reserva de salón). */
function useLinks() {
  const { ws, modules } = useWorkspace();
  const has = (k: string) => modules.some((m) => m.module_key === k);
  const { data: events } = useEvents(ws.id);
  const { data: rentals } = useRentals(ws.id, has("reservations") ? { statuses: ["draft", "reserved", "out", "returned"] } : undefined);
  const { data: bookings } = useBookings(ws.id);
  return {
    hasEvents: has("events"), hasRentals: has("reservations"), hasBookings: has("bookings"),
    events: has("events") ? events ?? [] : [], rentals: has("reservations") ? rentals ?? [] : [], bookings: has("bookings") ? (bookings ?? []).filter((b) => b.kind === "event" && b.status !== "canceled") : [],
    label(s: Pick<Shift, "event_id" | "rental_id" | "booking_id">) {
      if (s.event_id) { const e = events?.find((x) => x.id === s.event_id); return e ? { name: e.name, to: `m/events/${e.id}`, place: e.venue_name } : null; }
      if (s.rental_id) { const r = rentals?.find((x) => x.id === s.rental_id); return r ? { name: `${docNumber("RES", r.number)} · ${r.title}`, to: `m/reservations/${r.id}`, place: r.delivery_address } : null; }
      if (s.booking_id) { const b = bookings?.find((x) => x.id === s.booking_id); return b ? { name: b.title, to: `m/bookings/${b.id}`, place: null } : null; }
      return null;
    },
  };
}

function ShiftList() {
  const { ws, region, readOnly } = useWorkspace();
  const [params] = useSearchParams();
  const { data: shifts, isLoading } = useShifts(ws.id);
  const { data: assignments } = useAssignments(ws.id);
  const { data: workers } = useWorkers(ws.id);
  const links = useLinks();
  const [tab, setTab] = useState<"proximos" | "pasados">("proximos");
  const [creating, setCreating] = useState(!!(params.get("evento") || params.get("reservacion") || params.get("reserva")));
  const now = Date.now();
  const list = (shifts ?? []).filter((s) => (tab === "proximos" ? new Date(s.ends_at).getTime() >= now : new Date(s.ends_at).getTime() < now));
  if (tab === "pasados") list.reverse();
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: region.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const days = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of list) { const k = dayKey(s.starts_at); m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()];
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const upcoming = (shifts ?? []).filter((s) => new Date(s.ends_at).getTime() >= now);
  const missing = upcoming.reduce((n, s) => n + Math.max(0, s.needed - (assignments ?? []).filter((a) => a.shift_id === s.id && counts(a.status)).length), 0);
  const unconfirmed = (assignments ?? []).filter((a) => a.status === "assigned" && upcoming.some((s) => s.id === a.shift_id)).length;

  return (
    <div className="animate-rise">
      <PageHeader title="Turnos" description="Qué personal necesitas en cada evento, a qué hora y quién va. El sistema no deja poner a una persona en dos lugares a la vez."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} disabled={!workers}>Nuevo turno</Button>} />
      {upcoming.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Card className="p-4"><div className="text-xs text-muted">Turnos próximos</div><div className="mt-1 font-display text-2xl font-semibold">{upcoming.length}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted">Puestos sin cubrir</div><div className={cx("mt-1 font-display text-2xl font-semibold", missing > 0 && "text-danger")}>{missing}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted">Falta que confirmen</div><div className={cx("mt-1 font-display text-2xl font-semibold", unconfirmed > 0 && "text-warn")}>{unconfirmed}</div></Card>
        </div>
      )}
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {([["proximos", "Próximos"], ["pasados", "Pasados"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
      {isLoading ? <Spinner /> : !list.length ? (
        <Card><EmptyState icon={<CalendarClock className="size-6" />} title={tab === "proximos" ? "No hay turnos próximos" : "Sin turnos pasados"}
          action={tab === "proximos" && !readOnly && <Button variant="accent" onClick={() => setCreating(true)}>Crear turno</Button>}>
          {tab === "proximos" && (workers?.length
            ? "Crea un turno por cada puesto que necesitas (por ejemplo, 6 meseros de 4 p. m. a 11 p. m.) y asigna a tu personal."
            : <>Primero agrega a tu personal en <Link to={workspacePath(ws.kind, ws.id, "m/workforce")} className="font-semibold underline">Personal</Link> (o créalo desde el turno).</>)}
        </EmptyState></Card>
      ) : (
        <div className="space-y-5">
          {days.map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold text-muted first-letter:uppercase">{new Intl.DateTimeFormat(region.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</h2>
              <Card><ul className="divide-y divide-line">
                {items.map((s) => {
                  const as = (assignments ?? []).filter((a) => a.shift_id === s.id);
                  const filled = as.filter((a) => counts(a.status)).length;
                  const pend = as.filter((a) => a.status === "assigned").length;
                  const l = links.label(s);
                  return (
                    <li key={s.id}><Link to={workspacePath(ws.kind, ws.id, `m/shifts/${s.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                      <span className="w-44 whitespace-nowrap text-sm tabular-nums text-muted">{new Intl.DateTimeFormat(region.locale, { hour: "numeric", minute: "2-digit", timeZone: region.timezone }).format(new Date(s.starts_at))} – {new Intl.DateTimeFormat(region.locale, { hour: "numeric", minute: "2-digit", timeZone: region.timezone }).format(new Date(s.ends_at))}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{s.position} <span className="font-normal text-muted">· {plural(s.needed, "persona", "personas")}</span></span>
                        <span className="block truncate text-xs text-muted">{[l?.name, s.location ?? l?.place, as.filter((a) => counts(a.status)).map((a) => workers?.find((w) => w.id === a.worker_id)?.full_name.split(" ")[0]).join(", ")].filter(Boolean).join(" · ") || "Sin personal asignado"}</span>
                      </span>
                      {pend > 0 && <Badge tone="warn">{plural(pend, "por confirmar", "por confirmar")}</Badge>}
                      <Badge tone={filled >= s.needed ? "ok" : filled === 0 ? "danger" : "warn"}>{filled} de {s.needed} cubiertos</Badge>
                    </Link></li>
                  );
                })}
              </ul></Card>
            </section>
          ))}
        </div>
      )}
      {creating && <ShiftDialog shift={null} onClose={() => setCreating(false)} />}
    </div>
  );
}

const nextDayIfBefore = (start: string, end: string, tz: string, date: string) => {
  let e = fromLocalInput(`${date}T${end}`, tz)!;
  if (new Date(e) <= new Date(start)) e = new Date(new Date(e).getTime() + 864e5).toISOString();
  return e;
};

function ShiftDialog({ shift, onClose, duplicate }: { shift: Shift | null; onClose: () => void; duplicate?: boolean }) {
  const { ws, region } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invalidate = useInvalidateStaff();
  const links = useLinks();
  const { data: workers } = useWorkers(ws.id);
  const tz = region.timezone;
  const startLocal = shift ? toLocalInput(shift.starts_at, tz) : "";
  const initialLink = shift?.event_id ? `e:${shift.event_id}` : shift?.rental_id ? `r:${shift.rental_id}` : shift?.booking_id ? `b:${shift.booking_id}`
    : params.get("evento") ? `e:${params.get("evento")}` : params.get("reservacion") ? `r:${params.get("reservacion")}` : params.get("reserva") ? `b:${params.get("reserva")}` : "";
  const [f, setF] = useState({
    link: initialLink, date: duplicate ? "" : startLocal.slice(0, 10), from: startLocal.slice(11, 16) || "16:00", to: shift ? toLocalInput(shift.ends_at, tz).slice(11, 16) : "23:00",
    location: shift?.location ?? "", instructions: shift?.instructions ?? "", custom: shift?.rate != null, pay_type: (shift?.pay_type ?? "shift") as PayType, rate: shift?.rate != null ? String(shift.rate) : "",
    notes: shift?.notes ?? "",
  });
  const [rows, setRows] = useState<{ position: string; needed: string }[]>(shift ? [{ position: shift.position, needed: String(shift.needed) }] : [{ position: "", needed: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const positions = [...new Set([...(workers ?? []).flatMap((w) => w.positions), ...POSITIONS])];
  const linked = f.link ? links.label({ event_id: f.link.startsWith("e:") ? f.link.slice(2) : null, rental_id: f.link.startsWith("r:") ? f.link.slice(2) : null, booking_id: f.link.startsWith("b:") ? f.link.slice(2) : null }) : null;

  // Al elegir un evento/reserva, proponer su fecha y lugar.
  useEffect(() => {
    if (shift && !duplicate) return;
    const id = f.link.slice(2);
    const when = f.link.startsWith("e:") ? links.events.find((e) => e.id === id)?.starts_at : f.link.startsWith("r:") ? links.rentals.find((r) => r.id === id)?.starts_at : f.link.startsWith("b:") ? links.bookings.find((b) => b.id === id)?.starts_at : null;
    if (when && !f.date) set("date", toLocalInput(when, tz).slice(0, 10));
  }, [f.link, links.events.length, links.rentals.length, links.bookings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = rows.map((r) => ({ position: r.position.trim(), needed: Number(r.needed) })).filter((r) => r.position);
    if (!clean.length) return setError("Escribe el puesto (por ejemplo, Mesero).");
    if (clean.some((r) => r.position.length < 2 || !(r.needed >= 1))) return setError("Revisa el puesto y la cantidad de personas.");
    if (!f.date) return setError("Elige la fecha.");
    const starts = fromLocalInput(`${f.date}T${f.from}`, tz)!;
    const ends = nextDayIfBefore(starts, f.to, tz, f.date);
    if (hoursBetween(starts, ends) > 24) return setError("Un turno no puede durar más de 24 horas; crea uno por día.");
    if (f.custom && !(Number(f.rate) >= 0 && f.rate !== "")) return setError("Indica la tarifa especial o quita la opción.");
    const base = {
      event_id: f.link.startsWith("e:") ? f.link.slice(2) : null, rental_id: f.link.startsWith("r:") ? f.link.slice(2) : null, booking_id: f.link.startsWith("b:") ? f.link.slice(2) : null,
      starts_at: starts, ends_at: ends, location: f.location.trim() || null, instructions: f.instructions.trim() || null,
      rate: f.custom ? Number(f.rate) : null, pay_type: f.custom ? f.pay_type : null, notes: f.notes.trim() || null,
    };
    setBusy(true);
    if (shift && !duplicate) {
      const { error: err } = await supabase.from("shifts").update({ ...base, position: clean[0]!.position, needed: clean[0]!.needed }).eq("id", shift.id);
      setBusy(false);
      if (err) return setError(err.message);
      await invalidate();
      return onClose();
    }
    const { data, error: err } = await supabase.from("shifts").insert(clean.map((r) => ({ ...base, ...r, workspace_id: ws.id }))).select("id");
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate();
    onClose();
    const ids = (data as { id: string }[]);
    if (ids.length === 1) navigate(workspacePath(ws.kind, ws.id, `m/shifts/${ids[0]!.id}`));
  }

  return (
    <Dialog open onClose={onClose} title={shift && !duplicate ? "Editar turno" : duplicate ? "Duplicar turno" : "Nuevo turno"} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="shift-form" variant="accent" loading={busy}>{shift && !duplicate ? "Guardar" : rows.length > 1 ? `Crear ${rows.length} turnos` : "Crear turno"}</Button></>}>
      <form id="shift-form" onSubmit={submit} className="space-y-4">
        {(links.hasEvents || links.hasRentals || links.hasBookings) && (
          <Field label="¿Para qué es?" optional>{(id) => <Select id={id} value={f.link} onChange={(e) => set("link", e.target.value)}>
            <option value="">Trabajo interno (sin evento)</option>
            {links.events.length > 0 && <optgroup label="Eventos">{links.events.filter((e) => e.status !== "canceled").map((e) => <option key={e.id} value={`e:${e.id}`}>{e.name}</option>)}</optgroup>}
            {links.rentals.length > 0 && <optgroup label="Reservaciones de alquiler">{links.rentals.map((r) => <option key={r.id} value={`r:${r.id}`}>{docNumber("RES", r.number)} · {r.title}</option>)}</optgroup>}
            {links.bookings.length > 0 && <optgroup label="Reservas de salón">{links.bookings.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.title}</option>)}</optgroup>}
          </Select>}</Field>
        )}
        <div>
          <div className="mb-1.5 text-sm font-medium">{shift && !duplicate ? "Puesto y personas" : "Puestos que necesitas"}</div>
          <datalist id="positions-list">{positions.map((p) => <option key={p} value={p} />)}</datalist>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2">
                <Input list="positions-list" value={r.position} onChange={(e) => setRows((x) => x.map((y, j) => j === i ? { ...y, position: e.target.value } : y))} placeholder="Puesto: Mesero, Montaje, Chofer…" aria-label="Puesto" autoFocus={!shift && i === 0} />
                <label className="flex items-center gap-1.5 text-sm text-muted"><Input type="number" min="1" max="200" value={r.needed} onChange={(e) => setRows((x) => x.map((y, j) => j === i ? { ...y, needed: e.target.value } : y))} aria-label="Cuántas personas" className="text-right" />pers.</label>
                {rows.length > 1 ? <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted hover:text-danger" aria-label="Quitar puesto"><X className="size-4" /></button> : <span className="w-7" />}
              </div>
            ))}
          </div>
          {(!shift || duplicate) && <Button type="button" size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setRows((x) => [...x, { position: "", needed: "1" }])}>Otro puesto con el mismo horario</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fecha">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />}</Field>
          <Field label="Hora de llegada">{(id) => <Input id={id} type="time" value={f.from} onChange={(e) => set("from", e.target.value)} />}</Field>
          <Field label="Hora de salida" hint={f.to <= f.from ? "Termina al día siguiente." : undefined}>{(id, d) => <Input id={id} aria-describedby={d} type="time" value={f.to} onChange={(e) => set("to", e.target.value)} />}</Field>
        </div>
        <Field label="Lugar" optional>{(id) => <Input id={id} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={linked?.place ?? "Dirección o nombre del lugar"} />}</Field>
        <Field label="Instrucciones para el personal" optional hint="Lo verán en su mensaje: uniforme, qué llevar, a quién buscar al llegar.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} className="min-h-16" placeholder="Camisa blanca, pantalón y zapatos negros. Preguntar por Carlos en la entrada de servicio." />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.custom} onChange={(e) => set("custom", e.target.checked)} className="size-4 accent-ink" />Este turno se paga distinto a la tarifa de cada persona</label>
        {f.custom && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cómo se paga">{(id) => <Select id={id} value={f.pay_type} onChange={(e) => set("pay_type", e.target.value as PayType)}>{(Object.keys(PAY_TYPES) as PayType[]).map((k) => <option key={k} value={k}>{PAY_TYPES[k].label}</option>)}</Select>}</Field>
          <Field label={`Tarifa ${PAY_TYPES[f.pay_type].per}`} hint="En la moneda de cada persona.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min="0" step="0.01" value={f.rate} onChange={(e) => set("rate", e.target.value)} />}</Field>
        </div>}
        <Field label="Notas internas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-14" />}</Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

function ShiftDetail({ id }: { id: string }) {
  const { ws, region, readOnly } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateStaff();
  const { data: shifts, isLoading } = useShifts(ws.id);
  const { data: assignments } = useAssignments(ws.id);
  const { data: workers } = useWorkers(ws.id);
  const cands = useCandidates(id);
  const links = useLinks();
  const [dialog, setDialog] = useState<"edit" | "dup" | "new-worker" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const s = shifts?.find((x) => x.id === id);
  if (isLoading || !shifts) return <Spinner />;
  if (!s) return <EmptyState title="Turno no encontrado">Puede que se haya eliminado. <Link to={workspacePath(ws.kind, ws.id, "m/shifts")} className="underline">Volver a turnos</Link></EmptyState>;
  const shift = s;
  const tz = region.timezone;
  const as = (assignments ?? []).filter((a) => a.shift_id === shift.id).sort((a, b) => Number(counts(b.status)) - Number(counts(a.status)));
  const filled = as.filter((a) => counts(a.status)).length;
  const full = filled >= shift.needed;
  const l = links.label(shift);
  const place = shift.location ?? l?.place ?? null;
  const when = scheduleText(shift.starts_at, shift.ends_at, tz, region.locale);
  const started = new Date(shift.starts_at).getTime() <= Date.now();
  const cost = as.reduce<Record<string, number>>((acc, a) => { acc[a.currency_code] = (acc[a.currency_code] ?? 0) + Number(a.pay_amount); return acc; }, {});
  const worker = (wid: string) => workers?.find((w) => w.id === wid);
  const available = (cands.data ?? []).filter((c) => !c.assigned && (!q || c.full_name.toLowerCase().includes(q.toLowerCase())));

  async function refresh() { await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ["shift-candidates", id] })]); }
  async function assign(workerId: string) {
    setError(null);
    const { error: err } = await supabase.from("shift_assignments").insert({ workspace_id: ws.id, shift_id: shift.id, worker_id: workerId });
    if (err) return setError(err.message);
    // Su enlace personal para que confirme desde WhatsApp
    if (!worker(workerId)?.portal_token) await supabase.rpc("worker_portal_link", { p_worker: workerId, p_renew: false });
    await refresh();
  }
  async function update(a: Assignment, patch: Partial<Assignment>) {
    setError(null);
    const { error: err } = await supabase.from("shift_assignments").update(patch).eq("id", a.id);
    if (err) setError(err.message);
    await refresh();
  }
  async function unassign(a: Assignment) {
    if (!confirm(`¿Quitar a ${worker(a.worker_id)?.full_name} de este turno?`)) return;
    const { error: err } = await supabase.from("shift_assignments").delete().eq("id", a.id);
    if (err) return setError(err.message);
    await refresh();
  }
  async function remove() {
    if (!confirm(as.length ? `Este turno tiene ${plural(as.length, "persona asignada", "personas asignadas")}. ¿Eliminarlo de todos modos?` : "¿Eliminar este turno?")) return;
    const { error: err } = await supabase.from("shifts").delete().eq("id", shift.id);
    if (err) return setError(err.message);
    qc.removeQueries({ queryKey: ["shift-candidates", id] });
    navigate(workspacePath(ws.kind, ws.id, "m/shifts"));
    await invalidate();
  }
  function message(a: Assignment) {
    const w = worker(a.worker_id);
    if (!w) return "";
    return shiftMessage({ name: w.full_name, business: ws.name, position: shift.position, when, place, event: l?.name ?? null, instructions: shift.instructions,
      pay: Number(a.pay_amount) > 0 ? formatMoney(Number(a.pay_amount), a.currency_code, region.locale) : null, link: w.portal_token ? workerPortalUrl(w.portal_token) : null });
  }
  function copyList() {
    const text = [`*${shift.position}* · ${when}${l ? `\n${l.name}` : ""}${place ? `\n📍 ${place}` : ""}`, "",
      ...as.filter((a) => counts(a.status)).map((a, i) => `${i + 1}. ${worker(a.worker_id)?.full_name}${worker(a.worker_id)?.phone ? ` · ${worker(a.worker_id)?.phone}` : ""} (${ASSIGNMENT_STATUS[a.status].label.toLowerCase()})`),
      shift.instructions ? `\n📝 ${shift.instructions}` : ""].join("\n");
    void navigator.clipboard.writeText(text.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  const timeOf = (iso: string | null) => (iso ? toLocalInput(iso, tz).slice(11, 16) : "");
  const atTime = (t: string, ref: string) => {
    if (!t) return null;
    const startDate = toLocalInput(shift.starts_at, tz).slice(0, 10);
    let v = fromLocalInput(`${startDate}T${t}`, tz)!;
    // Una hora "antes" de la llegada programada (menos 6 h) se toma como del día siguiente (turnos que pasan la medianoche).
    if (new Date(v).getTime() < new Date(ref).getTime() - 6 * 36e5) v = new Date(new Date(v).getTime() + 864e5).toISOString();
    return v;
  };

  return (
    <div className="animate-rise">
      <Link to={workspacePath(ws.kind, ws.id, "m/shifts")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Turnos</Link>
      <PageHeader title={`${shift.position} · ${shift.needed} ${shift.needed === 1 ? "persona" : "personas"}`}
        description={<span className="flex flex-col gap-0.5"><span className="first-letter:uppercase">{when}</span>
          {l && <Link to={workspacePath(ws.kind, ws.id, l.to)} className="hover:underline">{l.name}</Link>}
          {place && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{place}</span>}</span>}
        actions={<>
          {as.length > 0 && <Button variant="secondary" icon={copied ? <CheckCircle2 className="size-4" /> : <ClipboardCopy className="size-4" />} onClick={copyList}>{copied ? "Copiada" : "Copiar lista"}</Button>}
          {!readOnly && <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => setDialog("dup")}>Duplicar</Button>}
          {!readOnly && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setDialog("edit")}>Editar</Button>}
        </>} />
      {error && <div className="mb-4"><Alert tone="danger" onClose={() => setError(null)}>{error}</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title={full ? "Turno cubierto" : `Faltan ${shift.needed - filled} de ${shift.needed}`}
            description={started ? "Marca quién llegó y a qué hora: el pago se calcula solo." : "Envía a cada persona su turno por WhatsApp; con su enlace confirma si puede ir."}
            action={Object.keys(cost).length > 0 && <div className="text-right"><div className="text-xs text-muted">Costo del personal</div><div className="font-semibold tabular-nums">{Object.entries(cost).map(([c, n]) => formatMoney(n, c, region.locale)).join(" + ")}</div></div>} />
          <div className="h-1.5 bg-line"><div className={cx("h-full", full ? "bg-ok" : "bg-warn")} style={{ width: `${Math.min(100, (filled / shift.needed) * 100)}%` }} /></div>
          {!as.length ? <p className="p-5 text-sm text-muted">Nadie asignado todavía. Elige a las personas en la lista {window.innerWidth < 1024 ? "de abajo" : "de la derecha"}.</p> : (
            <ul className="divide-y divide-line">
              {as.map((a) => {
                const w = worker(a.worker_id);
                const paid = !!a.payout_id;
                return (
                  <li key={a.id} className={cx("space-y-2 px-4 py-3 sm:px-5", !counts(a.status) && "bg-paper/60")}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1"><span className="block font-medium">{w?.full_name}</span>
                        <span className="block text-xs text-muted">{[w?.phone, `${formatMoney(Number(a.rate), a.currency_code, region.locale)} ${PAY_TYPES[a.pay_type].per}`].filter(Boolean).join(" · ")}</span></span>
                      {paid ? <Badge tone="ok">Pagado</Badge> : (
                        <Select value={a.status} disabled={readOnly} onChange={(e) => void update(a, { status: e.target.value as AssignmentStatus })} className="h-9 w-40 text-sm" aria-label={`Estado de ${w?.full_name}`}>
                          {(Object.keys(ASSIGNMENT_STATUS) as AssignmentStatus[]).filter((k) => started || (k !== "attended" && k !== "absent")).map((k) => <option key={k} value={k}>{ASSIGNMENT_STATUS[k].label}</option>)}
                        </Select>
                      )}
                      {w?.phone && !started && <a href={`https://wa.me/${waNumber(w.phone)}?text=${encodeURIComponent(message(a))}`} target="_blank" rel="noreferrer" title="Enviar su turno por WhatsApp"
                        className="rounded-lg p-2 text-[#1f8b4c] hover:bg-ink/5" aria-label={`Enviar turno a ${w.full_name} por WhatsApp`}><MessageCircle className="size-4" /></a>}
                      {!readOnly && !paid && <button onClick={() => void unassign(a)} className="rounded-lg p-2 text-muted hover:text-danger" aria-label={`Quitar a ${w?.full_name}`}><Trash2 className="size-4" /></button>}
                    </div>
                    {started && counts(a.status) && (
                      <div className="flex flex-wrap items-end gap-2 text-sm">
                        <label className="text-xs text-muted">Entrada<Input type="time" defaultValue={timeOf(a.check_in)} disabled={readOnly || paid} className="h-9 w-32"
                          onBlur={(e) => { const v = atTime(e.target.value, shift.starts_at); if (v !== a.check_in) void update(a, { check_in: v, status: "attended" }); }} /></label>
                        <label className="text-xs text-muted">Salida<Input type="time" defaultValue={timeOf(a.check_out)} disabled={readOnly || paid} className="h-9 w-32"
                          onBlur={(e) => { const v = atTime(e.target.value, a.check_in ?? shift.starts_at); if (v !== a.check_out) void update(a, { check_out: v, status: "attended" }); }} /></label>
                        <label className="text-xs text-muted">Extras<Input type="number" min="0" step="0.01" defaultValue={Number(a.extras) || ""} disabled={readOnly || paid} className="h-9 w-24 text-right" placeholder="0"
                          onBlur={(e) => { const v = Number(e.target.value || 0); if (v !== Number(a.extras)) void update(a, { extras: v }); }} /></label>
                        <label className="min-w-32 flex-1 text-xs text-muted">Motivo de extras<Input defaultValue={a.extras_note ?? ""} disabled={readOnly || paid} className="h-9" placeholder="Horas extra, transporte…"
                          onBlur={(e) => { if ((e.target.value || null) !== a.extras_note) void update(a, { extras_note: e.target.value.trim() || null }); }} /></label>
                        <span className="ml-auto text-right"><span className="block text-xs text-muted">{a.check_in && a.check_out ? hoursText(hoursBetween(a.check_in, a.check_out)) : "A pagar"}</span>
                          <span className="font-semibold tabular-nums">{formatMoney(Number(a.pay_amount), a.currency_code, region.locale)}</span></span>
                      </div>
                    )}
                    {!started && counts(a.status) && <div className="text-xs text-muted">A pagar: <span className="font-semibold text-ink">{formatMoney(Number(a.pay_amount), a.currency_code, region.locale)}</span>{a.responded_at && a.status === "confirmed" ? " · confirmó desde su enlace o contigo" : ""}</div>}
                  </li>
                );
              })}
            </ul>
          )}
          {shift.instructions && <div className="border-t border-line px-5 py-3 text-sm"><span className="font-medium">Instrucciones:</span> <span className="text-muted">{shift.instructions}</span></div>}
          {!readOnly && <div className="flex justify-end border-t border-line p-3"><Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar turno</Button></div>}
        </Card>

        {!readOnly && (
          <Card className="self-start">
            <CardHeader title="Asignar personal" description={full ? "El turno ya está completo. Aumenta la cantidad en Editar si necesitas más." : "Primero salen quienes cubren este puesto y están libres."} />
            <div className="space-y-2 p-3">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona" className="h-9" aria-label="Buscar persona" />
              <Button size="sm" variant="secondary" className="w-full" icon={<UserPlus className="size-4" />} onClick={() => setDialog("new-worker")}>Persona nueva</Button>
            </div>
            {cands.isLoading ? <Spinner /> : !available.length ? <p className="px-4 pb-4 text-sm text-muted">{(cands.data ?? []).length ? "Ya asignaste a todo tu personal disponible." : "Aún no tienes personal: agrega a alguien con “Persona nueva”."}</p> : (
              <ul className="max-h-[480px] divide-y divide-line overflow-y-auto border-t border-line">
                {available.map((c) => (
                  <li key={c.worker_id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.full_name}</span>
                      {c.conflict ? <span className="flex items-start gap-1 text-xs text-danger"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{c.conflict}</span>
                        : <span className="block truncate text-xs text-muted">{c.matches ? "" : `Puestos: ${c.positions.join(", ") || "—"} · `}{formatMoney(estimatePay(c.pay_type, Number(c.rate), shift.starts_at, shift.ends_at), c.currency_code, region.locale)} este turno</span>}
                    </span>
                    <Button size="sm" variant={c.matches ? "accent" : "secondary"} disabled={!!c.conflict || full} onClick={() => void assign(c.worker_id)}>Asignar</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
      {dialog === "edit" && <ShiftDialog shift={shift} onClose={() => setDialog(null)} />}
      {dialog === "dup" && <ShiftDialog shift={shift} duplicate onClose={() => setDialog(null)} />}
      {dialog === "new-worker" && <QuickWorkerDialog position={shift.position} onClose={() => setDialog(null)} onCreated={(wid) => { setDialog(null); void assign(wid); }} />}
    </div>
  );
}

/** Crear una persona sin salir del turno; queda asignada al guardar. */
function QuickWorkerDialog({ position, onClose, onCreated }: { position: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateStaff();
  const [f, setF] = useState({ full_name: "", phone: "", pay_type: "shift" as PayType, rate: "", currency_code: region.currency_code });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (f.full_name.trim().length < 2) return setError("Escribe el nombre completo.");
    if (f.rate === "" || !(Number(f.rate) >= 0)) return setError("Indica cuánto se le paga.");
    setBusy(true);
    const { data, error: err } = await supabase.from("workers").insert({ workspace_id: ws.id, full_name: f.full_name.trim(), phone: f.phone.trim() || null, positions: [position],
      pay_type: f.pay_type, rate: Number(f.rate), currency_code: f.currency_code }).select("id").single();
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate();
    onCreated((data as { id: string }).id);
  }
  return (
    <Dialog open onClose={onClose} title={`Nueva persona · ${position}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="quick-worker" variant="accent" loading={busy}>Crear y asignar</Button></>}>
      <form id="quick-worker" onSubmit={submit} className="space-y-3">
        <Field label="Nombre completo">{(id) => <Input id={id} value={f.full_name} onChange={(e) => setF((s) => ({ ...s, full_name: e.target.value }))} autoFocus />}</Field>
        <Field label="Teléfono / WhatsApp" optional>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} />}</Field>
        <div className="grid grid-cols-[1fr_1fr_130px] gap-2">
          <Field label="Se le paga">{(id) => <Select id={id} value={f.pay_type} onChange={(e) => setF((s) => ({ ...s, pay_type: e.target.value as PayType }))}>{(Object.keys(PAY_TYPES) as PayType[]).map((k) => <option key={k} value={k}>{PAY_TYPES[k].label}</option>)}</Select>}</Field>
          <Field label="Tarifa">{(id) => <Input id={id} type="number" min="0" step="0.01" value={f.rate} onChange={(e) => setF((s) => ({ ...s, rate: e.target.value }))} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => setF((s) => ({ ...s, currency_code: e.target.value }))}><option value="NIO">C$</option><option value="USD">US$</option></Select>}</Field>
        </div>
        <p className="text-xs text-muted">Después puedes completar sus datos en Personal.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

