import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl, uploadImage } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { useBusiness } from "@/pages/pro/print/PrintQuote";
import { Alert, Button, Card, CardHeader, Field, Input, Spinner } from "@/components/ui";
import { SignaturePad } from "@/components/SignaturePad";

/** Datos del negocio que aparecen en cotizaciones y contratos. */
export default function BusinessProfileCard() {
  const { ws, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const { data, isLoading } = useBusiness(ws.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ legal_name: "", tax_id: "", contact_phone: "", contact_email: "", address: "", brand_color: "#4a2c7a", signer_name: "", signer_title: "" });
  const [signature, setSignature] = useState<string | null>(null);       // firma dibujada (PNG)
  const [signatureFile, setSignatureFile] = useState<File | null>(null); // o imagen subida
  const [drawing, setDrawing] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Se inicializa una sola vez: una recarga de datos no debe borrar lo que el usuario está escribiendo.
  const loaded = useRef(false);
  useEffect(() => {
    if (data && !loaded.current) loaded.current = true;
    else return;
    setF({ legal_name: data.legal_name ?? "", tax_id: data.tax_id ?? "", contact_phone: data.contact_phone ?? "", contact_email: data.contact_email ?? "",
      address: data.address ?? "", brand_color: data.brand_color ?? "#4a2c7a", signer_name: data.signer_name ?? "", signer_title: data.signer_title ?? "" });
  }, [data]);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const preview = logo ? URL.createObjectURL(logo) : publicMediaUrl(data?.logo_path);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const row: Record<string, string | null> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
      if (signature || signatureFile) {
        const path = `${ws.id}/marca/firma-${crypto.randomUUID()}.png`;
        const blob = signatureFile ?? await (await fetch(signature!)).blob();
        const { error: upErr } = await supabase.storage.from("event-media").upload(path, blob, { contentType: signatureFile?.type || "image/png" });
        if (upErr) throw new Error("No se pudo guardar la firma.");
        row.signature_path = path;
        if (data?.signature_path) await supabase.storage.from("event-media").remove([data.signature_path]);
      }
      if (logo) {
        row.logo_path = await uploadImage("event-media", `${ws.id}/marca/logo-${Date.now()}.webp`, logo, 600);
        if (data?.logo_path) await supabase.storage.from("event-media").remove([data.logo_path]);
      }
      const { error } = await supabase.from("workspaces").update(row).eq("id", ws.id);
      if (error) throw new Error(error.message);
      setLogo(null); setSignature(null); setSignatureFile(null); setDrawing(false);
      await qc.invalidateQueries({ queryKey: ["ws-biz-full", ws.id] });
      setMsg({ tone: "ok", text: "Datos del negocio guardados." });
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader title="Datos del negocio y documentos" description="Logo, datos, color y firma que aparecen en tus cotizaciones y contratos." />
      {isLoading ? <Spinner /> : <form onSubmit={save} className="space-y-4 px-5 py-5">
        <fieldset disabled={readOnly} className="space-y-4">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => fileRef.current?.click()} className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-line-strong bg-paper text-muted hover:border-[var(--accent)]" aria-label="Subir logo">
              {preview ? <img src={preview} alt="" className="size-full object-contain" /> : <ImagePlus className="size-6" />}
            </button>
            <p className="text-sm text-muted">Logo (opcional). Se recomienda fondo transparente o blanco.</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre comercial o razón social" optional hint={`Si lo dejas vacío se usa “${ws.name}”.`}>{(id, d) => <Input id={id} aria-describedby={d} value={f.legal_name} onChange={(e) => set("legal_name", e.target.value)} />}</Field>
            <Field label="RUC / Cédula" optional>{(id) => <Input id={id} value={f.tax_id} onChange={(e) => set("tax_id", e.target.value)} />}</Field>
            <Field label="Teléfono" optional>{(id) => <Input id={id} type="tel" value={f.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />}</Field>
            <Field label="Correo" optional>{(id) => <Input id={id} type="email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} />}</Field>
            <div className="sm:col-span-2"><Field label="Dirección" optional>{(id) => <Input id={id} value={f.address} onChange={(e) => set("address", e.target.value)} />}</Field></div>
            <Field label="Color de marca" hint="Se usa en tus cotizaciones y contratos.">
              {(id, d) => (
                <div className="flex items-center gap-2">
                  <input id={id} aria-describedby={d} type="color" value={f.brand_color} onChange={(e) => set("brand_color", e.target.value)} className="h-11 w-14 cursor-pointer rounded-xl border border-line bg-card" />
                  <div className="flex flex-wrap gap-1.5">{["#4a2c7a", "#1d1530", "#b9802a", "#c2416b", "#0f7468", "#3d4fc4", "#2f6f3e", "#9a3b2f"].map((c) => (
                    <button key={c} type="button" onClick={() => set("brand_color", c)} className="size-7 rounded-full ring-offset-2 data-[on=true]:ring-2 data-[on=true]:ring-ink" data-on={f.brand_color === c} style={{ background: c }} aria-label={`Color ${c}`} />))}</div>
                </div>
              )}
            </Field>
          </div>
          <div className="rounded-xl border border-line p-4">
            <div className="text-sm font-semibold">Firma en contratos</div>
            <p className="text-xs text-muted">Aparece en el apartado "El prestador" de tus contratos. Puedes desactivarla en cada contrato.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Nombre de quien firma" optional hint="Si lo dejas vacío se usa el nombre del negocio.">{(id, d) => <Input id={id} aria-describedby={d} value={f.signer_name} onChange={(e) => set("signer_name", e.target.value)} />}</Field>
              <Field label="Cargo" optional>{(id) => <Input id={id} value={f.signer_title} onChange={(e) => set("signer_title", e.target.value)} placeholder="Ej. Propietaria / Gerente" />}</Field>
            </div>
            {drawing ? (
              <div className="mt-3"><SignaturePad onChange={setSignature} height={150} />
                <button type="button" className="text-xs text-muted underline" onClick={() => { setDrawing(false); setSignature(null); }}>Cancelar</button></div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {(signatureFile || data?.signature_path) && <img src={signatureFile ? URL.createObjectURL(signatureFile) : publicMediaUrl(data?.signature_path) ?? ""} alt="Tu firma" className="h-16 max-w-48 rounded-lg border border-line bg-white object-contain p-1" />}
                <Button type="button" size="sm" variant="secondary" onClick={() => setDrawing(true)}>{data?.signature_path ? "Volver a firmar" : "Dibujar mi firma"}</Button>
                <label className="cursor-pointer text-sm font-semibold text-[var(--accent)] hover:underline">Subir imagen de firma
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setSignatureFile(e.target.files?.[0] ?? null)} /></label>
              </div>
            )}
          </div>
        </fieldset>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {!readOnly && <div className="flex justify-end"><Button type="submit" loading={busy}>Guardar datos del negocio</Button></div>}
      </form>}
    </Card>
  );
}
