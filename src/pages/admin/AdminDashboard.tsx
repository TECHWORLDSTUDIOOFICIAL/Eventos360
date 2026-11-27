import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, Building2, KeyRound, TrendingUp, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap, useSpecialties } from "@/lib/queries";
import { formatMoney } from "@/lib/format";
import { MODALITIES, STATUS_LABEL } from "@/lib/modalities";
import type { SubscriptionStatus, WorkspaceKind } from "@/lib/types";
import { Alert, Button, Card, CardHeader, PageHeader, Spinner, Stat } from "@/components/ui";

interface Metrics {
  users_total: number;
  users_active_30d: number;
  workspaces_total: number;
  by_kind: Partial<Record<WorkspaceKind, number>>;
  by_status: Partial<Record<SubscriptionStatus, number>>;
  by_specialty: Record<string, number>;
  mrr_by_currency: Record<string, number>;
  payments_30d_by_currency: Record<string, number>;
  expiring_7d: number;
  new_workspaces_30d: number;
  canceled_30d: number;
}

const moneyList = (m: Record<string, number>) => {
  const entries = Object.entries(m);
  return entries.length ? entries.map(([c, v]) => formatMoney(v, c)).join(" · ") : formatMoney(0, "USD");
};

function Bars({ data, labels }: { data: Record<string, number>; labels: (k: string) => string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="px-5 py-6 text-sm text-muted">Sin datos todavía.</p>;
  return (
    <ul className="space-y-3 px-5 py-4">
      {entries.map(([k, v]) => (
        <li key={k}>
          <div className="mb-1 flex justify-between text-sm"><span>{labels(k)}</span><span className="font-semibold tabular-nums">{v}</span></div>
          <div className="h-2 rounded-full bg-ink/6"><div className="h-2 rounded-full bg-brand" style={{ width: `${(v / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function AdminDashboard() {
  const { data: specialties } = useSpecialties();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: async () => unwrap<Metrics>(await supabase.rpc("admin_metrics")),
  });
  const specName = (k: string) => specialties?.find((s) => s.key === k)?.name ?? k;

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Resumen de la plataforma" description="Indicadores calculados con los datos reales registrados."
        actions={<Link to="/admin/codigos"><Button icon={<KeyRound className="size-4" />}>Generar código</Button></Link>} />
      {error && <Alert tone="danger">{(error as Error).message}</Alert>}
      {isLoading || !data ? <Spinner /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Clientes registrados" value={data.users_total} hint={`${data.users_active_30d} activos en 30 días`} icon={<Users className="size-4" />} />
            <Stat label="Espacios de trabajo" value={data.workspaces_total} hint={`${data.new_workspaces_30d} nuevos en 30 días`} icon={<Building2 className="size-4" />} />
            <Stat label="Suscripciones activas" value={(data.by_status.active ?? 0) + (data.by_status.trialing ?? 0)} hint={`${data.canceled_30d} cancelaciones en 30 días`} icon={<TrendingUp className="size-4" />} />
            <Stat label="Vencen en 7 días" value={data.expiring_7d} hint="Contactar para renovar" icon={<AlarmClock className="size-4" />} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Stat label="Ingreso recurrente mensual (estimado)" value={<span className="text-2xl">{moneyList(data.mrr_by_currency)}</span>}
              hint="Precio de cada plan activo normalizado a 30 días" />
            <Stat label="Pagos registrados (30 días)" value={<span className="text-2xl">{moneyList(data.payments_30d_by_currency)}</span>}
              hint={`Proyección a un año: ${Object.entries(data.mrr_by_currency).map(([c, v]) => formatMoney(v * 12, c)).join(" · ") || formatMoney(0, "USD")}`} />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Card><CardHeader title="Por modalidad" /><Bars data={data.by_kind as Record<string, number>} labels={(k) => MODALITIES[k as WorkspaceKind]?.short ?? k} /></Card>
            <Card><CardHeader title="Por estado" /><Bars data={data.by_status as Record<string, number>} labels={(k) => STATUS_LABEL[k as SubscriptionStatus] ?? k} /></Card>
            <Card><CardHeader title="Business por especialidad" /><Bars data={data.by_specialty} labels={specName} /></Card>
          </div>
        </>
      )}
    </div>
  );
}
