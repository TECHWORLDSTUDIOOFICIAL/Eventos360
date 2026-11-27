import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, MapPin, MessageCircle, Phone, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { publicMediaUrl } from "@/lib/events";
import { waNumber } from "@/lib/pro";
import { SETUPS, VENUE_KINDS, type SetupKey } from "@/lib/venues";
import { Logo } from "@/components/Logo";
import { Alert, Button, Field, Input, Select, Spinner, Textarea, cx } from "@/components/ui";

interface PubVenue {
  id: string; name: string; kind: string; description: string | null; indoor: boolean; area_m2: number | null; cap_banquet: number | null; cap_theater: number | null;
  cap_cocktail: number | null; cap_classroom: number | null; cap_u: number | null; amenities: string[]; includes: string | null; rules: string | null; photos: string[]; busy: string[];
}
interface PubData { business: { name: string; phone: string | null; email: string | null; address: string | null; logo_path: string | null; brand_color: string | null; locale: string; timezone: string }; venues: PubVenue[] }

/** Página pública: tus espacios, fechas ocupadas y formulario de consulta (no requiere cuenta). */
export default function PublicVenues() {
  const { token } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["public-venues", token],
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("public_venues", { p_token: token });
      if (error) throw new Error(error.message);
      return d as PubData | null;
    },
  });
  const [venueId, setVenueId] = useState<string>("");
  useEffect(() => { if (data?.business) document.title = `${data.business.name} · Espacios y disponibilidad`; if (data?.venues[0] && !venueId) setVenueId(data.venues[0].id); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <div className="grid min-h-dvh place-items-center bg-paper"><Spinner /></div>;
  if (!data) return (
    <div className="grid min-h-dvh place-items-center bg-paper px-4 text-center">
      <div><h1 className="font-display text-3xl font-semibold">Página no disponible</h1><p className="mt-2 text-muted">El enlace no es válido o el negocio lo desactivó.</p></div>
    </div>
  );
  const b = data.business;
  const accent = b.brand_color || "#0f7468";
  const logo = publicMediaUrl(b.logo_path);
  const v = data.venues.find((x) => x.id === venueId) ?? data.venues[0];

  return (
    <div className="min-h-dvh bg-paper" style={{ ["--accent" as string]: accent }}>
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-5 sm:px-6">
          {logo && <img src={logo} alt="" className="size-14 rounded-xl object-contain" />}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold leading-tight">{b.name}</h1>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {b.address && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{b.address}</span>}
              {b.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3.5" />{b.phone}</span>}
            </div>
          </div>
          {b.phone && <a href={`https://wa.me/${waNumber(b.phone)}`} target="_blank" rel="noreferrer" className="hidden sm:block"><Button variant="secondary" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>WhatsApp</Button></a>}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {data.venues.length > 1 && (
          <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
            {data.venues.map((x) => (
              <button key={x.id} onClick={() => setVenueId(x.id)} className={cx("whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold", x.id === v?.id ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-line bg-card")}>{x.name}</button>
            ))}
          </div>
        )}
        {!v ? <p className="text-muted">Pronto publicaremos nuestros espacios.</p> : (
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <Gallery photos={v.photos} name={v.name} />
              <h2 className="mt-5 font-display text-3xl font-semibold">{v.name}</h2>
              <p className="text-sm text-muted">{VENUE_KINDS[v.kind] ?? v.kind} · {v.indoor ? "Bajo techo" : "Al aire libre"}{v.area_m2 ? ` · ${Number(v.area_m2)} m²` : ""}</p>
              {v.description && <p className="mt-4 whitespace-pre-line leading-relaxed text-ink-soft">{v.description}</p>}
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(SETUPS) as SetupKey[]).filter((k) => SETUPS[k].cap && v[SETUPS[k].cap as keyof PubVenue]).map((k) => (
                  <div key={k} className="rounded-xl border border-line bg-card p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted"><Users className="size-3.5" />{SETUPS[k].label}</div>
                    <div className="font-display text-2xl font-semibold">{v[SETUPS[k].cap as keyof PubVenue] as number}</div>
                    <div className="text-[11px] text-muted">{SETUPS[k].hint}</div>
                  </div>
                ))}
              </div>
              {v.amenities.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{v.amenities.map((a) => <span key={a} className="rounded-full bg-card px-3 py-1 text-xs font-medium ring-1 ring-line">✓ {a}</span>)}</div>}
              {(v.includes || v.rules) && (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {v.includes && <div className="rounded-2xl bg-card p-4 ring-1 ring-line"><h3 className="text-sm font-semibold">Incluye</h3><p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{v.includes}</p></div>}
                  {v.rules && <div className="rounded-2xl bg-card p-4 ring-1 ring-line"><h3 className="text-sm font-semibold">Reglas</h3><p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{v.rules}</p></div>}
                </div>
              )}
            </section>
            <aside className="space-y-6">
              <BusyCalendar busy={v.busy} locale={b.locale} timezone={b.timezone} />
              <InquiryForm token={token!} venues={data.venues} venueId={v.id} onVenue={setVenueId} phone={b.phone} business={b.name} timezone={b.timezone} busy={v.busy} />
            </aside>
          </div>
        )}
      </main>
      <footer className="flex items-center justify-center gap-2 pb-8 text-xs text-muted">Página creada con <Logo className="scale-75" /></footer>
    </div>
  );
}

function Gallery({ photos, name }: { photos: string[]; name: string }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [photos]);
  if (!photos.length) return <div className="grid aspect-[16/10] place-items-center rounded-2xl bg-card text-faint ring-1 ring-line">Sin fotos</div>;
  const n = photos.length;
  return (
    <div>
      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-card">
        <img src={publicMediaUrl(photos[i])!} alt={`${name}, foto ${i + 1}`} className="size-full object-cover" />
        {n > 1 && <>
          <button onClick={() => setI((i - 1 + n) % n)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow" aria-label="Foto anterior"><ChevronLeft className="size-5" /></button>
          <button onClick={() => setI((i + 1) % n)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow" aria-label="Foto siguiente"><ChevronRight className="size-5" /></button>
          <span className="absolute bottom-3 right-3 rounded-full bg-ink/70 px-2 py-0.5 text-xs text-white">{i + 1} / {n}</span>
        </>}
      </div>
      {n > 1 && <div className="mt-2 flex gap-2 overflow-x-auto">{photos.map((p, k) => <button key={p} onClick={() => setI(k)} className={cx("size-16 shrink-0 overflow-hidden rounded-lg ring-2", k === i ? "ring-[var(--accent)]" : "ring-transparent")}><img src={publicMediaUrl(p)!} alt="" className="size-full object-cover" /></button>)}</div>}
    </div>
  );
}

/** Calendario de fechas ocupadas (sin datos de clientes). */
function BusyCalendar({ busy, locale, timezone }: { busy: string[]; locale: string; timezone: string }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [offset, setOffset] = useState(0);
  const set = useMemo(() => new Set(busy), [busy]);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const name = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
      <div className="mb-3 flex items-center justify-between">
        <button disabled={offset === 0} onClick={() => setOffset(offset - 1)} className="rounded-lg p-1.5 hover:bg-ink/5 disabled:opacity-30" aria-label="Mes anterior"><ChevronLeft className="size-4" /></button>
        <div className="font-semibold">{name.charAt(0).toUpperCase() + name.slice(1)}</div>
        <button disabled={offset >= 11} onClick={() => setOffset(offset + 1)} className="rounded-lg p-1.5 hover:bg-ink/5 disabled:opacity-30" aria-label="Mes siguiente"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i} className="py-1 font-semibold text-muted">{d}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = `${first.toISOString().slice(0, 8)}${String(i + 1).padStart(2, "0")}`;
          const taken = set.has(d), pastDay = d < today;
          return <div key={d} className={cx("rounded-md py-1.5 tabular-nums", pastDay ? "text-faint" : taken ? "bg-danger-soft font-semibold text-danger line-through" : "bg-ok-soft text-ok")}>{i + 1}</div>;
        })}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-ok-soft" />Disponible</span><span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-danger-soft" />Ocupado</span></div>
    </div>
  );
}

