import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { guestName, invitationUrl, publicMediaUrl, useGuestGroups, useGuests, type EventRow } from "@/lib/events";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { InvitationCard, type InvitationView } from "@/components/InvitationCard";
import { PrintLayout, Sheet, type Paper } from "@/components/PrintLayout";
import { Alert, Select, Spinner } from "@/components/ui";

interface InvRow { template: InvitationView["template"]; accent_color: string; title: string | null; message: string | null; dress_code: string | null; rsvp_deadline: string | null; is_published: boolean }

/** Invitaciones listas para imprimir: una por invitado (con su nombre y QR para confirmar) o una general. */
export default function PrintInvitations({ event }: { event: EventRow }) {
  const { ws, region } = useWorkspace();
  const { data: guests, isLoading } = useGuests(event.id);
  const { data: groups } = useGuestGroups(event.id);
  const inv = useQuery({
    queryKey: ["invitation", event.id],
    queryFn: async () => unwrap<InvRow | null>(await supabase.from("invitations").select("*").eq("event_id", event.id).maybeSingle()),
  });
  const [mode, setMode] = useState<"guests" | "general">("guests");
  const [group, setGroup] = useState("");
  const [paper, setPaper] = useState<Paper>("half");
  const [qr, setQr] = useState<Record<string, string>>({});

  const list = useMemo(() => (guests ?? []).filter((g) => g.status !== "declined" && (!group || g.group_id === group)), [guests, group]);

  useEffect(() => {
    if (mode !== "guests" || !list.length) return;
    let alive = true;
    void import("qrcode").then(async (QR) => {
      const entries = await Promise.all(list.map(async (g) => [g.id, await QR.toDataURL(invitationUrl(g.invite_token), { margin: 0, width: 240, color: { dark: "#1d1530", light: "#ffffff" } })] as const));
      if (alive) setQr(Object.fromEntries(entries));
    });
    return () => { alive = false; };
  }, [list, mode]);

  if (isLoading || inv.isLoading) return <Spinner />;
  const i = inv.data;
  const base: Omit<InvitationView, "guestName"> = {
    template: i?.template ?? "elegante", accent_color: i?.accent_color ?? "#b9802a", title: i?.title ?? null, message: i?.message ?? null,
    dress_code: i?.dress_code ?? null, rsvp_deadline: i?.rsvp_deadline ?? null,
    event: { name: event.name, honorees: event.honorees, starts_at: event.starts_at, venue_name: event.venue_name, venue_address: event.venue_address,
      venue_map_url: null, cover_url: publicMediaUrl(event.cover_path), timezone: region.timezone, locale: region.locale },
  };
  const accent = base.accent_color;

  return (
    <PrintLayout title="Imprimir invitaciones" backTo={workspacePath(ws.kind, ws.id, "m/invitations")} paper={paper}
      controls={<>
        <Select value={mode} onChange={(e) => setMode(e.target.value as "guests" | "general")} className="h-10 w-auto" aria-label="Tipo">
          <option value="guests">Una por invitado (con QR)</option>
          <option value="general">Invitación general (sin nombre)</option>
        </Select>
        {mode === "guests" && (
          <Select value={group} onChange={(e) => setGroup(e.target.value)} className="h-10 w-auto" aria-label="Grupo">
            <option value="">Todos los invitados ({(guests ?? []).filter((g) => g.status !== "declined").length})</option>
            {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        )}
        <Select value={paper} onChange={(e) => setPaper(e.target.value as Paper)} className="h-10 w-auto" aria-label="Papel">
          <option value="half">Media carta</option>
          <option value="letter">Carta</option>
        </Select>
      </>}>
      <div className="mx-auto mb-4 max-w-xl space-y-2 print:hidden">
        {!i && <Alert tone="warn">Aún no diseñas la invitación: se usará el estilo predeterminado. Personalízala en Invitaciones.</Alert>}
        {i && !i.is_published && mode === "guests" && <Alert tone="warn">La invitación no está publicada: los códigos QR no funcionarán hasta que la publiques.</Alert>}
        {mode === "guests" && !list.length && <Alert tone="info">No hay invitados para imprimir con este filtro.</Alert>}
      </div>
      {mode === "general" ? (
        <Sheet paper={paper}><InvitationCard print v={base} /></Sheet>
      ) : list.map((g) => (
        <Sheet key={g.id} paper={paper}>
          <InvitationCard print v={{ ...base, guestName: guestName(g) }}>
            <div className="flex items-center gap-4">
              {qr[g.id] ? <img src={qr[g.id]} alt="" className="size-[88px] shrink-0 rounded-md bg-white p-1" /> : <div className="size-[88px] shrink-0" />}
              <div className="text-sm">
                <div className="font-semibold" style={{ color: accent }}>Confirma tu asistencia</div>
                <div className="opacity-80">Escanea el código con la cámara de tu celular.</div>
                <div className="mt-1 text-xs opacity-70">Invitación para {g.max_companions + 1} persona{g.max_companions ? "s" : ""}</div>
              </div>
            </div>
          </InvitationCard>
        </Sheet>
      ))}
    </PrintLayout>
  );
}
