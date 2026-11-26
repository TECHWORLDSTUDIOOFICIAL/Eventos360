import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usePlatformSettings } from "@/lib/queries";
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Spinner, Textarea } from "@/components/ui";

export default function AdminSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = usePlatformSettings();
  const [wa, setWa] = useState("");
  const [message, setMessage] = useState("");
  const [grace, setGrace] = useState("5");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setWa(String(data["support.whatsapp"] ?? ""));
    setMessage(String(data["support.message"] ?? ""));
    setGrace(String(data["billing.grace_days"] ?? 5));
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const rows = [
      { key: "support.whatsapp", value: wa.replace(/\D/g, "") },
      { key: "support.message", value: message.trim() },
      { key: "billing.grace_days", value: Math.max(0, Math.min(60, Number(grace) || 0)) },
    ];
    for (const r of rows) {
      const { error } = await supabase.from("platform_settings").update({ value: r.value, updated_at: new Date().toISOString() }).eq("key", r.key);
      if (error) { setBusy(false); return setMsg({ tone: "danger", text: error.message }); }
    }
    setBusy(false);
    setMsg({ tone: "ok", text: "Ajustes guardados." });
    await qc.invalidateQueries({ queryKey: ["platform-settings"] });
  }

  if (isLoading) return <Spinner />;
  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Ajustes" description="Información pública de contacto y reglas de facturación." />
      <Card className="max-w-2xl">
        <CardHeader title="Ventas y soporte" description="Estos datos se muestran en la página pública, en el registro y en los avisos de renovación." />
        <form onSubmit={save} className="space-y-5 px-5 py-5">
          <Field label="WhatsApp de ventas/soporte" hint="Formato internacional sin signos. Ej.: 50588887777">
            {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="505…" />}
          </Field>
          <Field label="Mensaje para clientes sin código">
            {(id) => <Textarea id={id} value={message} onChange={(e) => setMessage(e.target.value)} />}
          </Field>
          <Field label="Días de gracia tras el vencimiento" hint="Durante la gracia el cliente puede seguir trabajando; después la cuenta pasa a solo lectura.">
            {(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} max={60} value={grace} onChange={(e) => setGrace(e.target.value)} className="w-32" />}
          </Field>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex justify-end"><Button type="submit" loading={busy}>Guardar</Button></div>
        </form>
      </Card>
    </div>
  );
}
