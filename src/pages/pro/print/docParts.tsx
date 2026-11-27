import { formatDate, formatMoney } from "@/lib/format";

export interface DocBusiness { name: string; tax_id: string | null; phone: string | null; email: string | null; address: string | null; logo_url: string | null }

/** Encabezado de documentos comerciales: datos del negocio y número del documento. */
export function DocHeader({ business, title, number }: { business: DocBusiness; title: string; number: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-5">
      <div className="flex items-start gap-3">
        {business.logo_url && <img src={business.logo_url} alt="" className="size-14 rounded-lg object-contain" />}
        <div className="text-sm">
          <div className="font-display text-xl font-semibold">{business.name}</div>
          {business.tax_id && <div className="text-muted">RUC / Cédula: {business.tax_id}</div>}
          {[business.phone, business.email].filter(Boolean).length > 0 && <div className="text-muted">{[business.phone, business.email].filter(Boolean).join(" · ")}</div>}
          {business.address && <div className="text-muted">{business.address}</div>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">{title}</div>
        <div className="font-mono text-lg font-semibold">{number}</div>
      </div>
    </header>
  );
}

export interface QuoteDocData {
  quote: { title: string; issue_date: string; valid_until: string | null; currency_code: string; subtotal: number; discount_amount: number; tax_rate: number;
    tax_amount: number; total: number; deposit_pct: number; terms: string | null; status: string; accepted_name?: string | null; accepted_at?: string | null };
  items: { description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number }[];
  customer: { name: string };
  event: { name: string; starts_at: string | null; venue_name: string | null } | null;
}

const d = (iso: string | null) => (iso ? formatDate(`${iso}T12:00:00Z`, { timeZone: "UTC" }) : "—");

/** Cuerpo de la cotización (tabla, totales y condiciones). */
export function QuoteBody({ data, locale, timezone }: { data: QuoteDocData; locale: string; timezone: string }) {
  const q = data.quote;
  const m = (n: number) => formatMoney(Number(n), q.currency_code, locale);
  const disc = Math.min(Number(q.discount_amount), Number(q.subtotal));
  const deposit = Math.round(Number(q.total) * Number(q.deposit_pct)) / 100;
  return (
    <>
      <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Cliente</div>
          <div className="mt-0.5 font-semibold">{data.customer.name}</div>
          {data.event && <div className="text-ink-soft">{data.event.name}{data.event.starts_at ? ` · ${formatDate(data.event.starts_at, { timeZone: timezone, locale })}` : ""}{data.event.venue_name ? ` · ${data.event.venue_name}` : ""}</div>}
        </div>
        <div className="sm:text-right">
          <div><span className="text-muted">Fecha:</span> {d(q.issue_date)}</div>
          {q.valid_until && <div><span className="text-muted">Válida hasta:</span> {d(q.valid_until)}</div>}
        </div>
      </div>
      <h1 className="mt-6 font-display text-2xl font-semibold">{q.title}</h1>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead><tr className="border-b border-line-strong text-left text-xs uppercase tracking-wider text-muted">
            <th className="py-2 pr-3 font-semibold">Descripción</th><th className="w-16 py-2 text-right font-semibold">Cant.</th>
            <th className="w-28 py-2 text-right font-semibold">Precio</th><th className="w-16 py-2 text-right font-semibold">Desc.</th><th className="w-28 py-2 text-right font-semibold">Total</th>
          </tr></thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={i} className="no-break border-b border-line align-top">
                <td className="py-2.5 pr-3">{it.description}</td>
                <td className="py-2.5 text-right tabular-nums">{Number(it.quantity)}</td>
                <td className="py-2.5 text-right tabular-nums">{m(it.unit_price)}</td>
                <td className="py-2.5 text-right tabular-nums">{Number(it.discount_pct) ? `${Number(it.discount_pct)}%` : ""}</td>
                <td className="py-2.5 text-right font-medium tabular-nums">{m(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="no-break mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular-nums">{m(q.subtotal)}</span></div>
        {disc > 0 && <div className="flex justify-between"><span className="text-muted">Descuento</span><span className="tabular-nums">−{m(disc)}</span></div>}
        {Number(q.tax_rate) > 0 && <div className="flex justify-between"><span className="text-muted">IVA ({Number(q.tax_rate)}%)</span><span className="tabular-nums">{m(q.tax_amount)}</span></div>}
        <div className="flex justify-between border-t-2 border-ink pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{m(q.total)}</span></div>
        {Number(q.deposit_pct) > 0 && <div className="flex justify-between text-ink-soft"><span>Anticipo requerido ({Number(q.deposit_pct)}%)</span><span className="tabular-nums">{m(deposit)}</span></div>}
      </div>
      {q.terms && (
        <section className="no-break mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Términos y condiciones</h2>
          <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{q.terms}</p>
        </section>
      )}
      {q.status === "accepted" && q.accepted_name && (
        <p className="mt-6 text-sm text-ok">Aceptada por {q.accepted_name}{q.accepted_at ? ` el ${formatDate(q.accepted_at, { timeZone: timezone, withTime: true })}` : ""}.</p>
      )}
    </>
  );
}
