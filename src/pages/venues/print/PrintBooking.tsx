import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import type { Customer } from "@/lib/pro";
import { SETUPS, VENUE_KINDS, capacityFor, docBooking, minutesText, scheduleText, type Booking, type BookingItem, type Venue } from "@/lib/venues";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { PrintLayout, Sheet } from "@/components/PrintLayout";
import { Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";
import { HeaderClassic, type DocBusiness } from "@/pages/pro/print/documents";
import { toDocBusiness, useBusiness } from "@/pages/pro/print/PrintQuote";

type Full = Booking & { customers: Pick<Customer, "name" | "phone" | "tax_id" | "address"> | null; venues: Venue };

/** Confirmación de reserva (con precios y firmas) u hoja del evento para el equipo (sin precios). */
export default function PrintBooking({ id, kind }: { id: string; kind: "confirmacion" | "hoja" }) {
  const { ws, region } = useWorkspace();
  const biz = useBusiness(ws.id);
  const q = useQuery({
    queryKey: ["print-booking", id],
    queryFn: async () => ({
      b: unwrap<Full>(await supabase.from("bookings").select("*, customers(name, phone, tax_id, address), venues(*)").eq("id", id).single()),
      items: unwrap<BookingItem[]>(await supabase.from("booking_items").select("*").eq("booking_id", id).order("sort").order("id")),
    }),
  });
  if (q.isLoading || biz.isLoading) return <Spinner />;
  if (!q.data || !biz.data) return <NotFound />;
  const { b, items } = q.data;
  const doc = toDocBusiness(biz.data);
  return (
    <PrintLayout title={`${kind === "hoja" ? "Hoja del evento" : "Confirmación de reserva"} ${docBooking(b.number)}`} backTo={workspacePath(ws.kind, ws.id, `m/bookings/${id}`)} paper="letter">
      <Sheet paper="letter" className="px-10 py-9 print:p-0">
        {kind === "hoja" ? <EventSheet b={b} items={items} biz={doc} tz={region.timezone} locale={region.locale} />
          : <Confirmation b={b} items={items} biz={doc} tz={region.timezone} locale={region.locale} />}
      </Sheet>
    </PrintLayout>
  );
}

type P = { b: Full; items: BookingItem[]; biz: DocBusiness; tz: string; locale: string };
const label = (accent: string, t: string) => <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>{t}</div>;

function Facts({ b, tz, locale, accent }: Omit<P, "items" | "biz"> & { accent: string }) {
  const v = b.venues;
  const t = (x: Date) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(x);
  const s = new Date(b.starts_at), e = new Date(b.ends_at);
  const setupFrom = new Date(s.getTime() - b.setup_minutes * 60_000), teardownTo = new Date(e.getTime() + b.teardown_minutes * 60_000);
  return (
    <div className="mt-6 grid grid-cols-2 gap-6 text-[12.5px] leading-relaxed">
      <div>
        {label(accent, "Cliente")}
        <div className="mt-1 text-[14px] font-semibold">{b.customers?.name ?? "—"}</div>
        <div className="text-ink-soft">{[b.customers?.tax_id && `Cédula / RUC: ${b.customers.tax_id}`, b.customers?.phone].filter(Boolean).map((l) => <div key={l as string}>{l}</div>)}</div>
      </div>
      <div>
        {label(accent, "Espacio y horario")}
        <table className="mt-1 w-full"><tbody className="align-top">
          <tr><td className="pr-3 text-ink-soft">Espacio</td><td className="font-semibold">{v.name} <span className="font-normal text-ink-soft">({VENUE_KINDS[v.kind] ?? v.kind})</span></td></tr>
          <tr><td className="pr-3 text-ink-soft">Fecha</td><td className="font-semibold">{scheduleText(b.starts_at, b.ends_at, tz, locale)}</td></tr>
          {b.setup_minutes > 0 && <tr><td className="pr-3 text-ink-soft">Montaje</td><td>desde las {t(setupFrom)} ({minutesText(b.setup_minutes)} antes)</td></tr>}
          {b.teardown_minutes > 0 && <tr><td className="pr-3 text-ink-soft">Desmontaje</td><td>hasta las {t(teardownTo)}</td></tr>}
          <tr><td className="pr-3 text-ink-soft">Montaje de mesas</td><td>{SETUPS[b.setup].label}{b.guests ? ` · ${b.guests} invitados` : ""}{capacityFor(v, b.setup) ? ` (capacidad ${capacityFor(v, b.setup)})` : ""}</td></tr>
        </tbody></table>
      </div>
    </div>
  );
}

function Confirmation({ b, items, biz, tz, locale }: P) {
  const accent = biz.brand_color || "#1d1530";
  const m = (n: number) => formatMoney(Number(n), b.currency_code, locale);
  const disc = Math.min(Number(b.discount_amount), Number(b.subtotal));
  const advance = Math.round(Number(b.total) * Number(b.advance_pct)) / 100;
  const status = b.status === "confirmed" || b.status === "done" ? "Reserva confirmada" : b.status === "hold" ? `Fecha apartada hasta el ${formatDate(b.hold_until, { timeZone: tz, locale })}` : "Cotización de reserva (la fecha aún no está apartada)";
  return (
    <div>
      <HeaderClassic b={biz} kind="Reserva" number={docBooking(b.number)} />
      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-[22px] font-semibold leading-tight">{b.title}</h1>
        <span className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white" style={{ background: accent }}>{status}</span>
      </div>
      <Facts b={b} tz={tz} locale={locale} accent={accent} />
      <table className="mt-7 w-full text-[12.5px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.15em] text-white" style={{ background: accent }}>
          <th className="px-3 py-2 font-semibold">Concepto</th><th className="px-3 py-2 text-right font-semibold">Cant.</th><th className="px-3 py-2 text-right font-semibold">Precio</th><th className="px-3 py-2 text-right font-semibold">Total</th>
        </tr></thead>
        <tbody>{items.map((it, i) => (
          <tr key={it.id} className={i % 2 ? "bg-paper/70" : ""}>
            <td className="px-3 py-2">{it.description}</td><td className="px-3 py-2 text-right tabular-nums">{Number(it.quantity)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{m(Number(it.unit_price))}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{m(Number(it.line_total))}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="no-break mt-4 flex justify-end">
        <dl className="w-72 space-y-1.5 text-[13px]">
          <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd className="tabular-nums">{m(Number(b.subtotal))}</dd></div>
          {disc > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Descuento</dt><dd className="tabular-nums">−{m(disc)}</dd></div>}
          {Number(b.tax_rate) > 0 && <div className="flex justify-between"><dt className="text-ink-soft">IVA ({Number(b.tax_rate)}%)</dt><dd className="tabular-nums">{m(Number(b.tax_amount))}</dd></div>}
          <div className="flex justify-between border-t-2 pt-2 text-[15px] font-semibold" style={{ borderColor: accent }}><dt>Total</dt><dd className="font-display text-[20px] tabular-nums">{m(Number(b.total))}</dd></div>
          {Number(b.advance_pct) > 0 && <div className="flex justify-between" style={{ color: accent }}><dt>Anticipo para confirmar ({Number(b.advance_pct)}%)</dt><dd className="font-semibold tabular-nums">{m(advance)}</dd></div>}
          {Number(b.deposit_amount) > 0 && <div className="flex justify-between rounded-md bg-paper px-2 py-1"><dt>Garantía (reembolsable)</dt><dd className="font-semibold tabular-nums">{m(Number(b.deposit_amount))}</dd></div>}
        </dl>
      </div>
      {(b.venues.includes || b.venues.rules) && (
        <section className="no-break mt-6 grid grid-cols-2 gap-6 text-[11.5px] leading-relaxed">
          {b.venues.includes && <div>{label(accent, "Incluye")}<p className="mt-1 whitespace-pre-line text-ink-soft">{b.venues.includes}</p></div>}
          {b.venues.rules && <div>{label(accent, "Reglas del espacio")}<p className="mt-1 whitespace-pre-line text-ink-soft">{b.venues.rules}</p></div>}
        </section>
      )}
      <section className="no-break mt-6">
        {label(accent, "Condiciones")}
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[11.5px] leading-relaxed text-ink-soft">
          <li>La fecha queda reservada al recibir el anticipo indicado{b.status === "hold" && b.hold_until ? `, a más tardar el ${formatDate(b.hold_until, { timeZone: tz, locale })}` : ""}.</li>
          <li>El saldo debe cancelarse antes del inicio del montaje.</li>
          <li>La garantía se devuelve después del evento, descontando daños o limpieza extraordinaria si los hubiera.</li>
          <li>El uso del espacio fuera del horario contratado se cobra como hora adicional.</li>
        </ol>
      </section>
      <div className="no-break mt-12 grid grid-cols-2 gap-10 text-center">
        {[[biz.signer_name || biz.name, biz.name], [b.customers?.name ?? "", "El cliente"]].map(([n, r]) => (
          <div key={r}><div className="h-14" /><div className="border-t-[1.5px] border-ink pt-2 text-[12.5px] font-semibold">{n || "Nombre: ________________"}</div>
            <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>{r}</div></div>
        ))}
      </div>
    </div>
  );
}

function EventSheet({ b, items, biz, tz, locale }: P) {
  const accent = biz.brand_color || "#1d1530";
  const box = <span className="inline-block size-4 rounded-sm border-[1.5px] border-ink/60 align-middle" />;
  const checklist = ["Espacio limpio y ordenado", "Baños limpios y con insumos", "Aire acondicionado / ventiladores", "Iluminación y tomas eléctricas", "Planta eléctrica revisada", "Mesas y sillas según el montaje", "Parqueo y seguridad asignados", "Entrega del espacio al cliente"];
  return (
    <div>
      <HeaderClassic b={biz} kind="Hoja del evento" number={docBooking(b.number)} />
      <h1 className="mt-6 font-display text-[22px] font-semibold leading-tight">{b.title}</h1>
      <Facts b={b} tz={tz} locale={locale} accent={accent} />
      {b.customers?.phone && <p className="mt-3 text-[12.5px]">Contacto del cliente: <b>{b.customers.name}</b> · {b.customers.phone}</p>}
      <section className="mt-6">
        {label(accent, "Servicios contratados")}
        <ul className="mt-1 list-disc pl-5 text-[12.5px]">{items.map((it) => <li key={it.id}>{Number(it.quantity) !== 1 ? `${Number(it.quantity)} × ` : ""}{it.description}</li>)}{!items.length && <li className="list-none text-ink-soft">—</li>}</ul>
      </section>
      {b.ops_notes && <section className="mt-5">{label(accent, "Indicaciones")}<p className="mt-1 whitespace-pre-line rounded-lg border border-line px-4 py-3 text-[12.5px]">{b.ops_notes}</p></section>}
      {b.venues.rules && <section className="mt-5">{label(accent, "Reglas del espacio")}<p className="mt-1 whitespace-pre-line text-[11.5px] text-ink-soft">{b.venues.rules}</p></section>}
      <section className="no-break mt-6">
        {label(accent, "Lista de revisión")}
        <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">{checklist.map((c) => <li key={c} className="flex items-center gap-2">{box}{c}</li>)}</ul>
      </section>
      <section className="no-break mt-6">
        {label(accent, "Observaciones al cierre")}
        <div className="mt-2 space-y-5">{[0, 1, 2].map((i) => <div key={i} className="border-b border-line-strong" />)}</div>
        <div className="mt-10 grid grid-cols-2 gap-10 text-center text-[11px]">
          {["Responsable del local", "Cliente / responsable del evento"].map((r) => <div key={r}><div className="border-t-[1.5px] border-ink pt-2 font-semibold uppercase tracking-[0.15em]" style={{ color: accent }}>{r}</div></div>)}
        </div>
      </section>
    </div>
  );
}
