import { useMemo } from "react";
import { guestName, guestSeats, useEventTables, useGuests, type EventRow, type GuestRow } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { MAP_ITEM_KINDS, SeatingMap, layoutTables } from "@/components/SeatingMap";
import { PrintLayout, Sheet } from "@/components/PrintLayout";
import { Spinner } from "@/components/ui";
import { useMapItems } from "../SeatingMapView";

/** Plano del salón + lista de invitados por mesa (Carta horizontal). */
export default function PrintSeating({ event }: { event: EventRow }) {
  const { ws, region } = useWorkspace();
  const { data: tables, isLoading } = useEventTables(event.id);
  const { data: guests } = useGuests(event.id);
  const { data: items } = useMapItems(event.id);

  const byTable = useMemo(() => {
    const m = new Map<string, GuestRow[]>();
    for (const g of guests ?? []) if (g.table_id && g.status !== "declined") m.set(g.table_id, [...(m.get(g.table_id) ?? []), g]);
    return m;
  }, [guests]);
  if (isLoading) return <Spinner />;
  const used = (id: string) => (byTable.get(id) ?? []).reduce((s, g) => s + guestSeats(g), 0);
  const layout = layoutTables(tables ?? [], used);
  const unseated = (guests ?? []).filter((g) => !g.table_id && g.status !== "declined");
  const date = event.starts_at ? formatDate(event.starts_at, { timeZone: region.timezone, locale: region.locale }) : "";

  const Header = ({ subtitle }: { subtitle: string }) => (
    <header className="mb-3 flex items-end justify-between border-b-2 border-ink pb-2">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">{subtitle}</div>
        <h1 className="font-display text-2xl font-semibold">{event.name}</h1>
      </div>
      <div className="text-right text-xs text-ink-soft">{date}{event.venue_name ? ` · ${event.venue_name}` : ""}</div>
    </header>
  );

  return (
    <PrintLayout title="Imprimir mapa de mesas" backTo={workspacePath(ws.kind, ws.id, "m/seating")} paper="letter-landscape">
      <Sheet paper="letter-landscape" className="px-8 py-6 print:p-0">
        <Header subtitle="Mapa de mesas" />
        {/* Ancho limitado para que el plano y el encabezado quepan en una sola hoja horizontal */}
        <div className="mx-auto overflow-hidden rounded-lg border border-line" style={{ width: "min(100%, 8.6in)" }}>
          <SeatingMap tables={layout} items={items ?? []} />
        </div>
        {!!items?.length && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            {[...new Set(items.map((i) => i.kind))].map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm border" style={{ background: MAP_ITEM_KINDS[k]?.fill, borderColor: MAP_ITEM_KINDS[k]?.stroke }} />
                {MAP_ITEM_KINDS[k]?.label}
              </span>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet paper="letter-landscape" className="px-8 py-6 print:p-0">
        <Header subtitle="Invitados por mesa" />
        <div className="columns-3 gap-6 text-[12.5px]">
          {(tables ?? []).map((t) => {
            const list = byTable.get(t.id) ?? [];
            return (
              <div key={t.id} className="no-break mb-4 break-inside-avoid">
                <div className="flex items-baseline justify-between border-b border-line-strong pb-1 font-semibold">
                  <span>{t.name}</span><span className="text-xs font-normal text-muted">{used(t.id)}/{t.capacity}</span>
                </div>
                <ol className="mt-1 space-y-0.5">
                  {list.map((g) => <li key={g.id} className="flex justify-between gap-2"><span>{guestName(g)}</span><span className="text-muted">{guestSeats(g)}</span></li>)}
                  {!list.length && <li className="text-muted">—</li>}
                </ol>
              </div>
            );
          })}
          {!!unseated.length && (
            <div className="no-break mb-4 break-inside-avoid">
              <div className="border-b border-danger pb-1 font-semibold text-danger">Sin mesa asignada</div>
              <ol className="mt-1 space-y-0.5">{unseated.map((g) => <li key={g.id}>{guestName(g)} <span className="text-muted">({guestSeats(g)})</span></li>)}</ol>
            </div>
          )}
        </div>
      </Sheet>
    </PrintLayout>
  );
}
