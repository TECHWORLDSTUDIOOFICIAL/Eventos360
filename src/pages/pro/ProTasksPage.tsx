import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ListChecks } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useEvents } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Badge, Card, EmptyState, PageHeader, Spinner, cx } from "@/components/ui";

interface TaskRow { id: string; event_id: string; title: string; due_date: string | null; priority: "low" | "medium" | "high"; status: "todo" | "doing" | "done" }
const PRIORITY = { high: { l: "Alta", t: "danger" as const }, medium: { l: "Media", t: "warn" as const }, low: { l: "Baja", t: "neutral" as const } };

/** Tareas de todos los eventos. Se crean dentro de cada evento (pestaña Tareas). */
export default function ProTasksPage() {
  const { ws, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const { data: events } = useEvents(ws.id);
  const [show, setShow] = useState<"open" | "done">("open");
  const { data, isLoading } = useQuery({
    queryKey: ["ws-tasks", ws.id],
    queryFn: async () => unwrap<TaskRow[]>(await supabase.from("event_tasks").select("id, event_id, title, due_date, priority, status").eq("workspace_id", ws.id)
      .order("due_date", { ascending: true, nullsFirst: false })),
  });
  const today = new Date().toISOString().slice(0, 10);
  const evName = (id: string) => events?.find((e) => e.id === id)?.name ?? "";
  const list = useMemo(() => (data ?? []).filter((t) => (show === "done" ? t.status === "done" : t.status !== "done")), [data, show]);

  async function toggle(t: TaskRow) {
    await supabase.from("event_tasks").update({ status: t.status === "done" ? "todo" : "done" }).eq("id", t.id);
    await qc.invalidateQueries({ queryKey: ["ws-tasks", ws.id] });
    await qc.invalidateQueries({ queryKey: ["tasks", t.event_id] });
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Tareas" description="Lo pendiente de todos tus eventos. Para agregar tareas, entra al evento → pestaña Tareas." />
      <div className="mb-3 flex gap-2">
        {(["open", "done"] as const).map((s) => (
          <button key={s} onClick={() => setShow(s)} className={cx("rounded-full px-3 py-1.5 text-sm font-medium", show === s ? "bg-ink text-paper" : "border border-line bg-card text-ink-soft")}>
            {s === "open" ? "Pendientes" : "Hechas"}
          </button>
        ))}
      </div>
      <Card>
        {isLoading ? <Spinner /> : !list.length ? (
          <EmptyState icon={<ListChecks className="size-6" />} title={show === "open" ? "No hay tareas pendientes" : "Aún no completas tareas"} />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((t) => {
              const overdue = t.status !== "done" && t.due_date && t.due_date < today;
              return (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <button onClick={() => void toggle(t)} disabled={readOnly} aria-label={t.status === "done" ? "Marcar pendiente" : "Completar"}
                    className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2", t.status === "done" ? "border-ok bg-ok text-white" : "border-line-strong hover:border-[var(--accent)]")}>
                    {t.status === "done" && <Check className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={cx("font-medium", t.status === "done" && "text-muted line-through")}>{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Link to={workspacePath(ws.kind, ws.id, `m/events/${t.event_id}?tab=tareas`)} className="hover:underline">{evName(t.event_id)}</Link>
                      {t.status !== "done" && <Badge tone={PRIORITY[t.priority].t}>{PRIORITY[t.priority].l}</Badge>}
                      {t.due_date && <span className={cx(overdue && "font-semibold text-danger")}>{overdue ? "Venció " : ""}{formatDate(`${t.due_date}T12:00:00Z`, { timeZone: "UTC" })}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
