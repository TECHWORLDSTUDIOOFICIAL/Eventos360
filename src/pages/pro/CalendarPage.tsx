import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { fromLocalInput, toLocalInput, useEvents } from "@/lib/events";
import { CALENDAR_KIND, type CalendarItem } from "@/lib/pro";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, Dialog, Field, Input, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { CustomerSelect } from "@/components/QuickCreate";

interface Entry { id: string; date: string; time: string; title: string; color: string; href?: string; item?: CalendarItem; conflict?: boolean; kind: string; end?: number; start?: number }

/** "YYYY-MM-DD" y "HH:mm" de una fecha en la zona del espacio. */
function localParts(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export default function CalendarPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data: events } = useEvents(ws.id);
  const items = useQuery({
    queryKey: ["calendar-items", ws.id],
    queryFn: async () => unwrap<CalendarItem[]>(await supabase.from("calendar_items").select("*").eq("workspace_id", ws.id).order("starts_at")),
  });
  const followups = useQuery({
    queryKey: ["followups", ws.id],
    queryFn: async () => unwrap<{ id: string; customer_id: string; body: string; follow_up_on: string }[]>(
      await supabase.from("customer_activities").select("id, customer_id, body, follow_up_on").eq("workspace_id", ws.id).eq("done", false).not("follow_up_on", "is", null)),
  });
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [editing, setEditing] = useState<CalendarItem | { date: string } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const e of events ?? []) {
      if (!e.starts_at || e.status === "canceled") continue;
      const p = localParts(e.starts_at, region.timezone);
      const start = new Date(e.starts_at).getTime();
      out.push({ id: `e${e.id}`, date: p.date, time: p.time, title: e.name, color: "var(--accent)", href: base(`m/events/${e.id}`), kind: "event",
        start, end: e.ends_at ? new Date(e.ends_at).getTime() : start + 6 * 3_600_000 });
    }
    for (const it of items.data ?? []) {
      const p = localParts(it.starts_at, region.timezone);
      out.push({ id: `c${it.id}`, date: p.date, time: p.time, title: it.title, color: CALENDAR_KIND[it.kind].color, item: it, kind: it.kind });
    }
    for (const f of followups.data ?? []) {
      out.push({ id: `f${f.id}`, date: f.follow_up_on, time: "", title: `Seguimiento: ${f.body.slice(0, 40)}`, color: "#a35f00", href: base(`m/customers/${f.customer_id}`), kind: "followup" });
    }
    // Conflictos: eventos que se superponen en el tiempo
    const evs = out.filter((x) => x.kind === "event");
    for (const a of evs) for (const b of evs) if (a !== b && a.start! < b.end! && b.start! < a.end!) a.conflict = true;
    return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, [events, items.data, followups.data, region.timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // lunes = 0
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstDow + days) / 7) * 7 }, (_, i) => {
    const d = i - firstDow + 1;
    return d >= 1 && d <= days ? `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  });
  const today = localParts(new Date().toISOString(), region.timezone).date;
  const byDay = (d: string) => entries.filter((x) => x.date === d);
  const monthRaw = new Intl.DateTimeFormat(region.locale, { month: "long", year: "numeric" }).format(cursor);
  const monthLabel = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);   // "Noviembre de 2026"
  const conflicts = entries.filter((x) => x.conflict && x.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`));
  const upcoming = entries.filter((x) => x.date >= today).slice(0, 8);
  const dayList = selectedDay ? byDay(selectedDay) : [];

  return (
    <div className="animate-rise">
      <PageHeader title="Calendario" description="Eventos, reuniones, entregas, cobros y seguimientos en un solo lugar."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing({ date: selectedDay ?? today })}>Agregar</Button>} />
      {conflicts.length > 0 && <div className="mb-4"><Alert tone="warn" title="Choques de fecha este mes">{[...new Set(conflicts.map((c) => c.title))].join(" · ")}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-lg p-2 hover:bg-ink/5" aria-label="Mes anterior"><ChevronLeft className="size-5" /></button>
            <div className="font-display text-xl font-semibold">{monthLabel}</div>
            <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-lg p-2 hover:bg-ink/5" aria-label="Mes siguiente"><ChevronRight className="size-5" /></button>
          </div>
          <div className="grid grid-cols-7 border-b border-line bg-paper text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const list = d ? byDay(d) : [];
              return (
                <button key={i} disabled={!d} onClick={() => d && setSelectedDay(d)}
                  className={cx("min-h-16 border-b border-r border-line p-1 text-left align-top sm:min-h-24 sm:p-1.5", !d && "bg-paper/50", d === selectedDay && "bg-[var(--accent-soft)]")}>
                  {d && <>
                    <div className={cx("mb-1 grid size-6 place-items-center rounded-full text-xs font-semibold", d === today ? "bg-ink text-paper" : "text-ink-soft")}>{Number(d.slice(8))}</div>
                    <div className="space-y-0.5">
                      {list.slice(0, 3).map((x) => (
                        <div key={x.id} className="truncate rounded px-1 py-0.5 text-[10px] font-medium text-white sm:text-[11px]" style={{ background: x.color }}>
                          {x.conflict && "⚠ "}{x.time && <span className="hidden sm:inline">{x.time} </span>}{x.title}
                        </div>
                      ))}
                      {list.length > 3 && <div className="px-1 text-[10px] text-muted">+{list.length - 3} más</div>}
                    </div>
                  </>}
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="border-b border-line px-4 py-3 font-semibold">{selectedDay ? new Intl.DateTimeFormat(region.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${selectedDay}T12:00:00Z`)) : "Próximos"}</div>
            <EntryList list={selectedDay ? dayList : upcoming} showDate={!selectedDay} onEdit={(it) => setEditing(it)} />
            {selectedDay && !readOnly && <div className="border-t border-line p-3"><Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ date: selectedDay })}>Agregar en este día</Button></div>}
          </Card>
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-[var(--accent)]" />Evento</span>
            {Object.entries(CALENDAR_KIND).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: v.color }} />{v.label}</span>)}
            <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warn" />Seguimiento</span>
          </div>
        </div>
      </div>
      {editing && <ItemDialog item={"id" in editing ? editing : null} date={"date" in editing ? editing.date : undefined} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EntryList({ list, showDate, onEdit }: { list: Entry[]; showDate: boolean; onEdit: (it: CalendarItem) => void }) {
  const { readOnly } = useWorkspace();
  if (!list.length) return <p className="px-4 py-6 text-sm text-muted">Nada programado.</p>;
  return (
    <ul className="divide-y divide-line">
      {list.map((x) => {
        const body = (
          <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{x.conflict && <AlertTriangle className="mr-1 inline size-3.5 text-warn" />}{x.title}</div>
              <div className="text-xs text-muted">{showDate && new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${x.date}T12:00:00Z`))}{showDate && x.time && " · "}{x.time}</div>
            </div>
          </div>
        );
        return (
          <li key={x.id}>
            {x.href ? <Link to={x.href} className="block hover:bg-paper">{body}</Link>
              : x.item && !readOnly ? <button className="block w-full text-left hover:bg-paper" onClick={() => onEdit(x.item!)}>{body}</button> : body}
          </li>
        );
      })}
    </ul>
  );
}

