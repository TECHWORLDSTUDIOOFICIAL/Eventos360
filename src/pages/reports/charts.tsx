import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Barras horizontales de una sola serie (ranking). Una serie → sin leyenda; el título la nombra.
 * Valor y etiqueta en tinta de texto; la barra en el color de acento.
 */
export function RankBars({ rows, format, empty, max: fixedMax }: { rows: { label: ReactNode; value: number; note?: ReactNode; key: string }[]; format: (n: number) => string; empty: string; max?: number }) {
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <p className="px-5 py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3 px-5 py-4">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}{r.note && <span className="ml-1.5 text-xs text-muted">{r.note}</span>}</span>
            <span className="shrink-0 font-semibold tabular-nums">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-line/70"><div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: r.value ? `${Math.min(100, Math.max(1.5, (Math.abs(r.value) / max) * 100))}%` : 0 }} /></div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Columnas por mes (una serie: lo que se pide en `value`). Al pasar el cursor o tocar,
 * muestra el detalle del mes. Los meses en negativo se marcan con tono de alerta y signo.
 */
export function MonthColumns({ months, value, detail, format, label }: {
  months: { key: string; label: string }[]; value: (i: number) => number; detail: (i: number) => ReactNode; format: (n: number) => string; label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = months.map((_, i) => value(i));
  const max = Math.max(1, ...vals.map(Math.abs));
  const hasNeg = vals.some((v) => v < 0);
  const H = 160;
  return (
    <div className="px-5 pb-4 pt-6">
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div className={cx("grid gap-1.5", hasNeg ? "items-center" : "items-end")} style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, height: hasNeg ? H * 2 : H }} role="img" aria-label={label}>
          {months.map((m, i) => {
            const v = vals[i]!;
            const h = Math.max(v === 0 ? 0 : 3, (Math.abs(v) / max) * H);
            return (
              <button key={m.key} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
                className="relative flex h-full flex-col justify-end outline-none" aria-label={`${m.label}: ${format(v)}`}>
                {hasNeg ? (
                  <span className="flex h-full flex-col">
                    <span className="flex flex-1 items-end justify-center">{v > 0 && <span className={cx("w-full max-w-10 rounded-t", hover === i ? "bg-[var(--accent)]" : "bg-[var(--accent)]/80")} style={{ height: h }} />}</span>
                    <span className="h-px bg-line-strong" />
                    <span className="flex flex-1 items-start justify-center">{v < 0 && <span className="w-full max-w-10 rounded-b bg-danger/80" style={{ height: h }} />}</span>
                  </span>
                ) : (
                  <span className="mx-auto w-full max-w-10 rounded-t" style={{ height: h, background: "var(--accent)", opacity: hover === null || hover === i ? 1 : 0.55 }} />
                )}
              </button>
            );
          })}
        </div>
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 w-52 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-card p-3 text-xs shadow-[var(--shadow-pop)]"
            style={{ left: `${Math.min(88, Math.max(12, ((hover + 0.5) / months.length) * 100))}%` }}>
            <div className="mb-1 font-semibold capitalize">{months[hover]!.label}</div>{detail(hover)}
          </div>
        )}
      </div>
      <div className="mt-2 grid gap-1.5 text-center text-[11px] capitalize text-muted" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map((m) => <span key={m.key} className="truncate">{m.label}</span>)}
      </div>
    </div>
  );
}

/** Tarjeta de cifra con comparación opcional contra el período anterior. */
export function KPI({ label, value, hint, delta, goodWhenUp = true, tone }: { label: string; value: string; hint?: ReactNode; delta?: number | null; goodWhenUp?: boolean; tone?: "ok" | "danger" }) {
  const good = delta == null ? null : goodWhenUp ? delta >= 0 : delta <= 0;
  return (
    <div className="bg-card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-1 font-display text-xl font-semibold tabular-nums sm:text-2xl", tone === "ok" && "text-ok", tone === "danger" && "text-danger")}>{value}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        {delta != null && <span className={cx("font-semibold", good ? "text-ok" : "text-danger")}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {Math.abs(delta)}%</span>}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}
