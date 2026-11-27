import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, MapPin, Phone, RotateCcw, Store, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { docNumber, useCustomers } from "@/lib/pro";
import { depositHeld, isOverdue, useRentals, type Rental } from "@/lib/rental";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, cx } from "@/components/ui";
import { DeliveryDialog, ReturnDialog } from "./rentalShared";

/** Unidades por reservación (para resumir cada tarjeta). */
function useUnits(ids: string[]) {
  return useQuery({
    queryKey: ["rental-items", "units", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = unwrap<{ rental_id: string; quantity: number; resource_id: string | null }[]>(
        await supabase.from("rental_items").select("rental_id, quantity, resource_id").in("rental_id", ids));
      const m = new Map<string, { units: number; lines: number }>();
      for (const r of rows) {
        if (!r.resource_id) continue;
        const v = m.get(r.rental_id) ?? { units: 0, lines: 0 };
        m.set(r.rental_id, { units: v.units + r.quantity, lines: v.lines + 1 });
      }
      return m;
    },
  });
}

function dayKey(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Agrupa por día relativo: atrasadas, hoy, mañana y luego cada fecha. */
function groupByDay(rows: Rental[], field: "starts_at" | "ends_at", tz: string, locale: string) {
  const today = dayKey(new Date().toISOString(), tz);
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000).toISOString(), tz);
  const groups = new Map<string, { label: string; tone: "danger" | "accent" | "neutral"; rows: Rental[] }>();
  for (const r of rows) {
    const k = dayKey(r[field], tz);
    const key = k < today ? "0-late" : k;
    const label = k < today ? "Atrasadas" : k === today ? "Hoy" : k === tomorrow ? "Mañana"
      : new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(r[field]));
    const g = groups.get(key) ?? { label, tone: k < today ? "danger" as const : k === today ? "accent" as const : "neutral" as const, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

function RentalCard({ r, kind, units, onAction }: { r: Rental; kind: "delivery" | "return"; units?: { units: number; lines: number }; onAction: () => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const { data: customers } = useCustomers(ws.id);
  const c = customers?.find((x) => x.id === r.customer_id);
  const when = kind === "delivery" ? r.starts_at : r.ends_at;
  const pickup = r.delivery_mode === "pickup";
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
      <div className="w-16 shrink-0 text-center">
        <div className="font-display text-xl font-semibold tabular-nums">{new Intl.DateTimeFormat(region.locale, { timeZone: region.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(when))}</div>
        <div className="text-[11px] text-muted">{formatDate(when, { timeZone: region.timezone })}</div>
      </div>
      <div className="min-w-0 flex-1">
        <Link to={workspacePath(ws.kind, ws.id, `m/reservations/${r.id}`)} className="font-semibold hover:underline">{docNumber("RES", r.number)} · {r.title}</Link>
        <div className="text-sm text-muted">{c?.name}{units ? ` · ${units.units} unidades en ${units.lines} ${units.lines === 1 ? "artículo" : "artículos"}` : ""}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1">{pickup ? <Store className="size-3.5" /> : <Truck className="size-3.5" />}
            {pickup ? (kind === "delivery" ? "El cliente retira" : "El cliente devuelve") : (kind === "delivery" ? "Entregamos" : "Recogemos")}</span>
          {!pickup && r.delivery_address && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{r.delivery_address}</span>}
          {(r.delivery_contact || r.delivery_phone) && <span className="inline-flex items-center gap-1"><Phone className="size-3.5" />{[r.delivery_contact, r.delivery_phone].filter(Boolean).join(" · ")}</span>}
          {kind === "return" && Number(r.deposit_received) > 0 && <span>Depósito recibido: {formatMoney(Number(r.deposit_received), r.currency_code, region.locale)}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Link to={workspacePath(ws.kind, ws.id, `imprimir/alquiler?id=${r.id}&tipo=entrega`)}><Button size="sm" variant="secondary" icon={<ClipboardCheck className="size-4" />}>Hoja</Button></Link>
        {!readOnly && <Button size="sm" variant="accent" icon={kind === "delivery" ? <Truck className="size-4" /> : <RotateCcw className="size-4" />} onClick={onAction}>{kind === "delivery" ? "Entregar" : "Recibir"}</Button>}
      </div>
    </li>
  );
}

export function Agenda({ kind }: { kind: "delivery" | "return" }) {
  const { ws, region } = useWorkspace();
  const { data, isLoading } = useRentals(ws.id, { statuses: [kind === "delivery" ? "reserved" : "out"] });
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => (kind === "delivery" ? a.starts_at.localeCompare(b.starts_at) : a.ends_at.localeCompare(b.ends_at))), [data, kind]);
  const units = useUnits(sorted.map((r) => r.id));
  const [acting, setActing] = useState<Rental | null>(null);
  const groups = groupByDay(sorted, kind === "delivery" ? "starts_at" : "ends_at", region.timezone, region.locale);

  if (isLoading) return <Spinner />;
  return (
    <>
      {!sorted.length ? (
        <Card><EmptyState icon={kind === "delivery" ? <Truck className="size-6" /> : <RotateCcw className="size-6" />} title={kind === "delivery" ? "No hay entregas pendientes" : "No hay artículos fuera"}>
          {kind === "delivery" ? "Aquí aparecen las reservaciones apartadas, ordenadas por fecha de entrega." : "Aquí aparecen las reservaciones entregadas que esperan su devolución."}
        </EmptyState></Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className={cx("mb-2 text-sm font-semibold uppercase tracking-wide", g.tone === "danger" ? "text-danger" : g.tone === "accent" ? "text-[var(--accent)]" : "text-muted")}>
                {g.label} <span className="font-normal">({g.rows.length})</span>
              </h2>
              <Card><ul className="divide-y divide-line">{g.rows.map((r) => <RentalCard key={r.id} r={r} kind={kind} units={units.data?.get(r.id)} onAction={() => setActing(r)} />)}</ul></Card>
            </section>
          ))}
        </div>
      )}
      {acting && kind === "delivery" && <DeliveryDialog rental={acting} onClose={() => setActing(null)} onDone={() => setActing(null)} />}
      {acting && kind === "return" && <ReturnDialog rental={acting} onClose={() => setActing(null)} onDone={() => setActing(null)} />}
    </>
  );
}

