import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useInvalidateEvent, type EventRow } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

interface TaskRow { id: string; title: string; description: string | null; due_date: string | null; priority: "low" | "medium" | "high"; status: "todo" | "doing" | "done"; completed_at: string | null }

const PRIORITY = { high: { l: "Alta", t: "danger" as const }, medium: { l: "Media", t: "warn" as const }, low: { l: "Baja", t: "neutral" as const } };
const STATUS = { todo: "Pendiente", doing: "En curso", done: "Hecha" };

/** Sugerencias para empezar (solo se crean si el usuario lo pide). */
const SUGGESTED = ["Definir presupuesto", "Reservar el lugar", "Armar la lista de invitados", "Contratar fotografía", "Elegir el menú", "Enviar invitaciones", "Confirmar proveedores una semana antes"];

export default function TasksPage() {
  return <EventGate>{(ctx) => <Tasks {...ctx} />}</EventGate>;
}

function Tasks({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { ws, readOnly } = useWorkspace();
  const invalidate = useInvalidateEvent();
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [editing, setEditing] = useState<TaskRow | "new" | null>(null);
  const [quick, setQuick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", event.id],
    queryFn: async () => unwrap<TaskRow[]>(await supabase.from("event_tasks").select("*").eq("event_id", event.id)
      .order("status").order("due_date", { ascending: true, nullsFirst: false }).order("created_at")),
  });
  const all = data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const list = useMemo(() => all.filter((t) => filter === "all" || (filter === "done" ? t.status === "done" : t.status !== "done")), [all, filter]);
  const done = all.filter((t) => t.status === "done").length;

  async function refresh() { await Promise.all([invalidate(event.id, "tasks"), invalidate(event.id, "home-tasks")]); }
  async function toggle(t: TaskRow) {
    const { error: err } = await supabase.from("event_tasks").update({ status: t.status === "done" ? "todo" : "done" }).eq("id", t.id);
    if (err) return setError(err.message);
    await refresh();
  }
  async function addQuick(e: FormEvent) {
    e.preventDefault();
    if (!quick.trim()) return;
    const { error: err } = await supabase.from("event_tasks").insert({ workspace_id: ws.id, event_id: event.id, title: quick.trim() });
    if (err) return setError(err.message);
    setQuick("");
    await refresh();
  }
  async function addSuggested() {
    const { error: err } = await supabase.from("event_tasks").insert(SUGGESTED.map((title) => ({ workspace_id: ws.id, event_id: event.id, title })));
    if (err) return setError(err.message);
    await refresh();
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Tareas" description={all.length ? `${done} de ${all.length} completadas` : event.name}
        actions={<>
          <EventSwitcher events={events} current={event} onSelect={select} />
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nueva tarea</Button>}
        </>} />
      {all.length > 0 && (
        <div className="mb-5 h-2 rounded-full bg-ink/6"><div className="h-2 rounded-full bg-[var(--accent)] transition-all" style={{ width: `${Math.round((done / all.length) * 100)}%` }} /></div>
      )}
      {error && <div className="mb-4"><Alert tone="danger" onClose={() => setError(null)}>{error}</Alert></div>}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {(["open", "done", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cx("rounded-full px-3 py-1.5 text-sm font-medium", filter === f ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5")}>
              {f === "open" ? "Pendientes" : f === "done" ? "Hechas" : "Todas"}
            </button>
          ))}
          {!readOnly && (
            <form onSubmit={addQuick} className="ml-auto flex min-w-60 flex-1 gap-2 sm:flex-none">
              <Input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Agregar tarea rápida…" className="h-9" aria-label="Nueva tarea" />
              <Button type="submit" size="sm" variant="secondary" disabled={!quick.trim()}>Agregar</Button>
            </form>
          )}
        </div>
        {isLoading ? <Spinner /> : !all.length ? (
          <EmptyState icon={<ListChecks className="size-6" />} title="Sin tareas todavía"
            action={!readOnly && <Button variant="secondary" onClick={() => void addSuggested()}>Agregar tareas sugeridas</Button>}>
            Anota todo lo que falta por hacer, con fecha límite y prioridad.
          </EmptyState>
        ) : !list.length ? <p className="px-5 py-8 text-center text-sm text-muted">No hay tareas en esta vista.</p> : (
          <ul className="divide-y divide-line">
            {list.map((t) => {
              const overdue = t.status !== "done" && t.due_date && t.due_date < today;
              return (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <button onClick={() => void toggle(t)} disabled={readOnly} aria-label={t.status === "done" ? `Marcar "${t.title}" como pendiente` : `Completar "${t.title}"`}
                    className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition",
                      t.status === "done" ? "border-ok bg-ok text-white" : "border-line-strong hover:border-[var(--accent)]")}>
                    {t.status === "done" && <Check className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={cx("font-medium", t.status === "done" && "text-muted line-through")}>{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {t.status !== "done" && <Badge tone={PRIORITY[t.priority].t}>{PRIORITY[t.priority].l}</Badge>}
                      {t.status === "doing" && <Badge tone="info">En curso</Badge>}
                      {t.due_date && <span className={cx(overdue && "font-semibold text-danger")}>{overdue ? "Venció " : "Para el "}{formatDate(`${t.due_date}T12:00:00Z`, { timeZone: "UTC" })}</span>}
                    </div>
                    {t.description && <p className="mt-1 text-sm text-ink-soft">{t.description}</p>}
                  </div>
                  {!readOnly && <button onClick={() => setEditing(t)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label={`Editar ${t.title}`}><Pencil className="size-4" /></button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && <TaskDialog event={event} task={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function TaskDialog({ event, task, onClose, onSaved }: { event: EventRow; task: TaskRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { ws } = useWorkspace();
  const [f, setF] = useState({ title: task?.title ?? "", description: task?.description ?? "", due_date: task?.due_date ?? "", priority: task?.priority ?? "medium", status: task?.status ?? "todo" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return setError("Escribe la tarea.");
    setBusy(true);
    const row = { title: f.title.trim(), description: f.description.trim() || null, due_date: f.due_date || null, priority: f.priority, status: f.status };
    const res = task ? await supabase.from("event_tasks").update(row).eq("id", task.id) : await supabase.from("event_tasks").insert({ ...row, workspace_id: ws.id, event_id: event.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await onSaved();
    onClose();
  }
  async function remove() {
    if (!task || !confirm(`¿Eliminar "${task.title}"?`)) return;
    const { error: err } = await supabase.from("event_tasks").delete().eq("id", task.id);
    if (err) return setError(err.message);
    await onSaved();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={task ? "Editar tarea" : "Nueva tarea"}
      footer={<>
        {task && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="task-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="task-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Tarea">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus />}</Field></div>
        <Field label="Fecha límite" optional>{(id) => <Input id={id} type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />}</Field>
        <Field label="Prioridad">{(id) => <Select id={id} value={f.priority} onChange={(e) => set("priority", e.target.value)}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select>}</Field>
        <Field label="Estado">{(id) => <Select id={id} value={f.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <div className="sm:col-span-2"><Field label="Detalles" optional>{(id) => <Textarea id={id} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}
