import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, MapPin, MessageCircle, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl } from "@/lib/events";
import { waNumber } from "@/lib/pro";
import { formatMoney } from "@/lib/format";
import { scheduleText } from "@/lib/venues";
import { Alert, Badge, Button, Spinner, cx } from "@/components/ui";

interface PubShift {
  id: string; status: "assigned" | "confirmed" | "declined" | "attended" | "absent"; position: string; starts_at: string; ends_at: string;
  location: string | null; address: string | null; map_url: string | null; event: string | null; instructions: string | null; pay: number; currency: string; paid: boolean;
}
interface PubData {
  business: { name: string; phone: string | null; logo_path: string | null; brand_color: string | null; locale: string; timezone: string };
  worker: { name: string }; timezone: string; shifts: PubShift[];
}

const STATUS: Record<PubShift["status"], { label: string; tone: "warn" | "info" | "danger" | "ok" }> = {
  assigned: { label: "Falta tu respuesta", tone: "warn" }, confirmed: { label: "Confirmaste", tone: "info" }, declined: { label: "Dijiste que no puedes", tone: "danger" },
  attended: { label: "Trabajado", tone: "ok" }, absent: { label: "No asististe", tone: "danger" },
};

/** Página del trabajador: sus turnos y la opción de confirmar o rechazar (sin cuenta). */
export default function PublicWorker() {
  const { token } = useParams();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["public-worker", token],
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("public_worker", { p_token: token });
      if (error) throw new Error(error.message);
      return d as PubData | null;
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  useEffect(() => { if (data?.business) document.title = `Mis turnos · ${data.business.name}`; }, [data]);

  if (isLoading) return <div className="grid min-h-dvh place-items-center bg-paper"><Spinner /></div>;
  if (!data) return (
    <div className="grid min-h-dvh place-items-center bg-paper px-4 text-center">
      <div><h1 className="font-display text-3xl font-semibold">Enlace no disponible</h1><p className="mt-2 text-muted">Pide a quien te contrató que te envíe tu enlace de nuevo.</p></div>
    </div>
  );
  const b = data.business;
  const tz = data.timezone || b.timezone;
  const logo = publicMediaUrl(b.logo_path);
  const now = Date.now();
  const upcoming = data.shifts.filter((s) => new Date(s.ends_at).getTime() >= now);
  const past = data.shifts.filter((s) => new Date(s.ends_at).getTime() < now).reverse();

  async function respond(s: PubShift, accept: boolean) {
    setBusy(s.id); setMsg(null);
    const { data: r, error } = await supabase.rpc("public_worker_respond", { p_token: token, p_assignment: s.id, p_accept: accept });
    setBusy(null);
    const res = r as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg({ tone: "danger", text: res?.message ?? "No se pudo guardar. Intenta de nuevo." });
    setMsg({ tone: "ok", text: accept ? `¡Listo! Confirmaste: ${s.position}.` : "Avisamos que no puedes ir. ¡Gracias por responder!" });
    await refetch();
  }

  const card = (s: PubShift, isPast: boolean) => (
    <li key={s.id} className={cx("rounded-2xl border bg-card p-4 shadow-sm", s.status === "assigned" && !isPast ? "border-[var(--accent)]" : "border-line")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-display text-xl font-semibold">{s.position}</div>
          {s.event && <div className="text-sm text-muted">{s.event}</div>}
        </div>
        <Badge tone={STATUS[s.status].tone}>{s.paid ? "Pagado" : STATUS[s.status].label}</Badge>
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" /><span className="first-letter:uppercase">{scheduleText(s.starts_at, s.ends_at, tz, b.locale)}</span></div>
        {s.location && <div className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" /><span>{s.location}{s.address && s.address !== s.location ? ` · ${s.address}` : ""}
          {s.map_url && <> · <a href={s.map_url} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent)] underline">Ver mapa</a></>}</span></div>}
        {s.instructions && <div className="rounded-xl bg-paper px-3 py-2 text-muted">{s.instructions}</div>}
        {Number(s.pay) > 0 && <div>Pago: <span className="font-semibold">{formatMoney(Number(s.pay), s.currency, b.locale)}</span></div>}
      </div>
      {!isPast && (s.status === "assigned" || s.status === "confirmed" || s.status === "declined") && !s.paid && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant={s.status === "confirmed" ? "secondary" : "accent"} icon={<CheckCircle2 className="size-4" />} loading={busy === s.id} disabled={s.status === "confirmed"} onClick={() => void respond(s, true)}>
            {s.status === "confirmed" ? "Confirmado" : "Sí, voy"}</Button>
          <Button variant="secondary" icon={<XCircle className="size-4" />} disabled={busy === s.id || s.status === "declined"} onClick={() => void respond(s, false)}>
            {s.status === "declined" ? "No voy" : "No puedo"}</Button>
        </div>
      )}
    </li>
  );

  return (
    <div className="min-h-dvh bg-paper" style={{ ["--accent" as string]: b.brand_color || "#3b4bc8" }}>
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-4">
          {logo && <img src={logo} alt="" className="size-12 rounded-xl object-contain" />}
          <div className="min-w-0 flex-1"><div className="text-sm text-muted">{b.name}</div><h1 className="font-display text-2xl font-semibold leading-tight">Hola, {data.worker.name}</h1></div>
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6">
        {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}
        <section>
          <h2 className="mb-3 font-semibold">Tus próximos turnos</h2>
          {upcoming.length ? <ul className="space-y-3">{upcoming.map((s) => card(s, false))}</ul>
            : <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">No tienes turnos próximos. Cuando te asignen uno, aparecerá aquí.</p>}
        </section>
        {past.length > 0 && <section><h2 className="mb-3 font-semibold text-muted">Turnos recientes</h2><ul className="space-y-3 opacity-80">{past.map((s) => card(s, true))}</ul></section>}
        {b.phone && <a href={`https://wa.me/${waNumber(b.phone)}`} target="_blank" rel="noreferrer" className="block"><Button variant="secondary" className="w-full" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>Escribir a {b.name}</Button></a>}
        <p className="text-center text-xs text-faint">Este enlace es personal. No lo compartas.</p>
      </main>
    </div>
  );
}
