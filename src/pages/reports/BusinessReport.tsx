import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BarChart3, Download, Lock, MessageCircle, Printer } from "lucide-react";
import { formatDate, formatMoney, plural } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { EVENT_CATEGORIES } from "@/lib/events";
import { EXPENSE_CATEGORIES } from "@/lib/catalog";
import { SOURCES } from "@/lib/venues";
import { waNumber } from "@/lib/pro";
import { PERIODS, change, periodRange, useBusinessReport, type BusinessReport as Report, type PeriodKey } from "@/lib/reports";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";
import { KPI, MonthColumns, RankBars } from "./charts";

const METHODS: Record<string, string> = { transferencia: "Transferencia", deposito: "Depósito", efectivo: "Efectivo", tarjeta: "Tarjeta", billetera: "Billetera electrónica", otro: "Otro" };
const ITEM_KIND: Record<string, string> = { package: "Paquete", catalog: "Catálogo", line: "", rental: "Alquiler", booking: "Salón / extra" };
type Tab = "resumen" | "ventas" | "cobros" | "gastos" | "operacion";

/** Reportes del negocio: resultado, ventas, cobros, gastos, personal y operación del período. */
export default function BusinessReport() {
  const { ws, region } = useWorkspace();
  const [period, setPeriod] = useState<PeriodKey>("mes");
  const [custom, setCustom] = useState(() => periodRange("mes"));
  const [currency, setCurrency] = useState(region.currency_code);
  const [tab, setTab] = useState<Tab>("resumen");
  const range = period === "custom" ? custom : periodRange(period);
  const { data: r, isLoading, error } = useBusinessReport(ws.id, range.from, range.to, currency);
  const money = (n: number) => formatMoney(n, currency, region.locale);
  const dateText = (d: string) => formatDate(`${d}T12:00:00Z`, { timeZone: "UTC" });
  const hasOps = !!(r?.rental || r?.venues);
  const tabs: [Tab, string][] = [["resumen", "Resumen"], ["ventas", "Ventas"], ["cobros", "Cobros y saldos"], ["gastos", "Gastos y personal"], ...(hasOps ? [["operacion", "Operación"] as [Tab, string]] : [])];

  async function exportExcel() {
    if (!r) return;
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const head = (cols: string[]) => cols.map((value) => ({ value, fontWeight: "bold" as const }));
    const row = (vals: (string | number | null)[]) => vals.map((value) => ({ value: value ?? "" }));
    const t = r.totals;
    const sheets = [
      { sheet: "Resumen", columns: [{ width: 34 }, { width: 18 }], data: [head(["Concepto", `Monto (${currency})`]),
        row([`Período`, `${range.from} a ${range.to}`]), row(["Ventas sin IVA", t.sales]), row(["IVA cobrado (no es ganancia)", t.tax]), row(["Costo de lo vendido", t.cost]),
        row(["  de eso, personal en turnos", t.staff]), row(["Gastos del negocio", t.overhead]), row(["Resultado", t.result]), row(["Cobrado en el período", t.collected]), row(["Por cobrar (hoy)", r.receivables.total])] },
      ...(r.monthly ? [{ sheet: "Por mes", columns: [{ width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }], data: [head(["Mes", "Ventas sin IVA", "Costos", "Gastos", "Resultado", "Cobrado"]),
        ...r.monthly.map((m) => row([m.month, m.sales, m.cost, m.overhead, m.result, m.collected]))] }] : []),
      { sheet: "Lo más vendido", columns: [{ width: 36 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 14 }], data: [head(["Servicio / producto", "Tipo", "Cantidad", "Venta", "Costo"]),
        ...r.top_items.map((x) => row([x.label, ITEM_KIND[x.kind] ?? "", Number(x.qty), Number(x.revenue), Number(x.cost)]))] },
      { sheet: "Clientes", columns: [{ width: 32 }, { width: 10 }, { width: 14 }], data: [head(["Cliente", "Ventas", "Monto sin IVA"]), ...r.top_customers.map((c) => row([c.name ?? "", c.count, Number(c.net)]))] },
      { sheet: "Por cobrar", columns: [{ width: 32 }, { width: 16 }, { width: 14 }, { width: 14 }], data: [head(["Cliente", "Teléfono", "Saldo", "Desde"]),
        ...r.receivables.customers.map((c) => row([c.name ?? "", c.phone ?? "", Number(c.balance), c.oldest ?? ""]))] },
      { sheet: "Gastos", columns: [{ width: 32 }, { width: 14 }], data: [head(["Categoría", "Monto"]), ...r.expenses_by_category.map((x) => row([EXPENSE_CATEGORIES[x.category] ?? x.category, Number(x.amount)]))] },
      { sheet: "Proveedores", columns: [{ width: 32 }, { width: 20 }, { width: 14 }], data: [head(["Proveedor", "Servicio", "Monto"]), ...r.suppliers.map((x) => row([x.name, x.service ?? "", Number(x.amount)]))] },
      ...(r.staff?.length ? [{ sheet: "Personal", columns: [{ width: 28 }, { width: 8 }, { width: 10 }, { width: 8 }, { width: 14 }, { width: 14 }], data: [head(["Persona", "Turnos", "Horas", "Faltas", "Pago", "Pendiente"]),
        ...r.staff.map((x) => row([x.name, x.shifts, Number(x.hours), x.absent, Number(x.pay), Number(x.unpaid)]))] }] : []),
    ];
    await writeXlsxFile(sheets).toFile(`Reporte ${range.from} a ${range.to}.xlsx`);
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Reportes" description="Cómo le fue a tu negocio: cuánto vendiste, cuánto te costó, cuánto te quedó y qué hay que cobrar."
        actions={r && <>
          <Button variant="secondary" className="print:hidden" icon={<Download className="size-4" />} onClick={() => void exportExcel()}>Excel</Button>
          <Button variant="secondary" className="print:hidden" icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button>
        </>} />

      <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
        <Select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} className="h-10 w-auto" aria-label="Período">
          {Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="custom">Elegir fechas…</option>
        </Select>
        {period === "custom" && <>
          <Input type="date" value={custom.from} onChange={(e) => setCustom((s) => ({ ...s, from: e.target.value }))} className="h-10 w-auto" aria-label="Desde" />
          <Input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((s) => ({ ...s, to: e.target.value }))} className="h-10 w-auto" aria-label="Hasta" />
        </>}
        <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 w-auto" aria-label="Moneda"><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>
        <span className="text-sm text-muted">{dateText(range.from)} – {dateText(range.to)}</span>
      </div>
      <p className="mb-4 hidden text-sm print:block">{ws.name} · {dateText(range.from)} – {dateText(range.to)} · {currency === "USD" ? "Dólares" : "Córdobas"}</p>

      {isLoading ? <Spinner /> : error ? <Alert tone="danger">{(error as Error).message}</Alert> : !r ? null : (
        <>
          <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line print:hidden" role="tablist">
            {tabs.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
            ))}
          </div>
          <div className={cx(tab !== "resumen" && "hidden print:block")}><Summary r={r} money={money} /></div>
          <div className={cx("print:mt-6", tab !== "ventas" && "hidden print:block")}><Sales r={r} money={money} /></div>
          <div className={cx("print:mt-6", tab !== "cobros" && "hidden print:block")}><Receivables r={r} money={money} dateText={dateText} /></div>
          <div className={cx("print:mt-6", tab !== "gastos" && "hidden print:block")}><Spending r={r} money={money} /></div>
          {hasOps && <div className={cx("print:mt-6", tab !== "operacion" && "hidden print:block")}><Operations r={r} money={money} /></div>}
          <p className="mt-6 text-xs text-muted">Ventas sin IVA: cotizaciones aceptadas, reservaciones de alquiler y reservas de salón confirmadas, por la fecha de aceptación o del evento. Los costos usan lo estimado en la venta o lo real (gastos del evento y personal), el que sea mayor. Son las mismas reglas de Finanzas.</p>
        </>
      )}
    </div>
  );
}

