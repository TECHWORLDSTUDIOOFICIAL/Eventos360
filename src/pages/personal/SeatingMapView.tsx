import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Move, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { guestName, guestSeats, type EventRow, type EventTable, type GuestRow } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { MAP_ITEM_KINDS, SeatingMap, layoutTables, type MapItem } from "@/components/SeatingMap";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

export const useMapItems = (eventId: string | undefined) =>
  useQuery({
    queryKey: ["map-items", eventId],
    enabled: !!eventId,
    queryFn: async () => unwrap<MapItem[]>(await supabase.from("event_map_items").select("id, kind, label, pos_x, pos_y, width, height").eq("event_id", eventId).order("created_at")),
  });

const SIZES: Record<string, [number, number]> = { stage: [30, 12], dance: [26, 22], head: [34, 9], entrance: [12, 7], buffet: [22, 9], bar: [16, 9], dj: [12, 10], cake: [9, 9], photo: [14, 10], other: [14, 10] };

export default function SeatingMapView({ event, tables, byTable, onEditTable }: {
  event: EventRow; tables: EventTable[]; byTable: Map<string, GuestRow[]>; onEditTable: (t: EventTable) => void;
}) {
  const { ws, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const { data: items } = useMapItems(event.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState("dance");
  const [error, setError] = useState<string | null>(null);
  const used = (id: string) => (byTable.get(id) ?? []).reduce((s, g) => s + guestSeats(g), 0);
  const layout = layoutTables(tables, used);
  const selTable = tables.find((t) => t.id === selected);
  const selItem = items?.find((i) => i.id === selected);

  const refreshTables = () => qc.invalidateQueries({ queryKey: ["event-tables", event.id] });
  const refreshItems = () => qc.invalidateQueries({ queryKey: ["map-items", event.id] });

  async function moveTable(id: string, x: number, y: number) {
    // Actualización optimista para que la mesa no "salte" mientras se guarda.
    qc.setQueryData<EventTable[]>(["event-tables", event.id], (old) => old?.map((t) => (t.id === id ? { ...t, pos_x: x, pos_y: y } : t)));
    const { error: err } = await supabase.from("event_tables").update({ pos_x: x, pos_y: y }).eq("id", id);
    if (err) { setError(err.message); await refreshTables(); }
  }
  async function moveItem(id: string, x: number, y: number) {
    qc.setQueryData<MapItem[]>(["map-items", event.id], (old) => old?.map((i) => (i.id === id ? { ...i, pos_x: x, pos_y: y } : i)));
    const { error: err } = await supabase.from("event_map_items").update({ pos_x: x, pos_y: y }).eq("id", id);
    if (err) { setError(err.message); await refreshItems(); }
  }
  async function addItem() {
    const [w, h] = SIZES[kind] ?? [14, 10];
    const { data, error: err } = await supabase.from("event_map_items")
      .insert({ workspace_id: ws.id, event_id: event.id, kind, pos_x: 50, pos_y: 12, width: w, height: h }).select("id").single();
    if (err) return setError(err.message);
    await refreshItems();
    setSelected((data as { id: string }).id);
  }
  async function autoArrange() {
    if (!confirm("¿Reacomodar todas las mesas en cuadrícula? Se perderá la posición actual de las mesas (los elementos del salón no se mueven).")) return;
    const fresh = layoutTables(tables.map((t) => ({ ...t, pos_x: null, pos_y: null })), used);
    const results = await Promise.all(fresh.map((l) => supabase.from("event_tables").update({ pos_x: Math.round(l.x * 100) / 100, pos_y: Math.round(l.y * 100) / 100 }).eq("id", l.table.id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) setError(failed.error.message);
    await refreshTables();
  }
  async function updateItem(patch: Partial<MapItem>) {
    if (!selItem) return;
    qc.setQueryData<MapItem[]>(["map-items", event.id], (old) => old?.map((i) => (i.id === selItem.id ? { ...i, ...patch } : i)));
    const { error: err } = await supabase.from("event_map_items").update(patch).eq("id", selItem.id);
    if (err) { setError(err.message); await refreshItems(); }
  }
  async function removeItem() {
    if (!selItem) return;
    const { error: err } = await supabase.from("event_map_items").delete().eq("id", selItem.id);
    if (err) return setError(err.message);
    setSelected(null);
    await refreshItems();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-3">
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-10 w-auto" aria-label="Elemento del salón">
              {Object.entries(MAP_ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => void addItem()}>Agregar elemento</Button>
            <Button variant="ghost" icon={<Wand2 className="size-4" />} onClick={() => void autoArrange()}>Ordenar mesas</Button>
            <span className="ml-auto hidden items-center gap-1 text-xs text-muted sm:inline-flex"><Move className="size-3.5" />Arrastra mesas y elementos para ubicarlos</span>
          </div>
        )}
        {error && <Alert tone="danger" onClose={() => setError(null)}>{error}</Alert>}
        <Card className="overflow-hidden">
          <SeatingMap tables={layout} items={items ?? []} editable={!readOnly} selected={selected} onSelect={setSelected}
            onMoveTable={(id, x, y) => void moveTable(id, x, y)} onMoveItem={(id, x, y) => void moveItem(id, x, y)} />
        </Card>
        <p className="text-xs text-muted">Los puntos alrededor de cada mesa son sus asientos; los rellenos están ocupados. Mesas en verde: completas.</p>
      </div>

      <Card className="self-start">
        {selTable ? (
          <div>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <div className="font-semibold">{selTable.name}</div>
                <div className="text-xs text-muted">{used(selTable.id)} de {selTable.capacity} lugares</div>
              </div>
              {!readOnly && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => onEditTable(selTable)}>Editar</Button>}
            </div>
            <ul className="divide-y divide-line">
              {(byTable.get(selTable.id) ?? []).map((g) => (
                <li key={g.id} className="px-4 py-2 text-sm">{guestName(g)} <span className="text-xs text-muted">· {guestSeats(g)} persona(s)</span></li>
              ))}
              {!(byTable.get(selTable.id) ?? []).length && <li className="px-4 py-4 text-sm text-muted">Sin invitados. Asígnalos desde la vista Lista.</li>}
            </ul>
          </div>
        ) : selItem ? (
          <div className="space-y-3 p-4">
            <div className="font-semibold">{MAP_ITEM_KINDS[selItem.kind]?.label}</div>
            {!readOnly && <>
              <Field label="Texto" optional>{(id) => <Input id={id} defaultValue={selItem.label ?? ""} maxLength={40} key={selItem.id}
                onBlur={(e) => e.target.value !== (selItem.label ?? "") && void updateItem({ label: e.target.value.trim() || null })} placeholder={MAP_ITEM_KINDS[selItem.kind]?.label} />}</Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ancho (%)">{(id) => <Input id={id} type="number" min={3} max={100} defaultValue={selItem.width} key={`w${selItem.id}`} onBlur={(e) => void updateItem({ width: Math.max(3, Math.min(100, Number(e.target.value) || 10)) })} />}</Field>
                <Field label="Alto (%)">{(id) => <Input id={id} type="number" min={3} max={100} defaultValue={selItem.height} key={`h${selItem.id}`} onBlur={(e) => void updateItem({ height: Math.max(3, Math.min(100, Number(e.target.value) || 10)) })} />}</Field>
              </div>
              <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => void removeItem()}>Quitar del mapa</Button>
            </>}
          </div>
        ) : (
          <p className="p-4 text-sm text-muted">Toca una mesa para ver sus invitados, o un elemento del salón para editarlo.</p>
        )}
      </Card>
    </div>
  );
}
