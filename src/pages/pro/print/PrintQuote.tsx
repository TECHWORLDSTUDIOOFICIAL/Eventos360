import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { publicMediaUrl } from "@/lib/events";
import { docNumber, type Quote, type QuoteItem } from "@/lib/pro";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { PrintLayout, Sheet } from "@/components/PrintLayout";
import { Spinner } from "@/components/ui";
import NotFound from "@/pages/NotFound";
import { DocHeader, QuoteBody } from "./docParts";

export interface BizRow { name: string; legal_name: string | null; tax_id: string | null; contact_phone: string | null; contact_email: string | null; address: string | null; logo_path: string | null }

export const useBusiness = (wsId: string) =>
  useQuery({
    queryKey: ["ws-biz-full", wsId],
    queryFn: async () => unwrap<BizRow>(await supabase.from("workspaces").select("name, legal_name, tax_id, contact_phone, contact_email, address, logo_path").eq("id", wsId).single()),
  });

export const toDocBusiness = (b: BizRow) => ({
  name: b.legal_name || b.name, tax_id: b.tax_id, phone: b.contact_phone, email: b.contact_email, address: b.address, logo_url: publicMediaUrl(b.logo_path),
});

export default function PrintQuote({ id }: { id: string }) {
  const { ws, region } = useWorkspace();
  const biz = useBusiness(ws.id);
  const data = useQuery({
    queryKey: ["print-quote", id],
    queryFn: async () => {
      const q = unwrap<Quote & { customers: { name: string }; events: { name: string; starts_at: string | null; venue_name: string | null } | null }>(
        await supabase.from("quotes").select("*, customers(name), events(name, starts_at, venue_name)").eq("id", id).single());
      const items = unwrap<QuoteItem[]>(await supabase.from("quote_items").select("*").eq("quote_id", id).order("sort").order("id"));
      return { q, items };
    },
  });
  if (data.isLoading || biz.isLoading) return <Spinner />;
  if (!data.data || !biz.data) return <NotFound />;
  const { q, items } = data.data;
  return (
    <PrintLayout title={`Cotización ${docNumber("COT", q.number)}`} backTo={workspacePath(ws.kind, ws.id, `m/quotes/${id}`)} paper="letter">
      <Sheet paper="letter" className="px-10 py-9 print:p-0">
        <DocHeader business={toDocBusiness(biz.data)} title="Cotización" number={docNumber("COT", q.number)} />
        <QuoteBody locale={region.locale} timezone={region.timezone}
          data={{ quote: q, items, customer: q.customers, event: q.events }} />
      </Sheet>
    </PrintLayout>
  );
}
