import { Link } from "react-router";
import { CalendarClock, CreditCard, Layers } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { MODALITIES, STATUS_LABEL, workspacePath } from "@/lib/modalities";
import { moduleMeta } from "@/lib/modules";
import { daysUntil, formatDate } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import PersonalHome from "@/pages/personal/PersonalHome";
import ProHome from "@/pages/pro/ProHome";
import BusinessHome from "@/pages/business/BusinessHome";
import { EVENT_SCOPED } from "./moduleRegistry";

const INTRO = {
  personal: "Este es el centro de tu celebración. Aquí verás la cuenta regresiva, tu presupuesto, tus invitados y lo que falta por hacer.",
  professional: "Tu panel de trabajo como organizador: clientes, eventos, cotizaciones y cobros en un solo lugar.",
  business: "El panel de tu empresa, configurado según tu especialidad.",
} as const;

/**
 * Inicio del espacio de trabajo. En esta etapa muestra SOLO datos reales (suscripción y módulos habilitados).
 * Los indicadores de negocio llegan con cada módulo; no se muestran cifras ficticias.
 */
export default function WorkspaceHome() {
  const { ws } = useWorkspace();
  if (ws.kind === "personal") return <PersonalHome />;
  if (ws.kind === "professional") return <ProHome />;
  return <BusinessOrGeneric />;
}

function BusinessOrGeneric() {
  const { modules } = useWorkspace();
  // Negocios con inventario (alquiler, decoración, sonido, vestidos…) tienen su panel operativo.
  if (modules.some((m) => m.module_key === "reservations" || m.module_key === "inventory")) return <BusinessHome />;
  return <GenericHome />;
}

function GenericHome() {
  const { ws, modules } = useWorkspace();
  const { profile } = useAuth();
  const meta = MODALITIES[ws.kind];
  const left = daysUntil(ws.period_end);
  const homeKey = ws.kind === "personal" ? "home" : "dashboard";
  const pending = modules.filter((m) => m.module_key !== homeKey && !(EVENT_SCOPED[ws.kind] ?? []).includes(m.module_key));
  const base = workspacePath(ws.kind, ws.id);

  return (
    <div className="animate-rise">
      <PageHeader eyebrow={meta.product} title={`Hola, ${profile?.full_name.split(" ")[0] ?? ""}`} description={INTRO[ws.kind]} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Plan" value={ws.plan_name ?? "—"} icon={<CreditCard className="size-4" />}
          hint={ws.subscription_status ? STATUS_LABEL[ws.subscription_status] : undefined} />
        <Stat label="Días restantes" value={left === null ? "—" : Math.max(left, 0)} icon={<CalendarClock className="size-4" />}
          hint={`Vence el ${formatDate(ws.period_end)}`} />
        <Stat label="Módulos habilitados" value={modules.length} icon={<Layers className="size-4" />}
          hint={ws.primary_specialty ?? "Según tu modalidad"} />
      </div>

      <div className="mt-6">
        <Alert tone="info" title="Algunas herramientas de tu especialidad están en preparación">
          Las que ya funcionan están en tu menú. Las marcadas como "Próximamente" aparecerán solas cuando estén listas; no tienes que hacer nada.
        </Alert>
      </div>

      <Card className="mt-6">
        <CardHeader title="Tus herramientas" description="Estos son los módulos de tu espacio según tu modalidad, especialidad y plan." />
        <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {pending.map((m) => {
            const info = moduleMeta(m.module_key, ws.kind);
            const Icon = info.icon;
            return (
              <li key={m.module_key} className="bg-card">
                <Link to={`${base}/m/${m.module_key}`} className="flex h-full gap-3 p-4 transition hover:bg-paper">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><Icon className="size-[18px]" /></span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {m.label}
                      {info.stage !== null && <Badge tone="neutral" className="font-medium">Próximamente</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">{info.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