function ItemDialog({ item, date, onClose }: { item: CalendarItem | null; date?: string; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const qc = useQueryClient();
  const { data: events } = useEvents(ws.id);
  const [f, setF] = useState({
    kind: item?.kind ?? "meeting", title: item?.title ?? "", starts_at: item ? toLocalInput(item.starts_at, region.timezone) : `${date}T10:00`,
    ends_at: item?.ends_at ? toLocalInput(item.ends_at, region.timezone) : "", customer_id: item?.customer_id ?? "", event_id: item?.event_id ?? "",
    location: item?.location ?? "", notes: item?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim() || !f.starts_at) return setError("Escribe el título y la fecha.");
    setBusy(true);
    const row = { kind: f.kind, title: f.title.trim(), starts_at: fromLocalInput(f.starts_at, region.timezone), ends_at: fromLocalInput(f.ends_at, region.timezone),
      customer_id: f.customer_id || null, event_id: f.event_id || null, location: f.location.trim() || null, notes: f.notes.trim() || null };
    const res = item ? await supabase.from("calendar_items").update(row).eq("id", item.id) : await supabase.from("calendar_items").insert({ ...row, workspace_id: ws.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await qc.invalidateQueries({ queryKey: ["calendar-items", ws.id] });
    onClose();
  }
  async function remove() {
    if (!item || !confirm(`¿Eliminar "${item.title}"?`)) return;
    await supabase.from("calendar_items").delete().eq("id", item.id);
    await qc.invalidateQueries({ queryKey: ["calendar-items", ws.id] });
    onClose();
  }
  return (
    <Dialog open onClose={onClose} title={item ? "Editar actividad" : "Nueva actividad"} wide
      footer={<>
        {item && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="cal-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="cal-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo">{(id) => <Select id={id} value={f.kind} onChange={(e) => set("kind", e.target.value)}>{Object.entries(CALENDAR_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
        <Field label="Título">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej. Degustación del menú" autoFocus />}</Field>
        <Field label="Inicio">{(id) => <Input id={id} type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} />}</Field>
        <Field label="Fin" optional>{(id) => <Input id={id} type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} />}</Field>
        <Field label="Cliente" optional>{(id) => <CustomerSelect id={id} value={f.customer_id} onChange={(v) => set("customer_id", v)} emptyLabel="—" />}</Field>
        <Field label="Evento" optional>{(id) => <Select id={id} value={f.event_id} onChange={(e) => set("event_id", e.target.value)}><option value="">—</option>{(events ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}</Select>}</Field>
        <div className="sm:col-span-2"><Field label="Lugar" optional>{(id) => <Input id={id} value={f.location} onChange={(e) => set("location", e.target.value)} />}</Field></div>
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
