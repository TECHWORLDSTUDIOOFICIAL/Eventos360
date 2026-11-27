import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardCheck, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { fromLocalInput, toLocalInput } from "@/lib/events";
import { useAvailability, useResources } from "@/lib/rental";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";

const DAYS = 14;

/** Consulta de disponibilidad: por rango exacto (para responder a un cliente) y calendario por día. */
export default function AvailabilityPage() {
  const { ws, region } = useWorkspace();
  const { data: resources, isLoading } = useResources(ws.id);
  const today = toLocalInput(new Date().toISOString(), region.timezone).slice(0, 10);
  const [range, setRange] = useState({ from: `${today}T08:00`, to: `${toLocalInput(new Date(Date.now() + 86_400_000).toISOString(), region.timezone).slice(0, 10)}T18:00` });
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const from = fromLocalInput(range.from, region.timezone);
  const to = fromLocalInput(range.to, region.timezone);
  const validRange = !!from && !!to && new Date(to) > new Date(from);
  const avail = useAvailability(ws.id, from, to);
  const categories = useMemo(() => [...new Set((resources ?? []).map((r) => r.category).filter((c): c is string => !!c))].sort(), [resources]);
  const list = (resources ?? []).filter((r) => (!cat || r.category === cat) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));

  const [start, setStart] = useState(today);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  }), [start]);
  const grid = useQuery({
    queryKey: ["availability-days", ws.id, start],
    queryFn: async () => unwrap<{ resource_id: string; day: string; available: number; committed: number }[]>(
      await supabase.rpc("rental_availability_days", { p_ws: ws.id, p_from: start, p_days: DAYS })),
  });
  const cell = (rid: string, day: string) => grid.data?.find((g) => g.resource_id === rid && g.day === day);
  const shift = (n: number) => { const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); setStart(d.toISOString().slice(0, 10)); };
  const dayLabel = (d: string) => new Intl.DateTimeFormat(region.locale, { timeZone: "UTC", weekday: "short", day: "numeric" }).format(new Date(`${d}T12:00:00Z`));

  if (isLoading) return <Spinner />;
  if (!resources?.length) return (
    <div className="animate-rise"><PageHeader title="Disponibilidad" /><Card><EmptyState icon={<ClipboardCheck className="size-6" />} title="Primero registra tu inventario">La disponibilidad se calcula con tus artículos, las reservaciones apartadas o entregadas y lo que está en mantenimiento.</EmptyState></Card></div>
  );

  return (
    <div className="animate-rise">
      <PageHeader title="Disponibilidad" description="Cuántas unidades tienes libres para un período. Cuenta las reservaciones apartadas y entregadas, las devoluciones atrasadas y lo que está en mantenimiento." />
      <Card>
        <CardHeader title="¿Tengo para estas fechas?" description="Ideal para responder a un cliente antes de cotizar." />
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_1fr_1fr_1fr]">
          <Field label="Desde">{(id) => <Input id={id} type="datetime-local" value={range.from} onChange={(e) => setRange((s) => ({ ...s, from: e.target.value }))} />}</Field>
          <Field label="Hasta">{(id) => <Input id={id} type="datetime-local" value={range.to} onChange={(e) => setRange((s) => ({ ...s, to: e.target.value }))} />}</Field>
          <Field label="Categoría">{(id) => <Select id={id} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
          <Field label="Buscar">{(id) => <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" /><Input id={id} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" /></div>}</Field>
        </div>
        {!validRange ? <div className="p-4"><Alert tone="warn">La fecha final debe ser posterior a la inicial.</Alert></div> : avail.isLoading ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr><th className="px-5 py-2 font-medium">Artículo</th><th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2 text-right font-medium">Mantenimiento</th><th className="px-3 py-2 text-right font-medium">Comprometido</th><th className="px-5 py-2 text-right font-medium">Disponible</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((r) => {
                  const a = avail.data?.find((x) => x.resource_id === r.id);
                  return (
                    <tr key={r.id}>
                      <td className="px-5 py-2.5"><div className="font-medium">{r.name}</div>{r.category && <div className="text-xs text-muted">{r.category}</div>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.total_qty}</td>
                      <td className={cx("px-3 py-2.5 text-right tabular-nums", a?.out_of_service ? "text-warn" : "text-faint")}>{a?.out_of_service || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{a?.committed ?? "—"}</td>
                      <td className={cx("px-5 py-2.5 text-right font-display text-lg font-semibold tabular-nums", a && a.available <= 0 ? "text-danger" : "text-ok")}>{a ? Math.max(0, a.available) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Calendario por día" description="Unidades libres cada día. En rojo: agotado; en ámbar: queda poco."
          action={<div className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => shift(-DAYS)} aria-label="Dos semanas antes"><ChevronLeft className="size-4" /></Button>
            <Button size="sm" variant="secondary" onClick={() => setStart(today)}>Hoy</Button>
            <Button size="sm" variant="secondary" onClick={() => shift(DAYS)} aria-label="Dos semanas después"><ChevronRight className="size-4" /></Button>
          </div>} />
        {grid.isLoading ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-line bg-card px-4 py-2 text-left font-medium text-muted">Artículo</th>
                  {days.map((d) => <th key={d} className={cx("border-b border-line px-1 py-2 text-center font-medium capitalize", d === today ? "text-[var(--accent)]" : "text-muted")}>{dayLabel(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="sticky left-0 z-10 max-w-48 truncate border-b border-line bg-card px-4 py-2 font-medium">{r.name}<span className="ml-1 font-normal text-muted">({r.total_qty})</span></td>
                    {days.map((d) => {
                      const c = cell(r.id, d);
                      const v = c ? Math.max(0, c.available) : null;
                      const low = v !== null && r.total_qty > 0 && v / r.total_qty < 0.2;
                      return (
                        <td key={d} className="border-b border-line p-0.5 text-center" title={c ? `${v} libres · ${c.committed} comprometidas` : undefined}>
                          <span className={cx("block rounded-md py-1.5 font-semibold tabular-nums",
                            v === null ? "text-faint" : v === 0 ? "bg-danger-soft text-danger" : low ? "bg-warn-soft text-warn" : c?.committed ? "bg-ok-soft text-ok" : "text-ink-soft")}>
                            {v ?? "·"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
