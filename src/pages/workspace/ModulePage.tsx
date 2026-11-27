import { Suspense } from "react";
import { useParams } from "react-router";
import { modulePage } from "./moduleRegistry";
import { Construction } from "lucide-react";
import { moduleMeta } from "@/lib/modules";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Card, EmptyState, PageHeader, Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";

/** Página de un módulo. Si el módulo no está habilitado para este espacio, no existe (404). */
export default function ModulePage() {
  const { moduleKey } = useParams();
  const { ws, modules } = useWorkspace();
  const mod = modules.find((m) => m.module_key === moduleKey);
  if (!mod) return <NotFound />;
  const Page = modulePage(ws.kind, mod.module_key);
  if (Page) return <Suspense fallback={<Spinner />}><Page /></Suspense>;
  const info = moduleMeta(mod.module_key, ws.kind);
  const Icon = info.icon;

  return (
    <div className="animate-rise">
      <PageHeader title={mod.label} description={info.description} />
      <Card>
        <EmptyState icon={info.stage === null ? <Icon className="size-6" /> : <Construction className="size-6" />} title="Próximamente">
          Esta herramienta ya forma parte de tu plan y aparecerá en tu menú en cuanto esté lista. No tienes que hacer nada.
        </EmptyState>
      </Card>
    </div>
  );
}