function Summary({ r, money }: { r: Report; money: (n: number) => string }) {
  const { ws, region } = useWorkspace();
  const t = r.totals, p = r.previous;
  const months = (r.monthly ?? []).map((m) => ({ key: m.month, label: new Intl.DateTimeFormat(region.locale, { month: "short" }).format(new Date(`${m.month}-15T12:00:00Z`)) }));
  const marginPct = t.sales ? Math.round((t.result / t.sales) * 100) : null;
  if (!t.deals && !t.overhead && !t.collected && !t.cost) {
    return <Card><EmptyState icon={<BarChart3 className="size-6" />} title="Sin movimientos en este período">Elige otro período o moneda. Aquí verás tus ventas cuando aceptes cotizaciones o confirmes reservas.</EmptyState></Card>;
  }
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Resultado del período" description={p ? `Comparado con el período anterior (${formatDate(`${p.from}T12:00:00Z`, { timeZone: "UTC" })} – ${formatDate(`${p.to}T12:00:00Z`, { timeZone: "UTC" })}).` : "Ventas sin IVA − costo de lo vendido − gastos del negocio."} />
        <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
          <KPI label="Ventas sin IVA" value={money(t.sales)} delta={p ? change(t.sales, p.sales) : null} hint={plural(t.deals, "venta", "ventas")} />
          <KPI label="Costo de lo vendido" value={money(t.cost)} delta={p ? change(t.cost, p.cost) : null} goodWhenUp={false} hint={t.staff ? `personal ${money(t.staff)}` : undefined} />
          <KPI label="Gastos del negocio" value={money(t.overhead)} delta={p ? change(t.overhead, p.overhead) : null} goodWhenUp={false} />
          <KPI label={t.result >= 0 ? "Te quedó" : "Perdiste"} value={money(t.result)} tone={t.result >= 0 ? "ok" : "danger"} delta={p ? change(t.result, p.result) : null} hint={marginPct !== null ? `${marginPct}% de lo vendido` : undefined} />
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
          <KPI label="Cobrado en el período" value={money(t.collected)} delta={p ? change(t.collected, p.collected) : null} />
          <KPI label="Por cobrar (hoy)" value={money(r.receivables.total)} hint="Saldos de clientes, con IVA" />
        </div>
        {t.tax > 0 && <p className="border-t border-line px-5 py-3 text-xs text-muted">Además cobraste {money(t.tax)} de IVA, que se paga a la DGI y no es ganancia.</p>}
      </Card>
      {r.monthly ? (
        <Card>
          <CardHeader title="Ventas sin IVA, mes a mes" description="Últimos 12 meses. Pasa el cursor (o toca) una columna para ver costos, gastos y resultado." />
          <MonthColumns months={months} value={(i) => r.monthly![i]!.sales} format={money} label="Ventas sin IVA por mes"
            detail={(i) => { const m = r.monthly![i]!; return (
              <dl className="space-y-0.5">
                {[["Ventas", m.sales], ["Costos", -m.cost], ["Gastos", -m.overhead], ["Resultado", m.result]].map(([l, v]) => (
                  <div key={l as string} className={cx("flex justify-between gap-3", l === "Resultado" && "border-t border-line pt-1 font-semibold")}><dt>{l}</dt><dd className="tabular-nums">{money(v as number)}</dd></div>
                ))}
              </dl>); }} />
          <details className="border-t border-line px-5 py-3 text-sm">
            <summary className="cursor-pointer text-muted">Ver como tabla</summary>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] text-sm tabular-nums">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1">Mes</th><th className="text-right">Ventas</th><th className="text-right">Costos</th><th className="text-right">Gastos</th><th className="text-right">Resultado</th></tr></thead>
              <tbody className="divide-y divide-line">{r.monthly.map((m, i) => (
                <tr key={m.month}><td className="py-1.5 capitalize">{months[i]!.label} {m.month.slice(0, 4)}</td><td className="text-right">{money(m.sales)}</td><td className="text-right">{money(m.cost)}</td><td className="text-right">{money(m.overhead)}</td>
                  <td className={cx("text-right font-semibold", m.result < 0 && "text-danger")}>{money(m.result)}</td></tr>))}</tbody>
            </table></div>
          </details>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center gap-3 p-5 print:hidden">
          <Lock className="size-5 text-muted" />
          <p className="min-w-0 flex-1 text-sm text-muted"><span className="font-semibold text-ink">Comparación con el período anterior y tendencia de 12 meses</span> están incluidas en los planes con Reportes avanzados (por ejemplo, los planes anuales).</p>
          <Link to={workspacePath(ws.kind, ws.id, "suscripcion")} className="text-sm font-semibold text-[var(--accent)]">Ver planes</Link>
        </Card>
      )}
    </div>
  );
}

