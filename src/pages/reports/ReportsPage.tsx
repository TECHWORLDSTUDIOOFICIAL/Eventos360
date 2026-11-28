import { useWorkspace } from "@/layouts/WorkspaceShell";
import BusinessReport from "./BusinessReport";
import EventReportPage from "./EventReport";

/** Reportes: en Personal, el reporte de tu evento; en Profesional y Business, el del negocio. */
export default function ReportsPage() {
  const { ws } = useWorkspace();
  return ws.kind === "personal" ? <EventReportPage /> : <BusinessReport />;
}
