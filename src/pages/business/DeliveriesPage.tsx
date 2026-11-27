import { PageHeader } from "@/components/ui";
import { Agenda } from "./agenda";

export default function DeliveriesPage() {
  return (
    <div className="animate-rise">
      <PageHeader title="Entregas" description="Lo que debe salir de bodega: reservaciones apartadas por fecha de entrega. Imprime la hoja para que el cliente firme lo recibido." />
      <Agenda kind="delivery" />
    </div>
  );
}
