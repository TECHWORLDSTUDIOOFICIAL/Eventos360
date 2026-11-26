import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useInvalidateEvent, type EventRow } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Alert, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Textarea } from "@/components/ui";

interface ScheduleItem { id: string; start_time: string; duration_min: number | null; title: string; responsible: string | null; notes: string | null }

export default function SchedulePage() {
  return <EventGate>{(ctx) => <Schedule {...ctx} />}</EventGate>;
}

const hhmm = (t: string) => t.slice(0, 5);
function endTime(t: string, min: number | null) {
  if (!min) return null;
  const [h, m] = t.split(":").map(Number) as [number, number];
  const total = (h * 60 + m + min) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function Schedule({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { readOnly } = useWorkspace();
  const [editing, setEditing] = useState<ScheduleItem | "new" | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["schedule", event.id],
    queryFn: async () => unwrap<ScheduleItem[]>(await supabase.from("event_schedule_items").select("*").eq("event_id", event.id).order("start_time")),
  });

  return (
    <div className="animate-rise">
      <PageHeader title="Cronograma" description="El minuto a minuto del gran día: qué pasa, a qué hora y quién se encarga."
        actions={<>
          <EventSwitcher events={events} current={event} onSelect={select} />
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agregar actividad</Button>}
        </>} />
      {isLoading ? <Spinner /> : !data?.length ? (
        <Card><EmptyState icon={<Clock className="size-6" />} title="Tu cronograma está vacío"
          action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Agregar actividad</Button>}>
          Ejemplo: 7:00 p. m. Recepción · 8:00 p. m. Entrada de los novios · 8:30 p. m. Cena.
        </EmptyState></Card>
      ) : (
        <Card className="p-2 sm:p-4">
          <ol className="relative">
            {data.map((it, i) => (
              <li key={it.id} className="relative flex gap-4 pb-5 pl-2 last:pb-1">
                {i < data.length - 1 && <span className="absolute left-[4.6rem] top-9 h-[calc(100%-1.5rem)] w-px bg-line" aria-hidden />}
                <div className="w-16 shrink-0 pt-2 text-right font-display text-lg font-semibold tabular-nums">{hhmm(it.start_time)}</div>
                <span className="relative z-10 mt-3.5 size-3 shrink-0 rounded-full border-2 border-[var(--accent)] bg-card" aria-hidden />
                <div className="min-w-0 flex-1 rounded-xl px-3 py-2 hover:bg-paper">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{it.title}</div>
                      <div className="text-xs text-muted">{[endTime(it.start_time, it.duration_min) && `hasta ${endTime(it.start_time, it.duration_min)}`, it.responsible && `Responsable: ${it.responsible}`].filter(Boolean).join(" · ")}</div>
                      {it.notes && <p className="mt-1 text-sm text-ink-soft">{it.notes}</p>}
                    </div>
                    {!readOnly && <button onClick={() => setEditing(it)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label={`Editar ${it.title}`}><Pencil className="size-4" /></button>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {editing && <ItemDialog event={event} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ItemDialog({ event, item, onClose }: { event: EventRow; item: ScheduleItem | null; onClose: () => void }) {
  const { ws } = useWorkspace();
  const invalidate = useInvalidateEvent();
  const [f, setF] = useState({ start_time: item ? hhmm(item.start_time) : "", duration_min: String(item?.duration_min ?? ""), title: item?.title ?? "", responsible: item?.responsible ?? "", notes: item?.notes ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.start_time || !f.title.trim()) return setError("Indica la hora y la actividad.");
    setBusy(true);
    const row = { start_time: f.start_time, duration_min: f.duration_min ? Number(f.duration_min) : null, title: f.title.trim(), responsible: f.responsible.trim() || null, notes: f.notes.trim() || null };
    const res = item ? await supabase.from("event_schedule_items").update(row).eq("id", item.id)
      : await supabase.from("event_schedule_items").insert({ ...row, workspace_id: ws.id, event_id: event.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate(event.id, "schedule");
    onClose();
  }
  async function remove() {
    if (!item || !confirm(`¿Eliminar "${item.title}"?`)) return;
    const { error: err } = await supabase.from("event_schedule_items").delete().eq("id", item.id);
    if (err) return setError(err.message);
    await invalidate(event.id, "schedule");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={item ? "Editar actividad" : "Agregar actividad"}
      footer={<>
        {item && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="schedule-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="schedule-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Hora">{(id) => <Input id={id} type="time" value={f.start_time} onChange={(e) => set("start_time", e.target.value)} />}</Field>
        <Field label="Duración (minutos)" optional>{(id) => <Input id={id} type="number" min={1} max={1440} value={f.duration_min} onChange={(e) => set("duration_min", e.target.value)} />}</Field>
        <div className="sm:col-span-2"><Field label="Actividad">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej. Vals" />}</Field></div>
        <div className="sm:col-span-2"><Field label="Responsable" optional>{(id) => <Input id={id} value={f.responsible} onChange={(e) => set("responsible", e.target.value)} />}</Field></div>
        <div className="sm:col-span-2"><Field label="Observaciones" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
