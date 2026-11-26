import type { ReactNode } from "react";
import { Link } from "react-router";
import { PartyPopper } from "lucide-react";
import { useCurrentEvent, type EventRow } from "@/lib/events";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Button, Card, EmptyState, Select, Spinner } from "./ui";

/** Selector compacto del evento activo (solo aparece si hay más de uno). */
export function EventSwitcher({ events, current, onSelect }: { events: EventRow[]; current: EventRow; onSelect: (id: string) => void }) {
  if (events.length < 2) return null;
  return (
    <Select value={current.id} onChange={(e) => onSelect(e.target.value)} className="h-10 w-auto min-w-52" aria-label="Evento">
      {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
    </Select>
  );
}

/** Garantiza que exista un evento seleccionado antes de mostrar un módulo que depende de él. */
export function EventGate({ children }: { children: (ctx: { event: EventRow; events: EventRow[]; select: (id: string) => void }) => ReactNode }) {
  const { ws } = useWorkspace();
  const { events, event, isLoading, select } = useCurrentEvent(ws.id);
  if (isLoading) return <Spinner />;
  if (!event) {
    return (
      <Card>
        <EmptyState icon={<PartyPopper className="size-6" />} title="Primero crea tu evento"
          action={<Link to={workspacePath(ws.kind, ws.id, "m/my_event")}><Button variant="accent">Crear mi evento</Button></Link>}>
          Registra el nombre, la fecha y el lugar de tu celebración para empezar a organizar invitados, presupuesto y más.
        </EmptyState>
      </Card>
    );
  }
  return <>{children({ event, events, select })}</>;
}
