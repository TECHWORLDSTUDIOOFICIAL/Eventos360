import { lazy, Suspense } from "react";
import { useParams, useSearchParams } from "react-router";
import { useEvents } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate } from "@/components/EventGate";
import { Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";

const EVENT_DOCS = {
  invitaciones: { module: "invitations", Page: lazy(() => import("./PrintInvitations")) },
  cronograma: { module: "schedule", Page: lazy(() => import("./PrintSchedule")) },
  mesas: { module: "seating", Page: lazy(() => import("./PrintSeating")) },
} as const;

const PrintQuote = lazy(() => import("@/pages/pro/print/PrintQuote"));
const PrintContract = lazy(() => import("@/pages/pro/print/PrintContract"));

/**
 * Documentos imprimibles. Los del evento usan ?evento=<id> (o el evento activo en Personal);
 * cotización y contrato usan ?id=<id>. Solo si el espacio tiene el módulo correspondiente.
 */
export default function PrintPage() {
  const { doc } = useParams();
  const [params] = useSearchParams();
  const { ws, modules } = useWorkspace();
  const has = (m: string) => modules.some((x) => x.module_key === m);
  const id = params.get("id");

  if (doc === "cotizacion" && id && has("quotes")) return <Suspense fallback={<Spinner />}><PrintQuote id={id} /></Suspense>;
  if (doc === "contrato" && id && has("contracts")) return <Suspense fallback={<Spinner />}><PrintContract id={id} /></Suspense>;

  const d = EVENT_DOCS[doc as keyof typeof EVENT_DOCS];
  if (!d || !has(d.module)) return <NotFound />;
  const eventId = params.get("evento");
  if (eventId) return <EventById id={eventId} render={(event) => <Suspense fallback={<Spinner />}><d.Page event={event} /></Suspense>} />;
  if (ws.kind !== "personal") return <NotFound />;
  return <EventGate>{({ event }) => <Suspense fallback={<Spinner />}><d.Page event={event} /></Suspense>}</EventGate>;
}

function EventById({ id, render }: { id: string; render: (e: NonNullable<ReturnType<typeof useEvents>["data"]>[number]) => React.ReactNode }) {
  const { ws } = useWorkspace();
  const { data, isLoading } = useEvents(ws.id);
  if (isLoading) return <Spinner />;
  const event = data?.find((e) => e.id === id);
  return event ? <>{render(event)}</> : <NotFound />;
}
