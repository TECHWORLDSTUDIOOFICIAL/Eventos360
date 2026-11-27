import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Copy, Download, ExternalLink, Eye, EyeOff, MessageCircle, Printer, QrCode } from "lucide-react";
import { workspacePath } from "@/lib/modalities";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { guestName, invitationUrl, publicMediaUrl, useGuests, type EventRow } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { InvitationCard, TEMPLATE_LABELS, type InvitationView } from "@/components/InvitationCard";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

interface InvitationRow {
  id: string; template: InvitationView["template"]; accent_color: string; title: string | null; message: string | null;
  dress_code: string | null; rsvp_deadline: string | null; is_published: boolean;
}

const COLORS = ["#b9802a", "#c2416b", "#4a2c7a", "#3d4fc4", "#0f7468", "#2f6f3e", "#9a3b2f", "#1f2937"];

export default function InvitationsPage() {
  return <EventGate>{(ctx) => <Invitations {...ctx} />}</EventGate>;
}

export function Invitations({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const inv = useQuery({
    queryKey: ["invitation", event.id],
    queryFn: async () => unwrap<InvitationRow | null>(await supabase.from("invitations").select("*").eq("event_id", event.id).maybeSingle()),
  });
  const [f, setF] = useState<Omit<InvitationRow, "id">>({
    template: "elegante", accent_color: COLORS[0]!, title: "", message: "", dress_code: "", rsvp_deadline: "", is_published: false,
  });
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (inv.data) setF({ ...inv.data, title: inv.data.title ?? "", message: inv.data.message ?? "", dress_code: inv.data.dress_code ?? "", rsvp_deadline: inv.data.rsvp_deadline ?? "" });
    else if (inv.data === null) setF((s) => ({ ...s, title: defaultTitle(event.category), message: defaultMessage(event.category) }));
  }, [inv.data, event.category]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function save(e?: FormEvent, publish?: boolean) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    const row = {
      template: f.template, accent_color: f.accent_color, title: f.title?.trim() || null, message: f.message?.trim() || null,
      dress_code: f.dress_code?.trim() || null, rsvp_deadline: f.rsvp_deadline || null, is_published: publish ?? f.is_published,
    };
    const res = inv.data
      ? await supabase.from("invitations").update(row).eq("id", inv.data.id)
      : await supabase.from("invitations").insert({ ...row, workspace_id: ws.id, event_id: event.id });
    setBusy(false);
    if (res.error) return setMsg({ tone: "danger", text: res.error.message });
    setMsg({ tone: "ok", text: publish === true ? "¡Invitación publicada! Ya puedes enviar los enlaces." : publish === false ? "La invitación dejó de estar visible." : "Cambios guardados." });
    await qc.invalidateQueries({ queryKey: ["invitation", event.id] });
  }

  const view: InvitationView = {
    template: f.template, accent_color: f.accent_color, title: f.title, message: f.message, dress_code: f.dress_code,
    rsvp_deadline: f.rsvp_deadline || null, guestName: "Nombre del invitado",
    event: { name: event.name, honorees: event.honorees, starts_at: event.starts_at, venue_name: event.venue_name, venue_address: event.venue_address,
      venue_map_url: event.venue_map_url, cover_url: publicMediaUrl(event.cover_path), timezone: region.timezone, locale: region.locale },
  };

  if (inv.isLoading) return <Spinner />;
  const published = inv.data?.is_published;
  return (
    <div className="animate-rise">
      <PageHeader title="Invitación digital" description="Diseña tu invitación. Cada invitado recibe su propio enlace para confirmar asistencia desde el celular."
        actions={<>
          <EventSwitcher events={events} current={event} onSelect={select} />
          {published ? <Badge tone="ok" className="h-8 px-3">Publicada</Badge> : <Badge tone="neutral" className="h-8 px-3">Borrador</Badge>}
          <Link to={workspacePath(ws.kind, ws.id, `imprimir/invitaciones?evento=${event.id}`)}><Button variant="secondary" icon={<Printer className="size-4" />}>Imprimir invitaciones</Button></Link>
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Diseño" />
            <form onSubmit={(e) => void save(e)} className="space-y-4 px-5 py-5">
              <fieldset disabled={readOnly} className="space-y-4">
                <div>
                  <div className="mb-1.5 text-sm font-medium">Estilo</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(Object.keys(TEMPLATE_LABELS) as InvitationView["template"][]).map((t) => (
                      <button key={t} type="button" onClick={() => set("template", t)}
                        className={cx("rounded-xl border px-3 py-2 text-sm font-semibold", f.template === t ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-line bg-card")}>
                        {TEMPLATE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-sm font-medium">Color</div>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => set("accent_color", c)} aria-label={`Color ${c}`}
                        className={cx("size-9 rounded-full ring-offset-2 transition", f.accent_color === c && "ring-2 ring-ink")} style={{ background: c }} />
                    ))}
                  </div>
                </div>
                <Field label="Encabezado">{(id) => <Input id={id} value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={120} />}</Field>
                <Field label="Mensaje">{(id) => <Textarea id={id} value={f.message ?? ""} onChange={(e) => set("message", e.target.value)} maxLength={1500} className="min-h-28" />}</Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Código de vestimenta" optional>{(id) => <Input id={id} value={f.dress_code ?? ""} onChange={(e) => set("dress_code", e.target.value)} placeholder="Ej. Formal" />}</Field>
                  <Field label="Confirmar antes del" optional>{(id) => <Input id={id} type="date" value={f.rsvp_deadline ?? ""} onChange={(e) => set("rsvp_deadline", e.target.value)} />}</Field>
                </div>
                <p className="text-xs text-muted">Fecha, hora, lugar y foto de portada se toman de <strong>Mi evento</strong>.</p>
              </fieldset>
              {!readOnly && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                  <Button type="submit" variant="secondary" loading={busy}>Guardar</Button>
                  {published
                    ? <Button type="button" variant="ghost" icon={<EyeOff className="size-4" />} onClick={() => void save(undefined, false)}>Despublicar</Button>
                    : <Button type="button" variant="accent" icon={<Eye className="size-4" />} onClick={() => void save(undefined, true)} loading={busy}>Publicar invitación</Button>}
                </div>
              )}
            </form>
          </Card>
          <ShareCard event={event} published={!!published} />
        </div>
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Vista previa</div>
          <div className="rounded-[32px] bg-[#efe9df] p-3 sm:p-5"><InvitationCard v={view} /></div>
        </div>
      </div>
    </div>
  );
}

function ShareCard({ event, published }: { event: EventRow; published: boolean }) {
  const { data: guests } = useGuests(event.id);
  const [guestId, setGuestId] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const guest = useMemo(() => (guests ?? []).find((g) => g.id === guestId) ?? guests?.[0], [guests, guestId]);
  const url = guest ? invitationUrl(guest.invite_token) : "";

  useEffect(() => {
    let alive = true;
    setCopied(false);
    if (!url) { setQr(null); return; }
    void import("qrcode").then((QR) => QR.toDataURL(url, { margin: 1, width: 360, color: { dark: "#1d1530", light: "#ffffff" } })).then((d) => { if (alive) setQr(d); });
    return () => { alive = false; };
  }, [url]);

  if (!guests?.length) {
    return <Card><CardHeader title="Compartir" description="Agrega invitados para obtener sus enlaces y códigos QR." /></Card>;
  }
  return (
    <Card>
      <CardHeader title="Compartir" description="Cada invitado tiene un enlace único. En Invitados puedes enviarlos uno por uno por WhatsApp." />
      <div className="space-y-4 px-5 py-5">
        {!published && <Alert tone="warn">Publica la invitación para que los enlaces funcionen.</Alert>}
        <Field label="Invitado">
          {(id) => (
            <Select id={id} value={guest?.id ?? ""} onChange={(e) => setGuestId(e.target.value)}>
              {guests.map((g) => <option key={g.id} value={g.id}>{guestName(g)}</option>)}
            </Select>
          )}
        </Field>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {qr ? <img src={qr} alt={`Código QR de la invitación de ${guest ? guestName(guest) : ""}`} className="size-36 rounded-xl border border-line" /> :
            <div className="grid size-36 place-items-center rounded-xl border border-line text-faint"><QrCode className="size-8" /></div>}
          <div className="w-full min-w-0 space-y-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} className="h-10 text-xs" aria-label="Enlace de invitación" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopied(true)); }}>{copied ? "¡Copiado!" : "Copiar"}</Button>
              {qr && <a href={qr} download={`QR - ${guest ? guestName(guest) : "invitacion"}.png`}><Button size="sm" variant="secondary" icon={<Download className="size-3.5" />}>QR</Button></a>}
              <a href={url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />}>Abrir</Button></a>
              {guest && <a href={`https://wa.me/${waNumber(guest.phone)}?text=${encodeURIComponent(`¡Hola ${guest.first_name}! Te invitamos a ${event.name}. Confirma tu asistencia aquí: ${url}`)}`} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost" icon={<MessageCircle className="size-3.5" />}>WhatsApp</Button></a>}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const waNumber = (phone: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 8 ? `505${d}` : d;
};

function defaultTitle(category: string) {
  return ({ boda: "Nos casamos", quinceanos: "Mis XV años", cumpleanos: "¡Celebremos!", graduacion: "Me gradúo", aniversario: "Celebramos nuestro aniversario", bautizo: "Mi bautizo", baby_shower: "Baby shower" } as Record<string, string>)[category] ?? "Estás invitado";
}
function defaultMessage(category: string) {
  return category === "boda"
    ? "Con la bendición de Dios y de nuestros padres, tenemos el honor de invitarte a celebrar nuestra unión."
    : "Será un honor contar con tu presencia en este día tan especial.";
}
