// Formatos regionales. Por defecto Nicaragua (es-NI, America/Managua); cada workspace puede cambiarlo.
export const DEFAULT_LOCALE = "es-NI";
export const DEFAULT_TIMEZONE = "America/Managua";

export function formatMoney(amount: number | string | null | undefined, currency = "NIO", locale = DEFAULT_LOCALE): string {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatDate(
  value: string | Date | null | undefined,
  opts: { locale?: string; timeZone?: string; withTime?: boolean } = {},
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(opts.locale ?? DEFAULT_LOCALE, {
    timeZone: opts.timeZone ?? DEFAULT_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(opts.withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

/** Días enteros desde ahora hasta la fecha (negativo si ya pasó). */
export function daysUntil(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}