export function ReturnsView() {
  const { ws, region } = useWorkspace();
  const { data: returned } = useRentals(ws.id, { statuses: ["returned"] });
  const pendingDeposits = (returned ?? []).filter((r) => depositHeld(r) > 0.004);
  const { data: out } = useRentals(ws.id, { statuses: ["out"] });
  const overdue = (out ?? []).filter(isOverdue).length;
  return (
    <div className="animate-rise">
      <PageHeader title="Devoluciones" description="Artículos que están con clientes. Al recibirlos, revisa cada uno: lo dañado o faltante pasa a mantenimiento y puedes cobrarlo o descontarlo del depósito."
        actions={overdue > 0 ? <Badge tone="danger">{overdue} atrasada{overdue === 1 ? "" : "s"}</Badge> : undefined} />
      <Agenda kind="return" />
      {pendingDeposits.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-warn">Depósitos por liquidar ({pendingDeposits.length})</h2>
          <Card><ul className="divide-y divide-line">
            {pendingDeposits.map((r) => (
              <li key={r.id}><Link to={workspacePath(ws.kind, ws.id, `m/reservations/${r.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                <span className="w-20 font-mono text-xs text-muted">{docNumber("RES", r.number)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.title}<span className="block text-xs font-normal text-muted">Devuelta el {formatDate(r.returned_at, { timeZone: region.timezone })}{Number(r.damage_total) > 0 ? ` · daños ${formatMoney(Number(r.damage_total), r.currency_code, region.locale)}` : ""}</span></span>
                <span className="font-semibold tabular-nums">{formatMoney(depositHeld(r), r.currency_code, region.locale)}</span>
              </Link></li>
            ))}
          </ul></Card>
        </section>
      )}
    </div>
  );
}
