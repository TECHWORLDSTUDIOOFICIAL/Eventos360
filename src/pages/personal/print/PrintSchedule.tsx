import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { EVENT_CATEGORIES, type EventRow } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { PrintLayout, Sheet } from "@/components/PrintLayout";
import { Alert, Spinner } from "@/components/ui";

interface Item { id: string; start_time: string; duration_min: number | null; title: string; responsible: string | null; notes: string | null }

const hhmm = (t: string) => t.slice(0, 5);
function endTime(t: string, min: number | null) {
  if (!min) return "";
  const [h, m] = t.split(":").map(Number) as [number, number];
  const total = (h * 60 + m + min) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Cronograma en formato documento (Carta), para entregar a proveedores y coordinadores. */
export default function PrintSchedule({ event }: { event: EventRow }) {
  const { ws, region } = useWorkspace();
  const { data, isLoading } = useQuery({
    queryKey: ["schedule", event.id],
    queryFn: async () => unwrap<Item[]>(await supabase.from("event_schedule_items").select("*").eq("event_id", event.id).order("start_time")),
  });
  if (isLoading) return <Spinner />;
  const items = data ?? [];

  return (
    <PrintLayout title="Imprimir cronograma" backTo={workspacePath(ws.kind, ws.id, "m/schedule")} paper="letter">
      {!items.length && <div className="mx-auto mb-4 max-w-xl print:hidden"><Alert tone="info">El cronograma está vacío. Agrega actividades para imprimirlo.</Alert></div>}
      <Sheet paper="letter" className="px-10 py-9 print:p-0">
        <header className="border-b-2 border-ink pb-4">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Cronograma · {EVENT_CATEGORIES[event.category]}</div>
          <h1 className="mt-1 font-display text-3xl font-semibold">{event.name}</h1>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
            {event.starts_at && <span>{formatDate(event.starts_at, { timeZone: region.timezone, locale: region.locale, withTime: true })}</span>}
            {event.venue_name && <span>{event.venue_name}{event.venue_address ? ` · ${event.venue_address}` : ""}</span>}
          </div>
        </header>
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left text-xs uppercase tracking-wider text-muted">
              <th className="w-20 py-2 pr-3 font-semibold">Hora</th>
              <th className="w-16 py-2 pr-3 font-semibold">Hasta</th>
              <th className="py-2 pr-3 font-semibold">Actividad</th>
              <th className="w-40 py-2 font-semibold">Responsable</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="no-break border-b border-line align-top">
                <td className="py-3 pr-3 font-display text-base font-semibold tabular-nums">{hhmm(it.start_time)}</td>
                <td className="py-3 pr-3 tabular-nums text-muted">{endTime(it.start_time, it.duration_min)}</td>
                <td className="py-3 pr-3">
                  <div className="font-semibold">{it.title}</div>
                  {it.notes && <div className="mt-0.5 whitespace-pre-line text-ink-soft">{it.notes}</div>}
                </td>
                <td className="py-3">{it.responsible ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="mt-8 flex justify-between border-t border-line pt-3 text-[11px] text-muted">
          <span>{items.length} actividad(es)</span>
          <span>Generado con Eventos360 · {formatDate(new Date(), { timeZone: region.timezone, locale: region.locale })}</span>
        </footer>
      </Sheet>
    </PrintLayout>
  );
}
