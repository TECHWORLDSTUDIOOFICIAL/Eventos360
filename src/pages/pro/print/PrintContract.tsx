import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { docNumber, type Contract } from "@/lib/pro";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { PrintLayout, Sheet } from "@/components/PrintLayout";
import { Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";
import { DocHeader } from "./docParts";
import { toDocBusiness, useBusiness } from "./PrintQuote";

/** Contrato imprimible con espacio de firmas y, si fue aceptado, la evidencia electrónica. */
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
  const b = toDocBusiness(biz.data);
  return (
    <PrintLayout title={`Contrato ${docNumber("CON", c.number)}`} backTo={workspacePath(ws.kind, ws.id, `m/contracts/${id}`)} paper="letter">
      <Sheet paper="letter" className="px-10 py-9 print:p-0">
        <DocHeader business={b} title="Contrato" number={docNumber("CON", c.number)} />
        <h1 className="mt-6 font-display text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-muted">Cliente: {c.customers.name}{c.amount != null ? ` · Monto: ${formatMoney(Number(c.amount), c.currency_code, region.locale)}` : ""}</p>
        <div className="mt-6 whitespace-pre-line text-[13.5px] leading-relaxed">{c.body}</div>
        {c.status === "accepted" ? (
          <div className="no-break mt-10 rounded-lg border border-line p-4 text-[12px]">
            <div className="font-semibold">Aceptación electrónica</div>
            <div>Aceptado por {c.accepted_name}{c.accepted_id_doc ? `, identificación ${c.accepted_id_doc}` : ""}, el {formatDate(c.accepted_at, { timeZone: region.timezone, locale: region.locale, withTime: true })}{c.accepted_ip ? ` desde la IP ${c.accepted_ip}` : ""}.</div>
            <div className="mt-1 break-all font-mono text-[10px] text-muted">Huella SHA-256 del texto aceptado: {c.accepted_hash}</div>
          </div>
        ) : (
          <div className="no-break mt-16 grid grid-cols-2 gap-12 text-center text-sm">
            <div><div className="border-t border-ink pt-2 font-semibold">{b.name}</div><div className="text-muted">EL ORGANIZADOR</div></div>
            <div><div className="border-t border-ink pt-2 font-semibold">{c.customers.name}</div><div className="text-muted">EL CLIENTE{c.customers.tax_id ? ` · ${c.customers.tax_id}` : ""}</div></div>
          </div>
        )}
      </Sheet>
    </PrintLayout>
  );
}
