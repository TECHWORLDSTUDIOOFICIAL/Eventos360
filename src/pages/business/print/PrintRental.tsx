import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { docNumber, type Customer } from "@/lib/pro";
import type { Rental, RentalItem } from "@/lib/rental";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { PrintLayout, Sheet } from "@/components/PrintLayout";
import { Spinner, cx } from "@/components/ui";
import NotFound from "@/pages/NotFound";
import { HeaderClassic, type DocBusiness } from "@/pages/pro/print/documents";
import { toDocBusiness, useBusiness } from "@/pages/pro/print/PrintQuote";

const CONDITIONS = [
  "Los artículos se entregan revisados y en buen estado. El cliente verifica la cantidad y el estado al recibirlos.",
  "El cliente es responsable de los artículos desde la entrega hasta la devolución; no puede trasladarlos a otro lugar ni subarrendarlos.",
  "Los artículos dañados, perdidos o no devueltos se cobrarán a su costo de reposición.",
  "El depósito de garantía se devuelve al recibir y revisar los artículos, descontando daños o faltantes si los hubiera.",
  "Las devoluciones tardías pueden generar cargos adicionales.",
];

/** Orden de alquiler (con precios) u hoja de entrega/devolución (lista de verificación con firmas). */
export default function PrintRental({ id, kind }: { id: string; kind: "orden" | "entrega" }) {
  const { ws, region } = useWorkspace();
  const biz = useBusiness(ws.id);
  const q = useQuery({
    queryKey: ["print-rental", id],
    queryFn: async () => {
      const r = unwrap<Rental & { customers: Pick<Customer, "name" | "phone" | "tax_id" | "address"> }>(
        await supabase.from("rentals").select("*, customers(name, phone, tax_id, address)").eq("id", id).single());
      const items = unwrap<RentalItem[]>(await supabase.from("rental_items").select("*").eq("rental_id", id).order("sort").order("id"));
      return { r, items };
    },
  });
  if (q.isLoading || biz.isLoading) return <Spinner />;
  if (!q.data || !biz.data) return <NotFound />;
  const { r, items } = q.data;
  const b = toDocBusiness(biz.data);
  const number = docNumber("RES", r.number);
  return (
    <PrintLayout title={`${kind === "orden" ? "Orden de alquiler" : "Hoja de entrega"} ${number}`} backTo={workspacePath(ws.kind, ws.id, `m/reservations/${id}`)} paper="letter">
      <Sheet paper="letter" className="px-10 py-9 print:p-0">
        {kind === "orden"
          ? <OrderDoc r={r} items={items} b={b} number={number} locale={region.locale} tz={region.timezone} />
          : <DeliveryDoc r={r} items={items} b={b} number={number} locale={region.locale} tz={region.timezone} />}
      </Sheet>
    </PrintLayout>
  );
}

type DocProps = { r: Rental & { customers: Pick<Customer, "name" | "phone" | "tax_id" | "address"> }; items: RentalItem[]; b: DocBusiness; number: string; locale: string; tz: string };

