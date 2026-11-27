import type { ReactNode } from "react";
import { formatDate, formatMoney } from "@/lib/format";
import type { ContractStyle, QuoteTemplate } from "@/lib/pro";
import { cx } from "@/components/ui";

export interface DocBusiness {
  name: string; tax_id: string | null; phone: string | null; email: string | null; address: string | null;
  logo_url: string | null; brand_color: string | null; signature_url: string | null; signer_name: string | null; signer_title: string | null;
}

export interface QuoteDocData {
  number: string;
  quote: { title: string; issue_date: string; valid_until: string | null; currency_code: string; subtotal: number; discount_amount: number; tax_rate: number;
    tax_amount: number; total: number; deposit_pct: number; terms: string | null; intro: string | null; template: QuoteTemplate; status: string;
    accepted_name?: string | null; accepted_at?: string | null };
  items: { description: string; details: string | null; image_url: string | null; quantity: number; unit_price: number; discount_pct: number; line_total: number }[];
  customer: { name: string };
  event: { name: string; starts_at: string | null; venue_name: string | null } | null;
}

export interface ContractDocData {
  number: string;
  contract: { title: string; body: string; status: string; amount: number | null; currency_code: string; template: ContractStyle;
    include_provider_signature: boolean; accepted_at: string | null; accepted_name: string | null; accepted_id_doc: string | null;
    accepted_signature: string | null; accepted_hash: string | null; accepted_ip?: string | null; created_at: string };
  customer: { name: string; tax_id: string | null };
}

const dateOnly = (iso: string | null) => (iso ? formatDate(`${iso}T12:00:00Z`, { timeZone: "UTC" }) : "—");
const brand = (b: DocBusiness) => b.brand_color || "#1d1530";

// ------------------------------------------------------------------ Encabezados
function BusinessLines({ b, align = "left", light }: { b: DocBusiness; align?: "left" | "center" | "right"; light?: boolean }) {
  const lines = [b.tax_id && `RUC / Cédula: ${b.tax_id}`, [b.phone, b.email].filter(Boolean).join(" · "), b.address].filter(Boolean) as string[];
  return (
    <div className={cx("text-[12.5px] leading-relaxed", light ? "text-white/80" : "text-ink-soft", align === "center" && "text-center", align === "right" && "text-right")}>
      {lines.map((l) => <div key={l}>{l}</div>)}
    </div>
  );
}

function Logo({ b, size = 64, className }: { b: DocBusiness; size?: number; className?: string }) {
  if (!b.logo_url) return null;
  return <img src={b.logo_url} alt="" className={cx("object-contain", className)} style={{ width: size, height: size }} />;
}

function HeaderClassic({ b, kind, number }: { b: DocBusiness; kind: string; number: string }) {
  return (
    <header className="flex items-start justify-between gap-6 pb-5" style={{ borderBottom: `3px solid ${brand(b)}` }}>
      <div className="flex items-start gap-4">
        <Logo b={b} size={68} className="rounded-lg" />
        <div>
          <div className="font-display text-[22px] font-semibold leading-tight">{b.name}</div>
          <BusinessLines b={b} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em]" style={{ color: brand(b) }}>{kind}</div>
        <div className="font-mono text-lg font-semibold">{number}</div>
      </div>
    </header>
  );
}

function HeaderBand({ b, kind, number }: { b: DocBusiness; kind: string; number: string }) {
  return (
    <header className="-mx-10 -mt-9 mb-2 flex items-center justify-between gap-6 px-10 py-7 text-white print:-mx-0 print:-mt-0 print:px-6" style={{ background: brand(b) }}>
      <div className="flex items-center gap-4">
        {b.logo_url && <div className="rounded-xl bg-white p-1.5"><Logo b={b} size={60} /></div>}
        <div>
          <div className="font-display text-[22px] font-semibold leading-tight">{b.name}</div>
          <BusinessLines b={b} light />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/75">{kind}</div>
        <div className="font-mono text-lg font-semibold">{number}</div>
      </div>
    </header>
  );
}

