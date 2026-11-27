import { marginTone, profit } from "@/lib/catalog";
import { cx } from "./ui";

/** Ganancia real (solo la ve el negocio): sin IVA y descontando costos. */
export function ProfitSummary({ net, cost, tax, money }: { net: number; cost: number; tax: number; money: (n: number) => string }) {
  const p = profit(net, cost);
  return (
    <div className="mt-4 rounded-xl border border-dashed border-line-strong bg-paper/60 p-3 text-sm">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Solo tú lo ves</div>
      <dl className="space-y-1">
        <div className="flex justify-between"><dt className="text-muted">Venta sin IVA</dt><dd className="tabular-nums">{money(net)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Costos</dt><dd className="tabular-nums">−{money(cost)}</dd></div>
        <div className={cx("flex justify-between font-semibold", marginTone(p.margin))}><dt>Ganancia</dt><dd className="tabular-nums">{money(p.gain)} · {Math.round(p.margin)}%</dd></div>
      </dl>
      {tax > 0 && <p className="mt-1.5 text-[11px] text-muted">El IVA ({money(tax)}) se cobra al cliente pero se paga a la DGI: no es ganancia.</p>}
      {cost === 0 && net > 0 && <p className="mt-1.5 text-[11px] text-warn">Agrega el costo de cada línea para ver tu ganancia real.</p>}
    </div>
  );
}

