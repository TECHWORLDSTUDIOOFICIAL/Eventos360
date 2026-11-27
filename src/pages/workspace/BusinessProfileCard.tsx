import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl, uploadImage } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { useBusiness } from "@/pages/pro/print/PrintQuote";
import { Alert, Button, Card, CardHeader, Field, Input } from "@/components/ui";

/** Datos del negocio que aparecen en cotizaciones y contratos. */
export default function BusinessProfileCard() {
  const { ws, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const { data } = useBusiness(ws.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ legal_name: "", tax_id: "", contact_phone: "", contact_email: "", address: "" });
  const [logo, setLogo] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setF({ legal_name: data.legal_name ?? "", tax_id: data.tax_id ?? "", contact_phone: data.contact_phone ?? "", contact_email: data.contact_email ?? "", address: data.address ?? "" });
  }, [data]);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const preview = logo ? URL.createObjectURL(logo) : publicMediaUrl(data?.logo_path);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const row: Record<string, string | null> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
      if (logo) {
        row.logo_path = await uploadImage("event-media", `${ws.id}/marca/logo-${Date.now()}.webp`, logo, 600);
        if (data?.logo_path) await supabase.storage.from("event-media").remove([data.logo_path]);
      }
      const { error } = await supabase.from("workspaces").update(row).eq("id", ws.id);
      if (error) throw new Error(error.message);
      setLogo(null);
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
      <CardHeader title="Datos del negocio" description="Aparecen en el encabezado de tus cotizaciones y contratos." />
      <form onSubmit={save} className="space-y-4 px-5 py-5">
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
          </div>
        </fieldset>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {!readOnly && <div className="flex justify-end"><Button type="submit" loading={busy}>Guardar datos del negocio</Button></div>}
      </form>
    </Card>
  );
}
