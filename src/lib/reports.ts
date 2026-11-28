import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export interface Totals { sales: number; tax: number; cost: number; overhead: number; result: number; collected: number; staff: number; deals: number }
export interface BusinessReport {
  period: { from: string; to: string; days: number; currency: string };
  advanced: boolean;
  totals: Totals;
  previous: (Totals & { from: string; to: string }) | null;
  monthly: (Totals & { month: string })[] | null;
  quotes: { total: number; draft: number; sent: number; accepted: number; rejected: number; expired: number; accepted_net: number; quoted_net: number; avg_days_to_accept: number | null };
  by_category: { category: string | null; count: number; net: number }[];
  top_customers: { id: string; name: string | null; count: number; net: number }[];
  top_items: { label: string; kind: string; qty: number; revenue: number; cost: number }[];
  payments_by_method: { method: string | null; count: number; amount: number }[];
  new_customers: { source: string | null; count: number }[];
  expenses_by_category: { category: string; amount: number }[];
  suppliers: { id: string; name: string; service: string | null; amount: number }[];
  staff: { id: string; name: string; shifts: number; absent: number; hours: number; pay: number; unpaid: number }[] | null;
  receivables: { total: number; buckets: { upcoming: number; d30: number; d60: number; d90: number; d90plus: number }; customers: { id: string; name: string | null; phone: string | null; balance: number; oldest: string | null }[] };
  rental?: { damages: number; resources: { id: string; name: string; total_qty: number; units: number; revenue: number; utilization: number }[] };
  venues?: { spaces: { id: string; name: string; events: number; days: number; net: number }[]; sources: { source: string | null; total: number; won: number }[] };
}

export const useBusinessReport = (wsId: string, from: string, to: string, currency: string) =>
  useQuery({
    queryKey: ["report-business", wsId, from, to, currency],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => unwrap<BusinessReport>(await supabase.rpc("report_business", { p_ws: wsId, p_from: from, p_to: to, p_cur: currency })),
    staleTime: 60_000,
  });

export type PeriodKey = "mes" | "anterior" | "trimestre" | "anio" | "anio_anterior" | "custom";
export const PERIODS: Record<Exclude<PeriodKey, "custom">, string> = {
  mes: "Este mes", anterior: "Mes pasado", trimestre: "Últimos 3 meses", anio: "Este año", anio_anterior: "Año pasado",
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function periodRange(key: Exclude<PeriodKey, "custom">, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth();
  switch (key) {
    case "mes": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "anterior": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "trimestre": return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "anio": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "anio_anterior": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

/** Cambio porcentual con signo, o null si no hay base. */
export const change = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);