function Sales({ r, money }: { r: Report; money: (n: number) => string }) {
  const q = r.quotes;
  const decided = q.accepted + q.rejected + q.expired;
  const closeRate = decided ? Math.round((q.accepted / decided) * 100) : null;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Cotizaciones del período" description="Emitidas en estas fechas y cómo terminaron." />
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          <KPI label="Hechas" value={String(q.total)} hint={q.draft ? `${q.draft} en borrador` : undefined} />
          <KPI label="Esperando respuesta" value={String(q.sent)} hint={q.sent ? "Dales seguimiento" : undefined} />
          <KPI label="Aceptadas" value={String(q.accepted)} hint={closeRate !== null ? `${closeRate}% de las respondidas` : undefined} />
          <KPI label="Ticket promedio" value={q.accepted ? money(q.accepted_net / q.accepted) : "—"} hint={q.avg_days_to_accept != null ? `aceptan en ${q.avg_days_to_accept} días` : "sin IVA"} />
        </div>
        {(q.rejected > 0 || q.expired > 0) && <p className="border-t border-line px-5 py-3 text-xs text-muted">{plural(q.rejected, "rechazada", "rechazadas")} y {plural(q.expired, "vencida", "vencidas")}. Cotizado en total (sin IVA): {money(q.quoted_net)}.</p>}
      </Card>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Lo más vendido" description="Por monto vendido, antes de descuentos generales." />
          <RankBars format={money} empty="Sin ventas con detalle en este período." rows={r.top_items.slice(0, 10).map((x) => ({ key: x.label, label: x.label, value: Number(x.revenue),
            note: [ITEM_KIND[x.kind], `${Number(x.qty)} u.`, Number(x.cost) > 0 && Number(x.revenue) > 0 ? `margen ${Math.round(((Number(x.revenue) - Number(x.cost)) / Number(x.revenue)) * 100)}%` : null].filter(Boolean).join(" · ") }))} />
        </Card>
        <Card>
          <CardHeader title="Mejores clientes" description="Ventas sin IVA del período." />
          <RankBars format={money} empty="Sin ventas en este período." rows={r.top_customers.map((c) => ({ key: c.id, label: c.name ?? "Cliente", value: Number(c.net), note: plural(c.count, "venta", "ventas") }))} />
        </Card>
        <Card>
          <CardHeader title="Ventas por tipo de evento" />
          <RankBars format={money} empty="Sin ventas en este período." rows={r.by_category.map((c) => ({ key: c.category ?? "none", label: c.category ? (EVENT_CATEGORIES[c.category] ?? c.category) : "Sin evento asignado", value: Number(c.net), note: plural(c.count, "venta", "ventas") }))} />
        </Card>
        <Card>
          <CardHeader title="Clientes nuevos y cómo llegaron" description="Según el campo “Cómo nos conoció” del cliente." />
          <RankBars format={(n) => String(n)} empty="No registraste clientes nuevos en este período." rows={r.new_customers.map((c) => ({ key: c.source ?? "none", label: c.source ?? "Sin dato", value: c.count }))} />
        </Card>
      </div>
    </div>
  );
}