function Parties({ r, locale, tz, accent }: Omit<DocProps, "items" | "b" | "number"> & { accent: string }) {
  const c = r.customers;
  const dt = (iso: string) => formatDate(iso, { timeZone: tz, locale, withTime: true });
  const pickup = r.delivery_mode === "pickup";
  return (
    <div className="mt-6 grid grid-cols-2 gap-6 text-[12.5px] leading-relaxed">
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>Cliente</div>
        <div className="mt-1 text-[14px] font-semibold text-ink">{c.name}</div>
        <div className="text-ink-soft">{[c.tax_id && `Cédula / RUC: ${c.tax_id}`, c.phone, c.address].filter(Boolean).map((l) => <div key={l as string}>{l}</div>)}</div>
      </div>
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>{pickup ? "Retiro y devolución" : "Entrega y recolección"}</div>
        <table className="mt-1 w-full">
          <tbody className="align-top">
            <tr><td className="pr-3 text-ink-soft">{pickup ? "Retira" : "Entrega"}</td><td className="font-semibold text-ink">{dt(r.starts_at)}</td></tr>
            <tr><td className="pr-3 text-ink-soft">{pickup ? "Devuelve" : "Recolección"}</td><td className="font-semibold text-ink">{dt(r.ends_at)}</td></tr>
            {!pickup && r.delivery_address && <tr><td className="pr-3 text-ink-soft">Lugar</td><td>{r.delivery_address}</td></tr>}
            {(r.delivery_contact || r.delivery_phone) && <tr><td className="pr-3 text-ink-soft">Contacto</td><td>{[r.delivery_contact, r.delivery_phone].filter(Boolean).join(" · ")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Signatures({ left, right, accent, compact }: { left: { role: string; name?: string | null }; right: { role: string; name?: string | null }; accent: string; compact?: boolean }) {
  const Block = ({ role, name }: { role: string; name?: string | null }) => (
    <div className="text-center">
      <div className={compact ? "h-12" : "h-16"} />
      <div className="border-t-[1.5px] border-ink pt-2 text-[12.5px] font-semibold">{name || "Nombre: ____________________________"}</div>
      <div className="text-[11.5px] text-ink-soft">Cédula: ____________________ · Fecha: ____________</div>
      <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>{role}</div>
    </div>
  );
  return <div className={cx("no-break grid grid-cols-2 gap-10", compact ? "mt-2" : "mt-12")}><Block {...left} /><Block {...right} /></div>;
}

function OrderDoc({ r, items, b, number, locale, tz }: DocProps) {
  const accent = b.brand_color || "#1d1530";
  const m = (n: number) => formatMoney(Number(n), r.currency_code, locale);
  const disc = Math.min(Number(r.discount_amount), Number(r.subtotal));
  const advance = Math.round(Number(r.total) * Number(r.advance_pct)) / 100;
  return (
    <div>
      <HeaderClassic b={b} kind="Orden de alquiler" number={number} />
      <h1 className="mt-6 font-display text-[22px] font-semibold leading-tight">{r.title}</h1>
      <Parties r={r} locale={locale} tz={tz} accent={accent} />
      <table className="mt-7 w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-[0.15em] text-white" style={{ background: accent }}>
            <th className="px-3 py-2 text-right font-semibold">Cant.</th><th className="px-3 py-2 font-semibold">Artículo / servicio</th>
            <th className="px-3 py-2 text-right font-semibold">Precio</th><th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id} className={i % 2 ? "bg-paper/70" : ""}>
              <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
              <td className="px-3 py-2">{it.description}</td>
              <td className="px-3 py-2 text-right tabular-nums">{m(Number(it.unit_price))}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{m(Number(it.line_total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="no-break mt-4 flex justify-end">
        <dl className="w-72 space-y-1.5 text-[13px]">
          <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd className="tabular-nums">{m(Number(r.subtotal))}</dd></div>
          {disc > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Descuento</dt><dd className="tabular-nums">−{m(disc)}</dd></div>}
          {Number(r.tax_rate) > 0 && <div className="flex justify-between"><dt className="text-ink-soft">IVA ({Number(r.tax_rate)}%)</dt><dd className="tabular-nums">{m(Number(r.tax_amount))}</dd></div>}
          <div className="flex justify-between border-t-2 pt-2 text-[15px] font-semibold" style={{ borderColor: accent }}><dt>Total</dt><dd className="font-display text-[20px] tabular-nums">{m(Number(r.total))}</dd></div>
          {Number(r.advance_pct) > 0 && <div className="flex justify-between" style={{ color: accent }}><dt>Anticipo ({Number(r.advance_pct)}%)</dt><dd className="font-semibold tabular-nums">{m(advance)}</dd></div>}
          {Number(r.deposit_amount) > 0 && <div className="flex justify-between rounded-md bg-paper px-2 py-1"><dt>Depósito de garantía</dt><dd className="font-semibold tabular-nums">{m(Number(r.deposit_amount))}</dd></div>}
        </dl>
      </div>
      {r.notes && <p className="mt-6 whitespace-pre-line rounded-lg border border-line px-4 py-3 text-[12.5px]"><b>Notas:</b> {r.notes}</p>}
      <section className="no-break mt-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: accent }}>Condiciones del alquiler</h2>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[11.5px] leading-relaxed text-ink-soft">{CONDITIONS.map((c) => <li key={c}>{c}</li>)}</ol>
      </section>
      <Signatures left={{ role: b.name, name: b.signer_name }} right={{ role: "El cliente", name: r.customers.name }} accent={accent} />
    </div>
  );
}

function DeliveryDoc({ r, items, b, number, locale, tz }: DocProps) {
  const accent = b.brand_color || "#1d1530";
  const goods = items.filter((i) => i.resource_id);
  const services = items.filter((i) => !i.resource_id);
  const units = goods.reduce((s, i) => s + i.quantity, 0);
  const box = <span className="inline-block size-4 rounded-sm border-[1.5px] border-ink/60 align-middle" />;
  return (
    <div>
      <HeaderClassic b={b} kind="Hoja de entrega" number={number} />
      <h1 className="mt-6 font-display text-[22px] font-semibold leading-tight">{r.title}</h1>
      <Parties r={r} locale={locale} tz={tz} accent={accent} />
      <table className="mt-7 w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-[0.12em] text-white" style={{ background: accent }}>
            <th className="px-3 py-2 text-right font-semibold">Cant.</th><th className="px-3 py-2 font-semibold">Artículo</th>
            <th className="w-20 px-2 py-2 text-center font-semibold">Salida</th><th className="w-20 px-2 py-2 text-center font-semibold">Regreso</th>
            <th className="w-40 px-3 py-2 font-semibold">Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {goods.map((it) => (
            <tr key={it.id} className="border-b border-line">
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{it.quantity}</td>
              <td className="px-3 py-2.5">{it.description}</td>
              <td className="px-2 py-2.5 text-center">{box}</td>
              <td className="px-2 py-2.5 text-center">{r.status === "returned" ? <span className="text-[11px]">{it.returned_ok ?? 0} bien{it.damaged_qty ? ` · ${it.damaged_qty} dañ.` : ""}{it.lost_qty ? ` · ${it.lost_qty} falt.` : ""}</span> : box}</td>
              <td className="px-3 py-2.5 text-[11px] text-ink-soft">{it.check_notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td className="px-3 py-2 text-right font-semibold tabular-nums">{units}</td><td className="px-3 py-2 font-semibold" colSpan={4}>unidades en total</td></tr></tfoot>
      </table>
      {services.length > 0 && <p className="mt-3 text-[12px] text-ink-soft"><b>Servicios incluidos:</b> {services.map((s) => s.description).join(" · ")}</p>}
      {Number(r.deposit_amount) > 0 && <p className="mt-3 text-[12.5px]">Depósito de garantía: <b>{formatMoney(Number(r.deposit_amount), r.currency_code, locale)}</b> · Recibido: {formatMoney(Number(r.deposit_received), r.currency_code, locale)}</p>}
      {r.notes && <p className="mt-3 whitespace-pre-line text-[12.5px]"><b>Notas:</b> {r.notes}</p>}
      <section className="no-break mt-5">
        <p className="rounded-lg border border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-soft">
          Con su firma, el cliente declara haber recibido los artículos arriba detallados, completos y en buen estado, y se compromete a devolverlos en las mismas condiciones en la fecha indicada. Los daños o faltantes se cobrarán a su costo de reposición.
        </p>
        <div className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-muted">Entrega</div>
        <Signatures compact left={{ role: `Entregado por ${b.name}` }} right={{ role: "Recibido conforme (cliente)", name: r.out_received_by }} accent={accent} />
      </section>
      <section className="no-break mt-6 border-t border-dashed border-line-strong pt-3">
        <div className="text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-muted">Devolución</div>
        <Signatures compact left={{ role: "Devuelto por (cliente)" }} right={{ role: `Revisado por ${b.name}` }} accent={accent} />
      </section>
    </div>
  );
}
