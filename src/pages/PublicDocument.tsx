import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, PenLine, Printer, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl } from "@/lib/events";
import { docNumber, type ContractStyle, type QuoteTemplate } from "@/lib/pro";
import { formatDate } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { SignaturePad } from "@/components/SignaturePad";
import { Alert, Button, Field, Input, Spinner } from "@/components/ui";
import { ContractDocument, QuoteDocument } from "@/pages/pro/print/documents";
import { toDocBusiness } from "@/pages/pro/print/PrintQuote";

interface Business {
  name: string; tax_id: string | null; phone: string | null; email: string | null; address: string | null; logo_path: string | null;
  locale: string; timezone: string; brand_color: string | null; signature_path: string | null; signer_name: string | null; signer_title: string | null;
}

/** Cotización o contrato compartido por enlace con el cliente (sin cuenta). */
export default function PublicDocument({ kind }: { kind: "quote" | "contract" }) {
  const { token } = useParams();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["public-doc", kind, token],
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc(kind === "quote" ? "public_quote" : "public_contract", { p_token: token });
      if (error) throw new Error(error.message);
      return d as Record<string, unknown> | null;
    },
  });
  if (isLoading) return <div className="grid min-h-dvh place-items-center bg-paper"><Spinner /></div>;
  if (!data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4 text-center">
        <div><h1 className="font-display text-3xl font-semibold">Documento no disponible</h1><p className="mt-2 text-muted">El enlace no es válido o el documento ya no está disponible.</p></div>
      </div>
    );
  }
  const biz = data.business as Business;
  const b = toDocBusiness(biz);
  return (
    <div className="min-h-dvh bg-[#efe9df] px-3 py-6 sm:py-10 print:bg-white print:p-0">
      <style>{`@page { size: letter portrait; margin: 0.5in; }`}</style>
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex justify-end print:hidden"><Button variant="secondary" size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button></div>
        <article className="overflow-hidden rounded-2xl bg-white px-5 py-9 shadow-[var(--shadow-card)] sm:px-10 print:rounded-none print:p-0 print:shadow-none">
          {kind === "quote" ? <QuoteView data={data} biz={biz} b={b} token={token!} onDone={() => void refetch()} />
            : <ContractView data={data} biz={biz} b={b} token={token!} onDone={() => void refetch()} />}
        </article>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted print:hidden">Documento generado con <Logo className="scale-75" /></p>
      </div>
    </div>
  );
}

type Q = { number: number; title: string; issue_date: string; valid_until: string | null; currency_code: string; subtotal: number; discount_amount: number;
  tax_rate: number; tax_amount: number; total: number; deposit_pct: number; terms: string | null; intro: string | null; template: QuoteTemplate;
  status: string; expired: boolean; accepted_name: string | null; accepted_at: string | null };
type Item = { description: string; details: string | null; image_path: string | null; quantity: number; unit_price: number; discount_pct: number; line_total: number };

function QuoteView({ data, biz, b, token, onDone }: { data: Record<string, unknown>; biz: Business; b: ReturnType<typeof toDocBusiness>; token: string; onDone: () => void }) {
  const q = data.quote as Q;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function respond(accept: boolean, e?: FormEvent) {
    e?.preventDefault();
    if (!accept && !confirm("¿Confirmas que no aceptas esta cotización?")) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("public_respond_quote", { p_token: token, p_accept: accept, p_name: name || null });
    setBusy(false);
    if (err) return setError(err.message);
    onDone();
  }
  const footer = (
    <div className="mt-8 border-t border-line pt-6 print:hidden">
      {q.status === "accepted" ? (
        <Alert tone="ok" title="Cotización aceptada">Aceptada por {q.accepted_name} el {formatDate(q.accepted_at, { timeZone: biz.timezone, withTime: true })}. ¡Gracias!</Alert>
      ) : q.status === "rejected" ? (
        <Alert tone="info" title="Cotización no aceptada">Registramos tu respuesta. Si cambias de opinión, contacta a {b.name}.</Alert>
      ) : q.expired ? (
        <Alert tone="warn">Esta cotización venció. Solicita una actualización a {b.name}.</Alert>
      ) : (
        <form onSubmit={(e) => void respond(true, e)} className="space-y-3">
          <h2 className="font-semibold">¿Aceptas esta cotización?</h2>
          <Field label="Tu nombre completo">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy} icon={<CheckCircle2 className="size-4" />} disabled={name.trim().length < 3}>Acepto la cotización</Button>
            <Button type="button" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => void respond(false)}>No la acepto</Button>
          </div>
        </form>
      )}
    </div>
  );
  return (
    <QuoteDocument business={b} locale={biz.locale} timezone={biz.timezone} footer={footer}
      data={{
        number: docNumber("COT", q.number), quote: q, customer: data.customer as { name: string },
        event: data.event as { name: string; starts_at: string | null; venue_name: string | null } | null,
        items: (data.items as Item[]).map((it) => ({ ...it, image_url: publicMediaUrl(it.image_path) })),
      }} />
  );
}

type K = { number: number; title: string; body: string; status: string; amount: number | null; currency_code: string; template: ContractStyle;
  include_provider_signature: boolean; accepted_at: string | null; accepted_name: string | null; accepted_id_doc: string | null;
  accepted_signature: string | null; accepted_hash: string | null; created_at: string };

function ContractView({ data, biz, b, token, onDone }: { data: Record<string, unknown>; biz: Business; b: ReturnType<typeof toDocBusiness>; token: string; onDone: () => void }) {
  const k = data.contract as K;
  const customer = data.customer as { name: string; tax_id: string | null };
  const [name, setName] = useState(customer.name);
  const [idDoc, setIdDoc] = useState(customer.tax_id ?? "");
  const [signature, setSignature] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function sign(e: FormEvent) {
    e.preventDefault();
    if (!signature) return setError("Dibuja tu firma en el recuadro.");
    setBusy(true);
    const { error: err } = await supabase.rpc("public_accept_contract", { p_token: token, p_name: name, p_id_doc: idDoc || null, p_signature: signature });
    setBusy(false);
    if (err) return setError(err.message);
    onDone();
  }
  return (
    <>
      <ContractDocument business={b} locale={biz.locale} timezone={biz.timezone} data={{ number: docNumber("CON", k.number), contract: k, customer }} />
      {k.status !== "accepted" && (
        <form onSubmit={sign} className="mt-10 space-y-4 rounded-2xl border border-line bg-paper/60 p-5 print:hidden">
          <h2 className="flex items-center gap-2 font-semibold"><PenLine className="size-5" />Firma del cliente</h2>
          <p className="text-sm text-muted">Si prefieres firmar en papel, imprime el documento con el botón de arriba. Para firmar desde aquí, completa tus datos y firma en el recuadro.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre completo">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
            <Field label="Cédula / identificación" optional>{(id) => <Input id={id} value={idDoc} onChange={(e) => setIdDoc(e.target.value)} />}</Field>
          </div>
          <SignaturePad onChange={setSignature} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
            He leído el contrato completo y acepto sus términos. Mi firma quedará registrada junto con la fecha, la hora y los datos de mi dispositivo.</label>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" loading={busy} disabled={!agree || name.trim().length < 5 || !signature} icon={<PenLine className="size-4" />}>Firmar contrato</Button>
        </form>
      )}
      {k.status === "accepted" && <div className="mt-6 print:hidden"><Alert tone="ok" title="Contrato firmado">Gracias, {k.accepted_name}. Puedes imprimirlo o guardarlo como PDF con el botón de arriba.</Alert></div>}
    </>
  );
}