function Receivables({ r, money, dateText }: { r: Report; money: (n: number) => string; dateText: (d: string) => string }) {
  const { ws } = useWorkspace();
  const b = r.receivables.buckets;
  const buckets: [string, number, string][] = [["Evento aún no pasa", b.upcoming, ""], ["1 a 30 días", b.d30, ""], ["31 a 60 días", b.d60, "warn"], ["61 a 90 días", b.d90, "danger"], ["Más de 90 días", b.d90plus, "danger"]];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={`Por cobrar hoy: ${money(r.receivables.total)}`} description="Antigüedad desde la fecha del evento o de la venta. Los pagos de cada cliente se aplican primero a lo más antiguo." />
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
          {buckets.map(([l, v, tone]) => <KPI key={l} label={l} value={money(v)} tone={v > 0 && tone === "danger" ? "danger" : undefined} />)}
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Quién te debe" />
          {!r.receivables.customers.length ? <p className="px-5 pb-5 text-sm text-muted">Nadie te debe. 🎉</p> : (
            <ul className="divide-y divide-line">{r.receivables.customers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <Link to={workspacePath(ws.kind, ws.id, `m/customers/${c.id}`)} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.name}</Link>
                {c.oldest && <span className="text-xs text-muted">desde {dateText(c.oldest)}</span>}
                <span className="font-semibold tabular-nums">{money(Number(c.balance))}</span>
                {c.phone && <a href={`https://wa.me/${waNumber(c.phone)}`} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-[#1f8b4c] hover:bg-ink/5 print:hidden" aria-label={`Escribir a ${c.name}`}><MessageCircle className="size-4" /></a>}
              </li>))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Cobrado por forma de pago" description="Pagos recibidos en el período." />
          <RankBars format={money} empty="Sin pagos en este período." rows={r.payments_by_method.map((p) => ({ key: p.method ?? "none", label: METHODS[p.method ?? ""] ?? p.method ?? "Sin dato", value: Number(p.amount), note: plural(p.count, "pago", "pagos") }))} />
        </Card>
      </div>
    </div>
  );
}

function Spending({ r, money }: { r: Report; money: (n: number) => string }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Gastos del negocio por tipo" description="Alquiler, salarios, servicios… registrados en Finanzas." />
          <RankBars format={money} empty="Sin gastos del negocio en este período." rows={r.expenses_by_category.map((x) => ({ key: x.category, label: EXPENSE_CATEGORIES[x.category] ?? x.category, value: Number(x.amount) }))} />
        </Card>
        <Card>
          <CardHeader title="A quién le compras más" description="Costos con proveedor en ventas, eventos y gastos del período." />
          <RankBars format={money} empty="Sin costos asignados a proveedores en este período." rows={r.suppliers.map((x) => ({ key: x.id, label: x.name, value: Number(x.amount), note: x.service ?? undefined }))} />
        </Card>
      </div>
      {r.staff && (
        <Card>
          <CardHeader title="Personal" description="Turnos del período: horas, faltas y lo que se paga a cada persona." />
          {!r.staff.length ? <p className="px-5 pb-5 text-sm text-muted">Sin turnos en este período.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm tabular-nums">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><tr><th className="px-5 py-2 font-semibold">Persona</th><th className="px-3 py-2 text-right font-semibold">Turnos</th><th className="px-3 py-2 text-right font-semibold">Horas</th><th className="px-3 py-2 text-right font-semibold">Faltas</th><th className="px-3 py-2 text-right font-semibold">Pago</th><th className="px-5 py-2 text-right font-semibold">Sin pagar</th></tr></thead>
              <tbody className="divide-y divide-line">{r.staff.map((x) => (
                <tr key={x.id}><td className="px-5 py-2.5">{x.name}</td><td className="px-3 text-right">{x.shifts}</td><td className="px-3 text-right">{Number(x.hours)}</td>
                  <td className={cx("px-3 text-right", x.absent > 0 && "font-semibold text-danger")}>{x.absent}</td><td className="px-3 text-right font-semibold">{money(Number(x.pay))}</td>
                  <td className={cx("px-5 text-right", Number(x.unpaid) > 0 && "text-warn")}>{money(Number(x.unpaid))}</td></tr>))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}

function Operations({ r, money }: { r: Report; money: (n: number) => string }) {
  const days = r.period.days;
  const bestSource = useMemo(() => (r.venues?.sources ?? []).filter((s) => s.total > 0).sort((a, b) => b.won / b.total - a.won / a.total)[0], [r]);
  return (
    <div className="space-y-5">
      {r.venues && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title="Ocupación de tus espacios" description={`Días con evento confirmado, de ${days} días del período.`} />
            <RankBars format={(n) => `${n}%`} max={100} empty="No tienes espacios activos." rows={r.venues.spaces.map((s) => ({ key: s.id, label: s.name, value: Math.round((s.days / days) * 100),
              note: `${plural(s.days, "día", "días")} · ${plural(s.events, "evento", "eventos")} · ${money(Number(s.net))}` }))} />
          </Card>
          <Card>
            <CardHeader title="Consultas por canal" description={bestSource ? `El canal que más cierra: ${SOURCES[bestSource.source ?? ""] ?? "Sin dato"} (${Math.round((bestSource.won / bestSource.total) * 100)}%).` : "Consultas recibidas en el período y cuántas se confirmaron."} />
            <RankBars format={(n) => String(n)} empty="Sin consultas en este período." rows={r.venues.sources.map((s) => ({ key: s.source ?? "none", label: SOURCES[s.source ?? ""] ?? "Sin dato", value: s.total, note: `${s.won} confirmadas` }))} />
          </Card>
        </div>
      )}
      {r.rental && (
        <Card>
          <CardHeader title="Uso del inventario" description={`Uso = unidades alquiladas × días ÷ (existencia × ${days} días). Ayuda a saber qué comprar más y qué está parado.`} />
          {!r.rental.resources.length ? <p className="px-5 pb-5 text-sm text-muted">Sin alquileres en este período.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm tabular-nums">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><tr><th className="px-5 py-2 font-semibold">Artículo</th><th className="px-3 py-2 text-right font-semibold">Existencia</th><th className="px-3 py-2 text-right font-semibold">Unidades alquiladas</th><th className="px-3 py-2 text-right font-semibold">Venta</th><th className="px-5 py-2 text-right font-semibold">Uso</th></tr></thead>
              <tbody className="divide-y divide-line">{r.rental.resources.map((x) => (
                <tr key={x.id}><td className="px-5 py-2.5">{x.name}</td><td className="px-3 text-right">{x.total_qty}</td><td className="px-3 text-right">{Number(x.units)}</td><td className="px-3 text-right">{money(Number(x.revenue))}</td>
                  <td className="px-5 text-right"><span className="inline-flex items-center gap-2"><span className="h-1.5 w-16 rounded-full bg-line"><span className="block h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Number(x.utilization))}%` }} /></span>{Number(x.utilization)}%</span></td></tr>))}</tbody>
            </table></div>
          )}
          {Number(r.rental.damages) > 0 && <p className="border-t border-line px-5 py-3 text-xs text-muted">Cobrado por daños y faltantes en el período: {money(Number(r.rental.damages))}.</p>}
        </Card>
      )}
    </div>
  );
}
