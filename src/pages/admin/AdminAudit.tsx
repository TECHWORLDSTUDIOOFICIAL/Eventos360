import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { Card, EmptyState, PageHeader, Spinner } from "@/components/ui";

const LABELS: Record<string, string> = {
  "access_code.created": "Generó un código de acceso",
  "access_code.revoked": "Anuló un código de acceso",
  "payment.recorded": "Registró un pago",
  "workspace.created": "Nueva cuenta registrada",
  "workspace.disabled": "Desactivó una cuenta",
  "workspace.enabled": "Reactivó una cuenta",
  "subscription.renewed": "Renovación con código",
  "subscription.extended": "Extendió una suscripción",
  "subscription.plan_changed": "Cambió el plan",
  "subscription.status_changed": "Cambió el estado de una suscripción",
  "platform_admin.created": "Nuevo administrador de plataforma",
  "user.password_reset": "Restableció una contraseña",
  "user.disabled": "Bloqueó un usuario",
  "user.enabled": "Desbloqueó un usuario",
};

interface LogRow { id: number; action: string; entity: string; created_at: string; details: Record<string, unknown>; profiles: { username: string } | null; workspaces: { name: string } | null }

export default function AdminAudit() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: async () => unwrap<LogRow[]>(await supabase.from("audit_logs").select("id, action, entity, created_at, details, profiles(username), workspaces(name)").order("created_at", { ascending: false }).limit(200)),
  });
  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Actividad" description="Registro de operaciones sensibles (últimas 200)." />
      <Card>
        {isLoading ? <Spinner /> : !data?.length ? <EmptyState icon={<Activity className="size-6" />} title="Sin actividad registrada" /> : (
          <ul className="divide-y divide-line">
            {data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{LABELS[l.action] ?? l.action}</span>
                  {l.workspaces?.name && <span className="text-muted"> · {l.workspaces.name}</span>}
                  <div className="text-xs text-muted">{l.profiles?.username ? `@${l.profiles.username}` : "Sistema"}</div>
                </div>
                <span className="text-xs text-muted">{formatDate(l.created_at, { withTime: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
