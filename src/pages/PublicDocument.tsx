import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Printer, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl } from "@/lib/events";
import { docNumber } from "@/lib/pro";
import { formatDate, formatMoney } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { Alert, Button, Field, Input, Spinner } from "@/components/ui";
import { DocHeader, QuoteBody } from "@/pages/pro/print/docParts";

interface Business { name: string; tax_id: string | null; phone: string | null; email: string | null; address: string | null; logo_path: string | null; locale: string; timezone: string }

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
  return (
    <div className="min-h-dvh bg-[#efe9df] px-3 py-6 sm:py-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex justify-end print:hidden"><Button variant="secondary" size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button></div>
        <article className="rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] sm:p-10 print:rounded-none print:p-0 print:shadow-none">
          <DocHeader business={{ ...biz, logo_url: publicMediaUrl(biz.logo_path) }}
            title={kind === "quote" ? "Cotización" : "Contrato"}
            number={docNumber(kind === "quote" ? "COT" : "CON", Number((data[kind] as { number: number }).number))} />
          {kind === "quote" ? <QuoteView data={data} biz={biz} token={token!} onDone={() => void refetch()} /> : <ContractView data={data} biz={biz} token={token!} onDone={() => void refetch()} />}
        </article>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted print:hidden">Documento generado con <Logo className="scale-75" /></p>
      </div>
    </div>
  );
}

function QuoteView({ data, biz, token, onDone }: { data: Record<string, unknown>; biz: Business; token: string; onDone: () => void }) {
  const q = data.quote as { status: string; expired: boolean; accepted_name: string | null; accepted_at: string | null };
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
  return (
    <>
      <QuoteBody data={data as never} locale={biz.locale} timezone={biz.timezone} />
      <div className="mt-8 border-t border-line pt-6 print:hidden">
        {q.status === "accepted" ? (
          <Alert tone="ok" title="Cotización aceptada">Aceptada por {q.accepted_name} el {formatDate(q.accepted_at, { timeZone: biz.timezone, withTime: true })}. ¡Gracias!</Alert>
        ) : q.status === "rejected" ? (
          <Alert tone="info" title="Cotización no aceptada">Registramos tu respuesta. Si cambias de opinión, contacta a {biz.name}.</Alert>
        ) : q.expired ? (
          <Alert tone="warn">Esta cotización venció. Solicita una actualización a {biz.name}.</Alert>
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
    </>
  );
}

function ContractView({ data, biz, token, onDone }: { data: Record<string, unknown>; biz: Business; token: string; onDone: () => void }) {
  const k = data.contract as { title: string; body: string; status: string; amount: number | null; currency_code: string; accepted_at: string | null; accepted_name: string | null; accepted_hash: string | null };
  const customer = data.customer as { name: string };
  const [name, setName] = useState("");
  const [idDoc, setIdDoc] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function accept(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await supabase.rpc("public_accept_contract", { p_token: token, p_name: name, p_id_doc: idDoc || null });
    setBusy(false);
    if (err) return setError(err.message);
    onDone();
  }
  return (
    <>
      <h1 className="mt-6 font-display text-2xl font-semibold">{k.title}</h1>
      <p className="text-sm text-muted">Cliente: {customer.name}{k.amount != null ? ` · Monto: ${formatMoney(Number(k.amount), k.currency_code, biz.locale)}` : ""}</p>
      <div className="mt-6 whitespace-pre-line text-[14.5px] leading-relaxed">{k.body}</div>
      <div className="mt-8 border-t border-line pt-6">
        {k.status === "accepted" ? (
          <div className="flex items-start gap-3 rounded-xl bg-ok-soft p-4 text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" />
            <div><div className="font-semibold">Aceptado electrónicamente por {k.accepted_name}</div>
              <div>{formatDate(k.accepted_at, { timeZone: biz.timezone, withTime: true })}</div>
              <div className="mt-1 break-all font-mono text-[11px] text-muted">Huella del documento (SHA-256): {k.accepted_hash}</div></div>
          </div>
        ) : (
          <form onSubmit={accept} className="space-y-3 print:hidden">
            <h2 className="font-semibold">Aceptación del contrato</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre completo">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
              <Field label="Cédula / identificación" optional>{(id) => <Input id={id} value={idDoc} onChange={(e) => setIdDoc(e.target.value)} />}</Field>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
              He leído el contrato completo y acepto sus términos. Entiendo que esta aceptación electrónica queda registrada con fecha, hora y datos de mi dispositivo.</label>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" loading={busy} disabled={!agree || name.trim().length < 5} icon={<ShieldCheck className="size-4" />}>Acepto el contrato</Button>
          </form>
        )}
      </div>
    </>
  );
}
