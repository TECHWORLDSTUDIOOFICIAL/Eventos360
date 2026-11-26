import { lazy, Suspense } from "react";
import { useParams } from "react-router";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate } from "@/components/EventGate";
import { Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";

const DOCS = {
  invitaciones: { module: "invitations", Page: lazy(() => import("./PrintInvitations")) },
  cronograma: { module: "schedule", Page: lazy(() => import("./PrintSchedule")) },
  mesas: { module: "seating", Page: lazy(() => import("./PrintSeating")) },
} as const;

/** Documentos imprimibles del evento activo. Solo si el espacio tiene el módulo correspondiente. */
export default function PrintPage() {
  const { doc } = useParams();
  const { ws, modules } = useWorkspace();
  const d = DOCS[doc as keyof typeof DOCS];
  if (!d || ws.kind !== "personal" || !modules.some((m) => m.module_key === d.module)) return <NotFound />;
  const { Page } = d;
  return (
    <EventGate>
      {({ event }) => <Suspense fallback={<Spinner />}><Page event={event} /></Suspense>}
    </EventGate>
  );
}