function HeaderElegant({ b, kind, number }: { b: DocBusiness; kind: string; number: string }) {
  return (
    <header className="pb-6 text-center">
      {b.logo_url && <Logo b={b} size={84} className="mx-auto mb-3" />}
      <div className="font-display text-[26px] font-semibold tracking-tight">{b.name}</div>
      <BusinessLines b={b} align="center" />
      <div className="mx-auto mt-5 flex max-w-sm items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: brand(b) }}>
        <span className="h-px flex-1" style={{ background: brand(b) }} />{kind} · {number}<span className="h-px flex-1" style={{ background: brand(b) }} />
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ Cotización
export function QuoteDocument({ data, business: b, locale, timezone, footer }: { data: QuoteDocData; business: DocBusiness; locale: string; timezone: string; footer?: ReactNode }) {
  const q = data.quote;
  const m = (n: number) => formatMoney(Number(n), q.currency_code, locale);
  const disc = Math.min(Number(q.discount_amount), Number(q.subtotal));
  const deposit = Math.round(Number(q.total) * Number(q.deposit_pct)) / 100;
  const t = q.template;
  const accent = brand(b);

  const meta = (
    <div className={cx("mt-6 grid gap-4 text-[13px] sm:grid-cols-2", t === "elegante" && "text-center sm:text-left")}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Preparada para</div>
        <div className="mt-0.5 text-[15px] font-semibold">{data.customer.name}</div>
        {data.event && <div className="text-ink-soft">{data.event.name}{data.event.starts_at ? ` · ${formatDate(data.event.starts_at, { timeZone: timezone, locale })}` : ""}{data.event.venue_name ? ` · ${data.event.venue_name}` : ""}</div>}
      </div>
      <div className="sm:text-right">
        <div><span className="text-muted">Fecha:</span> {dateOnly(q.issue_date)}</div>
        {q.valid_until && <div><span className="text-muted">Válida hasta:</span> {dateOnly(q.valid_until)}</div>}
      </div>
    </div>
  );

  const totals = (
    <div className="no-break mt-6 ml-auto w-full max-w-xs space-y-1.5 text-[13.5px]">
      <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular-nums">{m(q.subtotal)}</span></div>
      {disc > 0 && <div className="flex justify-between"><span className="text-muted">Descuento</span><span className="tabular-nums">−{m(disc)}</span></div>}
      {Number(q.tax_rate) > 0 && <div className="flex justify-between"><span className="text-muted">IVA ({Number(q.tax_rate)}%)</span><span className="tabular-nums">{m(q.tax_amount)}</span></div>}
      <div className="flex items-baseline justify-between pt-2 text-base font-semibold" style={{ borderTop: `2px solid ${accent}` }}>
        <span>Total</span><span className="font-display text-[22px] tabular-nums">{m(q.total)}</span>
      </div>
      {Number(q.deposit_pct) > 0 && <div className="flex justify-between rounded-lg px-2 py-1.5 font-medium" style={{ background: `${accent}12`, color: accent }}><span>Anticipo ({Number(q.deposit_pct)}%)</span><span className="tabular-nums">{m(deposit)}</span></div>}
    </div>
  );

  const terms = q.terms && (
    <section className="no-break mt-8">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: accent }}>Términos y condiciones</h2>
      <p className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-soft">{q.terms}</p>
    </section>
  );

  // Solo se muestra el detalle de cantidad/precio unitario cuando agrega información (evita repetir el total).
  const qtyLine = (it: QuoteDocData["items"][number]) =>
    Number(it.quantity) === 1 && !Number(it.discount_pct) ? ""
      : `${Number(it.quantity) !== 1 ? `${Number(it.quantity)} × ` : ""}${m(it.unit_price)}${Number(it.discount_pct) ? ` · −${Number(it.discount_pct)}%` : ""}`;

  let items: ReactNode;
  if (t === "catalogo") {
    items = (
      <div className="mt-6 space-y-4">
        {data.items.map((it, i) => (
          <article key={i} className="no-break grid overflow-hidden rounded-2xl border border-line sm:grid-cols-[42%_1fr]">
            {it.image_url ? <img src={it.image_url} alt="" className="aspect-[4/3] size-full object-cover" />
              : <div className="grid aspect-[4/3] place-items-center font-display text-4xl" style={{ background: `${accent}10`, color: `${accent}55` }}>{i + 1}</div>}
            <div className="flex flex-col p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>Opción {i + 1}</div>
              <h3 className="mt-1 font-display text-xl font-semibold leading-snug">{it.description}</h3>
              {it.details && <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{it.details}</p>}
              <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                <span className="text-[12px] text-muted">{qtyLine(it)}</span>
                <span className="rounded-full px-3 py-1 font-display text-lg font-semibold tabular-nums text-white" style={{ background: accent }}>{m(it.line_total)}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  } else if (t === "elegante") {
    items = (
      <div className="mt-8">
        {data.items.map((it, i) => (
          <div key={i} className="no-break flex gap-5 border-b border-line py-4 last:border-b-0">
            {it.image_url && <img src={it.image_url} alt="" className="size-24 shrink-0 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-display text-lg font-semibold">{it.description}</h3>
                <span className="shrink-0 font-display text-lg tabular-nums">{m(it.line_total)}</span>
              </div>
              {it.details && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{it.details}</p>}
              {qtyLine(it) && <div className="mt-1 text-[12px] text-muted">{qtyLine(it)}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    items = (
      <table className="mt-6 w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-white" style={{ background: accent }}>
            <th className="rounded-l-md px-3 py-2 font-semibold">Descripción</th><th className="w-14 px-2 py-2 text-right font-semibold">Cant.</th>
            <th className="w-24 px-2 py-2 text-right font-semibold">Precio</th><th className="w-14 px-2 py-2 text-right font-semibold">Desc.</th>
            <th className="w-28 rounded-r-md px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={i} className="no-break border-b border-line align-top">
              <td className="px-3 py-3">
                <div className="flex gap-3">
                  {it.image_url && <img src={it.image_url} alt="" className="size-14 shrink-0 rounded-md object-cover" />}
                  <div><div className="font-semibold">{it.description}</div>{it.details && <div className="mt-0.5 whitespace-pre-line text-[12px] leading-relaxed text-ink-soft">{it.details}</div>}</div>
                </div>
              </td>
              <td className="px-2 py-3 text-right tabular-nums">{Number(it.quantity)}</td>
              <td className="px-2 py-3 text-right tabular-nums">{m(it.unit_price)}</td>
              <td className="px-2 py-3 text-right tabular-nums">{Number(it.discount_pct) ? `${Number(it.discount_pct)}%` : ""}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{m(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className={cx(t === "elegante" && "font-[inherit]")}>
      {t === "catalogo" ? <HeaderBand b={b} kind="Cotización" number={data.number} /> : t === "elegante" ? <HeaderElegant b={b} kind="Propuesta" number={data.number} /> : <HeaderClassic b={b} kind="Cotización" number={data.number} />}
      {meta}
      <h1 className={cx("mt-6 font-display font-semibold leading-tight", t === "elegante" ? "text-center text-[30px]" : "text-[26px]")}>{q.title}</h1>
      {q.intro && <p className={cx("mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-soft", t === "elegante" && "mx-auto max-w-xl text-center")}>{q.intro}</p>}
      {items}
      {totals}
      {terms}
      {q.status === "accepted" && q.accepted_name && (
        <p className="mt-6 text-[13px] font-medium" style={{ color: "#177a4b" }}>Aceptada por {q.accepted_name}{q.accepted_at ? ` el ${formatDate(q.accepted_at, { timeZone: timezone, withTime: true })}` : ""}.</p>
      )}
      {footer}
      <p className="mt-10 text-center text-[11px] text-muted">{b.name}{b.phone ? ` · ${b.phone}` : ""}{b.email ? ` · ${b.email}` : ""}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Contrato
/** "PRIMERA. OBJETO." → encabezado de cláusula. */
export const CLAUSE_RE = /^([A-ZÁÉÍÓÚÑ]+\.\s[A-ZÁÉÍÓÚÑ ]+\.)\s([\s\S]*)$/;

/** Da formato al texto: títulos en mayúsculas y "PRIMERA. OBJETO." en negrita. */
function ContractBody({ body, accent, style }: { body: string; accent: string; style: ContractStyle }) {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={cx("text-[13.5px] leading-[1.75]", style === "clasica" && "text-justify")}>
      {paras.map((p, i) => {
        const isTitle = p === p.toUpperCase() && p.length < 140 && !/\d{3,}/.test(p);
        if (isTitle) return <h2 key={i} className={cx("mb-4 mt-2 text-center font-display text-[17px] font-semibold tracking-wide", i > 0 && "mt-6")} style={style !== "clasica" ? { color: accent } : undefined}>{p}</h2>;
        const m = p.match(CLAUSE_RE);
        const content = m ? <><strong style={style !== "clasica" ? { color: accent } : undefined}>{m[1]}</strong> {m[2]}</> : p;
        return style === "moderna" && m
          ? <p key={i} className="no-break mb-3 whitespace-pre-line rounded-r-lg py-1 pl-4" style={{ borderLeft: `3px solid ${accent}` }}>{content}</p>
          : <p key={i} className="mb-3 whitespace-pre-line">{content}</p>;
      })}
    </div>
  );
}

export function ContractDocument({ data, business: b, locale, timezone }: { data: ContractDocData; business: DocBusiness; locale: string; timezone: string }) {
  const k = data.contract;
  const accent = brand(b);
  const style = k.template;
  const signed = k.status === "accepted";
  const providerSig = k.include_provider_signature ? b.signature_url : null;

  const SigBlock = ({ img, name, sub, role }: { img: string | null; name: string; sub?: string | null; role: string }) => (
    <div className="text-center">
      <div className="flex h-24 items-end justify-center">{img && <img src={img} alt={`Firma de ${name}`} className="max-h-24 max-w-[85%] object-contain" />}</div>
      <div className="mt-1 border-t-[1.5px] border-ink pt-2 text-[13px] font-semibold">{name}</div>
      {sub && <div className="text-[12px] text-ink-soft">{sub}</div>}
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>{role}</div>
    </div>
  );

  return (
    <div>
      {style === "moderna" ? <HeaderBand b={b} kind="Contrato" number={data.number} /> : style === "elegante" ? <HeaderElegant b={b} kind="Contrato" number={data.number} /> : <HeaderClassic b={b} kind="Contrato" number={data.number} />}
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-[12.5px] text-ink-soft">
        <span>Cliente: <strong className="text-ink">{data.customer.name}</strong>{data.customer.tax_id ? ` · ${data.customer.tax_id}` : ""}</span>
        {k.amount != null && <span>Monto: <strong className="text-ink">{formatMoney(Number(k.amount), k.currency_code, locale)}</strong></span>}
      </div>
      <div className="mt-6"><ContractBody body={k.body} accent={accent} style={style} /></div>

      <section className="no-break mt-14">
        <div className="mb-8 text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-muted">Firmas</div>
        <div className="grid grid-cols-2 gap-10">
          <SigBlock img={providerSig} name={b.signer_name || b.name} sub={b.signer_title || (b.tax_id ? `RUC / Cédula ${b.tax_id}` : null)} role="El prestador" />
          <SigBlock img={signed ? k.accepted_signature : null} name={(signed && k.accepted_name) || data.customer.name}
            sub={(signed && k.accepted_id_doc) ? `Cédula ${k.accepted_id_doc}` : data.customer.tax_id ? `Cédula ${data.customer.tax_id}` : null} role="El cliente" />
        </div>
        {signed && (
          <p className="mt-8 rounded-lg border border-line px-4 py-3 text-[10.5px] leading-relaxed text-muted">
            Firmado electrónicamente por {k.accepted_name} el {formatDate(k.accepted_at, { timeZone: timezone, locale, withTime: true })}
            {k.accepted_ip ? ` desde la IP ${k.accepted_ip}` : ""}. Huella SHA-256 del texto firmado: <span className="break-all font-mono">{k.accepted_hash}</span>
          </p>
        )}
      </section>
    </div>
  );
}