function InquiryForm({ token, venues, venueId, onVenue, phone, business, timezone, busy }: {
  token: string; venues: PubVenue[]; venueId: string; onVenue: (id: string) => void; phone: string | null; business: string; timezone: string; busy: string[];
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [f, setF] = useState({ date: "", slot: "noche", guests: "", name: "", phone: "", message: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busyBtn, setBusyBtn] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const taken = f.date && busy.includes(f.date);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.date) return setError("Elige la fecha de tu evento.");
    setBusyBtn(true);
    const { data, error: err } = await supabase.rpc("public_venue_inquiry", { p_token: token, p_venue: venueId, p_date: f.date, p_slot: f.slot, p_guests: Number(f.guests) || 0, p_name: f.name, p_phone: f.phone, p_message: f.message || null });
    setBusyBtn(false);
    const r = data as { ok: boolean; message?: string; number?: number } | null;
    if (err || !r?.ok) return setError(r?.message ?? "No pudimos enviar tu consulta. Intenta de nuevo.");
    setDone(r.number ?? 0);
  }
  if (done !== null) return (
    <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-line">
      <CheckCircle2 className="mx-auto size-10 text-ok" />
      <h3 className="mt-3 text-lg font-semibold">¡Consulta enviada!</h3>
      <p className="mt-1 text-sm text-muted">{business} te contactará pronto para confirmar disponibilidad y precio.</p>
      {phone && <a href={`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(`Hola, envié una consulta para el ${f.date} (${venues.find((x) => x.id === venueId)?.name}).`)}`} target="_blank" rel="noreferrer" className="mt-4 inline-block"><Button variant="secondary" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>Escribir por WhatsApp</Button></a>}
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-line">
      <h3 className="text-lg font-semibold">Consulta tu fecha</h3>
      {venues.length > 1 && <Field label="Espacio">{(id) => <Select id={id} value={venueId} onChange={(e) => onVenue(e.target.value)}>{venues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fecha">{(id) => <Input id={id} type="date" min={today} value={f.date} onChange={(e) => set("date", e.target.value)} />}</Field>
        <Field label="Horario">{(id) => <Select id={id} value={f.slot} onChange={(e) => set("slot", e.target.value)}><option value="manana">Mañana</option><option value="tarde">Tarde</option><option value="noche">Noche</option></Select>}</Field>
      </div>
      {taken && <Alert tone="warn">Ese día ya tiene un evento. Igual puedes enviar tu consulta por si hay otro horario o se libera.</Alert>}
      <Field label="Número de invitados">{(id) => <Input id={id} type="number" min={1} inputMode="numeric" value={f.guests} onChange={(e) => set("guests", e.target.value)} />}</Field>
      <Field label="Tu nombre">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" />}</Field>
      <Field label="Teléfono / WhatsApp">{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" placeholder="8888 8888" />}</Field>
      <Field label="Cuéntanos de tu evento" optional>{(id) => <Textarea id={id} value={f.message} onChange={(e) => set("message", e.target.value)} placeholder="Tipo de evento, ideas, preguntas…" />}</Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" variant="accent" className="w-full" loading={busyBtn}>Enviar consulta</Button>
      <p className="text-center text-[11px] text-muted">Tus datos solo los recibe {business}.</p>
    </form>
  );
}
