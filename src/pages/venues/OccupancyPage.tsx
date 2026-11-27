import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Lock, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { toLocalInput } from "@/lib/events";
import { BOOKING_STATUS, docBooking, scheduleText, useVenueParts, useVenues, type BookingStatus } from "@/lib/venues";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, cx } from "@/components/ui";

interface Row { booking_id: string; number: number; venue_id: string; title: string; status: BookingStatus; kind: string; starts_at: string; ends_at: string; hold_until: string | null; guests: number | null; customer_name: string | null }

/** Ocupación del mes: cada espacio por día, con reservas confirmadas, apartados, bloqueos y consultas. */
export default function OccupancyPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data: venues, isLoading } = useVenues(ws.id);
  const { data: parts } = useVenueParts(ws.id);
  const today = toLocalInput(new Date().toISOString(), region.timezone).slice(0, 10);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const first = `${month}-01`;
  const days = useMemo(() => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  }, [month]);
  const { data: rows } = useQuery({
    queryKey: ["venue-month", ws.id, month],
    queryFn: async () => unwrap<Row[]>(await supabase.rpc("venue_month", { p_ws: ws.id, p_from: first, p_days: days.length })),
  });
  const atoms = (id: string) => { const p = (parts ?? []).filter((x) => x.venue_id === id).map((x) => x.part_id); return p.length ? p : [id]; };
  const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: region.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const onDay = (r: Row, d: string) => localDay(r.starts_at) <= d && localDay(new Date(new Date(r.ends_at).getTime() - 1000).toISOString()) >= d;
  const holdActive = (r: Row) => r.status !== "hold" || !r.hold_until || new Date(r.hold_until) > new Date();
  const cell = (venueId: string, d: string) => (rows ?? []).filter((r) => onDay(r, d) && atoms(r.venue_id).some((a) => atoms(venueId).includes(a)));
  const shift = (n: number) => { const [y, m] = month.split("-").map(Number) as [number, number]; const dt = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(dt.toISOString().slice(0, 7)); setSelected(null); };
  const monthName = (() => { const s = new Intl.DateTimeFormat(region.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`)); return s.charAt(0).toUpperCase() + s.slice(1); })();
  const dayLabel = (d: string) => new Intl.DateTimeFormat(region.locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const dayRows = selected ? (rows ?? []).filter((r) => onDay(r, selected)) : [];

  if (isLoading) return <Spinner />;
  if (!venues?.length) return <div className="animate-rise"><PageHeader title="Ocupación" /><Card><EmptyState title="Primero registra tus espacios">Aquí verás cada espacio día por día.</EmptyState></Card></div>;

  return (
    <div className="animate-rise">
      <PageHeader title="Ocupación" description="Toca un día para ver sus reservas o crear una nueva."
        actions={!readOnly && <>
          <Link to={base("m/bookings/nueva?tipo=bloqueo")}><Button variant="secondary" icon={<Lock className="size-4" />}>Bloquear fechas</Button></Link>
          <Link to={base("m/bookings/nueva")}><Button variant="accent" icon={<Plus className="size-4" />}>Nueva reserva</Button></Link>
        </>} />
      <Card>
        <CardHeader title={monthName} action={<div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => shift(-1)} aria-label="Mes anterior"><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Hoy</Button>
          <Button size="sm" variant="secondary" onClick={() => shift(1)} aria-label="Mes siguiente"><ChevronRight className="size-4" /></Button>
        </div>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-line bg-card px-4 py-2 text-left font-medium text-muted">Espacio</th>
                {days.map((d) => (
                  <th key={d} className={cx("border-b border-line px-0.5 py-1.5 text-center font-medium", d === today ? "text-[var(--accent)]" : "text-muted")}>
                    <div className="uppercase">{dayLabel(d)}</div><div className="text-[13px] tabular-nums">{Number(d.slice(8))}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {venues.map((v) => (
                <tr key={v.id}>
                  <td className="sticky left-0 z-10 max-w-40 truncate border-b border-line bg-card px-4 py-2 font-medium"><span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: v.color }} />{v.name}</td>
                  {days.map((d) => {
                    const c = cell(v.id, d);
                    const own = c.filter((r) => r.venue_id === v.id);
                    const blocking = c.filter((r) => r.status !== "inquiry" && holdActive(r));
                    const top = blocking.find((r) => r.status === "confirmed" || r.status === "done") ?? blocking.find((r) => r.kind === "block") ?? blocking[0];
                    const inquiries = c.filter((r) => r.status === "inquiry").length;
                    const viaCombo = top && top.venue_id !== v.id;
                    const bg = !top ? undefined : top.kind === "block" ? "#a39cb0" : top.status === "hold" ? undefined : v.color;
                    return (
                      <td key={d} className="border-b border-line p-0.5">
                        <button onClick={() => setSelected(d)} title={c.map((r) => `${docBooking(r.number)} ${r.title}`).join("\n") || "Libre"}
                          className={cx("relative block h-9 w-full rounded-md border transition", selected === d ? "border-ink" : "border-transparent hover:border-line-strong",
                            !top && "bg-paper", top?.status === "hold" && top.kind !== "block" && "bg-warn-soft", viaCombo && "opacity-45")}
                          style={bg ? { background: bg } : top?.status === "hold" ? { backgroundImage: "repeating-linear-gradient(45deg, transparent 0 4px, rgba(163,95,0,.25) 4px 7px)" } : undefined}>
                          {inquiries > 0 && <span className="absolute right-0.5 top-0.5 grid size-3.5 place-items-center rounded-full bg-ink text-[9px] font-bold text-white">{inquiries}</span>}
                          {own.length > 1 && blocking.length > 1 && <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold text-white">{blocking.length}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-5 py-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded" style={{ background: venues[0]!.color }} />Confirmada</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-warn-soft" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent 0 3px, rgba(163,95,0,.35) 3px 5px)" }} />Apartado provisional</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-[#a39cb0]" />Bloqueo</span>
          <span className="inline-flex items-center gap-1.5"><span className="grid size-3.5 place-items-center rounded-full bg-ink text-[9px] font-bold text-white">1</span>Consultas en espera</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded opacity-45" style={{ background: venues[0]!.color }} />Ocupado por un espacio combinado</span>
        </div>
      </Card>

      {selected && (
        <Card className="mt-6">
          <CardHeader title={(() => { const s = new Intl.DateTimeFormat(region.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${selected}T12:00:00Z`)); return s.charAt(0).toUpperCase() + s.slice(1); })()}
            action={!readOnly && <Link to={base(`m/bookings/nueva?fecha=${selected}`)}><Button size="sm" variant="accent" icon={<Plus className="size-4" />}>Reservar este día</Button></Link>} />
          {!dayRows.length ? <p className="px-5 py-6 text-sm text-muted">Todo libre este día.</p> : (
            <ul className="divide-y divide-line">
              {dayRows.map((r) => {
                const v = venues.find((x) => x.id === r.venue_id);
                return (
                  <li key={r.booking_id}>
                    <Link to={base(`m/bookings/${r.booking_id}`)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-paper">
                      <span className="size-2.5 rounded-full" style={{ background: v?.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{r.title}{r.customer_name ? <span className="font-normal text-muted"> · {r.customer_name}</span> : null}</span>
                        <span className="block text-xs text-muted">{v?.name} · {scheduleText(r.starts_at, r.ends_at, region.timezone, region.locale)}{r.guests ? ` · ${r.guests} personas` : ""}</span>
                      </span>
                      <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.kind === "block" ? "bg-ink/10" : r.status === "confirmed" || r.status === "done" ? "bg-ok-soft text-ok" : r.status === "hold" ? (holdActive(r) ? "bg-warn-soft text-warn" : "bg-ink/10 text-muted") : "bg-ink/5 text-muted")}>
                        {r.kind === "block" ? "Bloqueo" : r.status === "hold" && !holdActive(r) ? "Apartado vencido" : BOOKING_STATUS[r.status].label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
