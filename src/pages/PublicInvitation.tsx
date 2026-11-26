import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Minus, Plus, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl } from "@/lib/events";
import { InvitationCard, type InvitationView } from "@/components/InvitationCard";
import { Logo } from "@/components/Logo";
import { Alert, Button, Spinner, Textarea, cx } from "@/components/ui";

interface PublicData {
  guest: { first_name: string; last_name: string | null; max_companions: number; status: string; adults: number; children: number; rsvp_message: string | null; responded_at: string | null };
  event: { name: string; honorees: string | null; starts_at: string | null; venue_name: string | null; venue_address: string | null; venue_map_url: string | null; cover_path: string | null; timezone: string; locale: string };
  invitation: { template: InvitationView["template"]; accent_color: string; title: string | null; message: string | null; dress_code: string | null; rsvp_deadline: string | null; rsvp_open: boolean };
}

/** Página pública de invitación con confirmación de asistencia (no requiere cuenta). */
export default function PublicInvitation() {
  const { token } = useParams();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["public-invitation", token],
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("public_invitation", { p_token: token });
      if (error) throw new Error(error.message);
      return d as PublicData | null;
    },
  });

  useEffect(() => { if (data?.event) document.title = `${data.event.honorees || data.event.name} · Invitación`; }, [data]);

  if (isLoading) return <div className="grid min-h-dvh place-items-center bg-paper"><Spinner /></div>;
  if (!data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper px-4 text-center">
        <div>
          <h1 className="font-display text-3xl font-semibold">Invitación no disponible</h1>
          <p className="mt-2 text-muted">El enlace no es válido o la invitación todavía no fue publicada.</p>
        </div>
      </div>
    );
  }

  const v: InvitationView = {
    ...data.invitation,
    event: { ...data.event, cover_url: publicMediaUrl(data.event.cover_path) },
    guestName: [data.guest.first_name, data.guest.last_name].filter(Boolean).join(" "),
  };
  return (
    <div className="min-h-dvh px-3 py-6 sm:py-12" style={{ background: `radial-gradient(1200px 600px at 50% -10%, ${data.invitation.accent_color}22, transparent 60%), #f3efe8` }}>
      <div className="mx-auto max-w-xl">
        <InvitationCard v={v}>
          <Rsvp token={token!} data={data} onSaved={() => void refetch()} />
        </InvitationCard>
        <p className="mt-8 flex items-center justify-center gap-2 text-xs text-muted">Invitación creada con <Logo className="scale-75" /></p>
      </div>
    </div>
  );
}

function Rsvp({ token, data, onSaved }: { token: string; data: PublicData; onSaved: () => void }) {
  const g = data.guest;
  const maxPeople = g.max_companions + 1;
  const answered = g.status === "confirmed" || g.status === "declined";
  const [editing, setEditing] = useState(!answered);
  const [attending, setAttending] = useState<boolean | null>(answered ? g.status === "confirmed" : null);
  const [adults, setAdults] = useState(g.status === "confirmed" ? g.adults : Math.min(maxPeople, 1));
  const [children, setChildren] = useState(g.status === "confirmed" ? g.children : 0);
  const [message, setMessage] = useState(g.rsvp_message ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accent = data.invitation.accent_color;

  if (!data.invitation.rsvp_open && !answered) {
    return <p className="text-center text-sm opacity-80">La confirmación de asistencia ya cerró. Si necesitas avisar algo, contacta a los anfitriones.</p>;
  }

  if (!editing) {
    return (
      <div className="text-center">
        {g.status === "confirmed" ? <CheckCircle2 className="mx-auto size-10" style={{ color: accent }} /> : <XCircle className="mx-auto size-10 opacity-60" />}
        <p className="mt-3 text-lg font-semibold">{g.status === "confirmed" ? "¡Gracias por confirmar!" : "Gracias por avisarnos"}</p>
        <p className="mt-1 text-sm opacity-75">
          {g.status === "confirmed" ? `Asistirán ${g.adults} adulto(s)${g.children ? ` y ${g.children} niño(s)` : ""}.` : "Registramos que no podrás asistir."}
        </p>
        {data.invitation.rsvp_open && <button onClick={() => setEditing(true)} className="mt-4 text-sm font-semibold underline" style={{ color: accent }}>Cambiar mi respuesta</button>}
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (attending === null) return setError("Elige si asistirás.");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("public_rsvp", { p_token: token, p_attending: attending, p_adults: adults, p_children: children, p_message: message || null });
    setBusy(false);
    if (err) return setError(err.message);
    setEditing(false);
    onSaved();
  }

  const Counter = ({ label, value, set, min, max }: { label: string; value: number; set: (n: number) => void; min: number; max: number }) => (
    <div className="flex items-center justify-between rounded-2xl px-4 py-2.5" style={{ background: `${accent}14` }}>
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => set(Math.max(min, value - 1))} disabled={value <= min} className="grid size-8 place-items-center rounded-full border disabled:opacity-30" style={{ borderColor: accent }} aria-label={`Menos ${label}`}><Minus className="size-4" /></button>
        <span className="w-5 text-center font-semibold tabular-nums">{value}</span>
        <button type="button" onClick={() => set(Math.min(max, value + 1))} disabled={value >= max} className="grid size-8 place-items-center rounded-full border disabled:opacity-30" style={{ borderColor: accent }} aria-label={`Más ${label}`}><Plus className="size-4" /></button>
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-center text-lg font-semibold">¿Nos acompañarás?</p>
      <div className="grid grid-cols-2 gap-2">
        {[{ v: true, l: "Sí, asistiré" }, { v: false, l: "No podré ir" }].map((o) => (
          <button key={String(o.v)} type="button" onClick={() => setAttending(o.v)}
            className={cx("rounded-2xl border-2 px-3 py-3 text-sm font-semibold transition")}
            style={attending === o.v ? { background: accent, borderColor: accent, color: "#fff" } : { borderColor: `${accent}55` }}>
            {o.l}
          </button>
        ))}
      </div>
      {attending && maxPeople > 1 && (
        <div className="space-y-2">
          <p className="text-center text-xs opacity-75">Tu invitación es para hasta {maxPeople} personas (incluyéndote).</p>
          <Counter label="Adultos" value={adults} set={(n) => { setAdults(n); if (n + children > maxPeople) setChildren(maxPeople - n); }} min={1} max={maxPeople - children} />
          <Counter label="Niños" value={children} set={setChildren} min={0} max={maxPeople - adults} />
        </div>
      )}
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="Mensaje para los anfitriones (opcional)" className="bg-white/80 text-ink" />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" loading={busy} className="w-full text-white" style={{ background: accent }}>Enviar respuesta</Button>
    </form>
  );
}
