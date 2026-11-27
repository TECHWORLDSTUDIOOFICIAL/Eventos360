import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { docNumber, type Contract } from "@/lib/pro";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { PrintLayout, Sheet } from "@/components/PrintLayout";
import { Alert, Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";
import { ContractDocument } from "./documents";
import { toDocBusiness, useBusiness } from "./PrintQuote";

/** Contrato imprimible con el apartado de firmas del prestador y del cliente. */
export default function PrintContract({ id }: { id: string }) {
  const { ws, region } = useWorkspace();
  const biz = useBusiness(ws.id);
  const k = useQuery({
    queryKey: ["print-contract", id],
    queryFn: async () => unwrap<Contract & { customers: { name: string; tax_id: string | null } }>(await supabase.from("contracts").select("*, customers(name, tax_id)").eq("id", id).single()),
  });
  if (k.isLoading || biz.isLoading) return <Spinner />;
  if (!k.data || !biz.data) return <NotFound />;
  const c = k.data;
  return (
    <PrintLayout title={`Contrato ${docNumber("CON", c.number)}`} backTo={workspacePath(ws.kind, ws.id, `m/contracts/${id}`)} paper="letter">
      {c.status !== "accepted" && (
        <div className="mx-auto mb-4 max-w-2xl print:hidden">
          <Alert tone="info">Este documento lleva el apartado de firmas para imprimir y firmar a mano.{!biz.data.signature_path && " Puedes agregar tu firma digital en Configuración para que aparezca automáticamente."}</Alert>
        </div>
      )}
      <Sheet paper="letter" className="px-10 py-9 print:p-0">
        <ContractDocument business={toDocBusiness(biz.data)} locale={region.locale} timezone={region.timezone}
          data={{ number: docNumber("CON", c.number), contract: c, customer: c.customers }} />
      </Sheet>
    </PrintLayout>
  );
}
