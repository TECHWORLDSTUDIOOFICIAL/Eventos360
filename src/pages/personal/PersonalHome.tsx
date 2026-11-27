import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CheckCircle2, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { EVENT_CATEGORIES, publicMediaUrl, useEventSummary, type EventRow } from "@/lib/events";
import { formatDate, formatMoney, plural } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Badge, Card, CardHeader, Spinner, cx } from "@/components/ui";

export default function PersonalHome() {
  return <EventGate>{(ctx) => <Home {...ctx} />}</EventGate>;
}

function useCountdown(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { past: true, days: 0, hours: 0 };
  return { past: false, days: Math.floor(ms / 86_400_000), hours: Math.floor((ms % 86_400_000) / 3_600_000) };
}

function Home({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { ws, region, modules } = useWorkspace();
  const { data: s } = useEventSummary(event.id);
  const has = (k: string) => modules.some((m) => m.module_key === k);
  const base = workspacePath(ws.kind, ws.id);
  const cd = useCountdown(event.starts_at);
  const cover = publicMediaUrl(event.cover_path);
  const tasks = useQuery({
    queryKey: ["home-tasks", event.id],
    enabled: has("tasks"),
    queryFn: async () => unwrap<{ id: string; title: string; due_date: string | null; priority: string }[]>(
      await supabase.from("event_tasks").select("id, title, due_date, priority").eq("event_id", event.id).neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false }).limit(5)),
  });
  const money = (n: number) => formatMoney(n, event.currency_code, region.locale);
  const budget = Number(event.budget) || 0;
  const committed = s?.committed_total ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((committed / budget) * 100)) : 0;
  const taskPct = s && s.tasks_total ? Math.round((s.tasks_done / s.tasks_total) * 100) : 0;
  const rsvpPct = s && s.guests_total ? Math.round(((s.guests_confirmed + s.guests_declined) / s.guests_total) * 100) : 0;

  return (
    <div className="animate-rise space-y-6">
      {events.length > 1 && <div className="flex justify-end"><EventSwitcher events={events} current={event} onSelect={select} /></div>}

      {/* Portada con cuenta regresiva */}
      <section className="relative overflow-hidden rounded-[var(--radius-card)] bg-ink text-paper">
        {cover && <img src={cover} alt="" className="absolute inset-0 size-full object-cover opacity-45" />}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/20" />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <Badge className="bg-white/15 text-paper">{EVENT_CATEGORIES[event.category]}</Badge>
            <h1 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">{event.name}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-paper/80">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" />{event.starts_at ? formatDate(event.starts_at, { timeZone: region.timezone, locale: region.locale, withTime: true }) : "Fecha por definir"}</span>
              {event.venue_name && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{event.venue_name}</span>}
            </div>
          </div>
          {cd && (
            <div className="flex gap-3">
              {cd.past ? <div className="rounded-2xl bg-white/10 px-5 py-3 text-lg font-semibold">¡Llegó el gran día!</div> : (
                [{ v: cd.days, l: cd.days === 1 ? "día" : "días" }, { v: cd.hours, l: "horas" }].map((x) => (
                  <div key={x.l} className="min-w-20 rounded-2xl bg-white/10 px-4 py-3 text-center backdrop-blur">
                    <div className="font-display text-4xl font-semibold tabular-nums">{x.v}</div>
                    <div className="text-xs uppercase tracking-wider text-paper/70">{x.l}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>

      {!s ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-3">
          <Metric to={`${base}/m/guests`} title="Invitados" big={`${s.people_confirmed}`} unit="confirmados"
            line={`${s.guests_pending} invitación(es) sin responder · ${s.guests_declined} no asistirán`} pct={rsvpPct} pctLabel={`${rsvpPct}% respondieron`} />
          <Metric to={has("budget") ? `${base}/m/budget` : undefined} title="Presupuesto" big={money(committed)} unit={budget ? `de ${money(budget)}` : "comprometido"}
            line={`Pagado ${money(s.paid_total)} · Pendiente ${money(Math.max(0, committed - s.paid_total))}`} pct={pct}
            pctLabel={budget ? `${pct}% del presupuesto` : "Define tu presupuesto en Mi evento"} warn={budget > 0 && committed > budget} />
          <Metric to={has("tasks") ? `${base}/m/tasks` : undefined} title="Tareas" big={`${s.tasks_done}/${s.tasks_total}`} unit="completadas"
            line={s.tasks_overdue ? plural(s.tasks_overdue, "tarea atrasada", "tareas atrasadas") : "Sin tareas atrasadas"} pct={taskPct} pctLabel={`${taskPct}% de avance`} warn={s.tasks_overdue > 0} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {has("tasks") && (
          <Card>
            <CardHeader title="Próximas tareas" action={<Link to={`${base}/m/tasks`} className="text-sm font-semibold text-[var(--accent)]">Ver todas</Link>} />
            {tasks.isLoading ? <Spinner /> : !tasks.data?.length ? (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted"><CheckCircle2 className="size-4 text-ok" /> No tienes tareas pendientes.</p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.data.map((t) => {
                  const overdue = t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="min-w-0 truncate">{t.title}</span>
                      <span className={cx("shrink-0 text-xs", overdue ? "font-semibold text-danger" : "text-muted")}>{t.due_date ? formatDate(`${t.due_date}T12:00:00Z`, { timeZone: "UTC" }) : "Sin fecha"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
        <Card>
          <CardHeader title="Organiza tu evento" />
          <ul className="divide-y divide-line">
            {modules.filter((m) => !["home", "my_event"].includes(m.module_key)).slice(0, 8).map((m) => (
              <li key={m.module_key}>
                <Link to={`${base}/m/${m.module_key}`} className="flex items-center justify-between px-5 py-3 text-sm font-medium hover:bg-paper">
                  {m.label} <ArrowRight className="size-4 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Metric({ to, title, big, unit, line, pct, pctLabel, warn }: { to?: string; title: string; big: string; unit: string; line: string; pct: number; pctLabel: string; warn?: boolean }) {
  const body = (
    <Card className="h-full p-5 transition hover:border-line-strong">
      <div className="text-sm font-medium text-muted">{title}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-3xl font-semibold tabular-nums">{big}</span>
        <span className="text-sm text-muted">{unit}</span>
      </div>
      <div className="mt-4 h-2 rounded-full bg-ink/6">
        <div className={cx("h-2 rounded-full", warn ? "bg-danger" : "bg-[var(--accent)]")} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-xs text-muted">{pctLabel}</div>
      <div className={cx("mt-1 text-xs", warn ? "text-danger" : "text-muted")}>{line}</div>
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}
