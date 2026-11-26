import type { ReactNode } from "react";
import { CalendarDays, Clock, MapPin, Navigation, Shirt } from "lucide-react";
import { cx } from "./ui";

export interface InvitationView {
  template: "elegante" | "floral" | "moderno" | "fiesta";
  accent_color: string;
  title: string | null;
  message: string | null;
  dress_code: string | null;
  rsvp_deadline: string | null;
  event: {
    name: string; honorees: string | null; starts_at: string | null; venue_name: string | null;
    venue_address: string | null; venue_map_url: string | null; cover_url: string | null; timezone: string; locale: string;
  };
  guestName?: string;
}

const TEMPLATES = {
  elegante: { bg: "#fbf8f2", ink: "#2a2233", soft: "#6d6476", font: "font-display", ornament: "✦" },
  floral: { bg: "#fdf6f4", ink: "#3b2a2c", soft: "#7d6468", font: "font-display", ornament: "❀" },
  moderno: { bg: "#ffffff", ink: "#111827", soft: "#6b7280", font: "font-sans", ornament: "—" },
  fiesta: { bg: "#1d1530", ink: "#fbf7ef", soft: "#cbbfdc", font: "font-display", ornament: "✸" },
} as const;

export const TEMPLATE_LABELS: Record<InvitationView["template"], string> = {
  elegante: "Elegante", floral: "Floral", moderno: "Moderno", fiesta: "Noche de fiesta",
};

function fmt(iso: string | null, tz: string, locale: string, o: Intl.DateTimeFormatOptions) {
  if (!iso) return null;
  try { return new Intl.DateTimeFormat(locale, { timeZone: tz, ...o }).format(new Date(iso)); } catch { return null; }
}

/** Tarjeta de invitación (vista previa en el panel y página pública). */
export function InvitationCard({ v, children }: { v: InvitationView; children?: ReactNode }) {
  const t = TEMPLATES[v.template];
  const e = v.event;
  const rawDate = fmt(e.starts_at, e.timezone, e.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const date = rawDate ? rawDate.charAt(0).toUpperCase() + rawDate.slice(1) : null;
  const time = fmt(e.starts_at, e.timezone, e.locale, { hour: "numeric", minute: "2-digit" });
  const deadline = v.rsvp_deadline ? new Intl.DateTimeFormat(e.locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${v.rsvp_deadline}T00:00:00Z`)) : null;

  return (
    <article className="overflow-hidden rounded-[28px] shadow-[0_30px_80px_-30px_rgb(29_21_48/0.45)]" style={{ background: t.bg, color: t.ink }}>
      {e.cover_url ? (
        <div className="relative aspect-[4/3] sm:aspect-[16/9]">
          <img src={e.cover_url} alt="" className="size-full object-cover" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 55%, ${t.bg})` }} />
        </div>
      ) : (
        <div className="h-3" style={{ background: v.accent_color }} />
      )}
      <div className="px-6 pb-8 pt-6 text-center sm:px-10">
        {v.guestName && <p className="text-sm" style={{ color: t.soft }}>Querido(a) <strong style={{ color: t.ink }}>{v.guestName}</strong></p>}
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: v.accent_color }}>{v.title || "Estás invitado"}</p>
        <h1 className={cx("mt-3 text-[2.1rem] font-semibold leading-[1.08] sm:text-5xl", t.font)}>{e.honorees || e.name}</h1>
        {e.honorees && <p className="mt-2 text-sm" style={{ color: t.soft }}>{e.name}</p>}
        <div className="my-6 text-lg" style={{ color: v.accent_color }} aria-hidden>{t.ornament} {t.ornament} {t.ornament}</div>
        {v.message && <p className="mx-auto max-w-md whitespace-pre-line text-[15px] leading-relaxed" style={{ color: t.soft }}>{v.message}</p>}

        <div className="mx-auto mt-7 grid max-w-md gap-3 text-left">
          {date && <Row icon={<CalendarDays className="size-4" />} color={v.accent_color}><span>{date}</span></Row>}
          {time && <Row icon={<Clock className="size-4" />} color={v.accent_color}>{time}</Row>}
          {(e.venue_name || e.venue_address) && (
            <Row icon={<MapPin className="size-4" />} color={v.accent_color}>
              <span className="font-semibold">{e.venue_name}</span>
              {e.venue_address && <span className="block text-sm" style={{ color: t.soft }}>{e.venue_address}</span>}
            </Row>
          )}
          {v.dress_code && <Row icon={<Shirt className="size-4" />} color={v.accent_color}>Vestimenta: {v.dress_code}</Row>}
        </div>
        {e.venue_map_url && (
          <a href={e.venue_map_url} target="_blank" rel="noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: v.accent_color, color: v.accent_color }}>
            <Navigation className="size-4" /> Cómo llegar
          </a>
        )}
        {children && <div className="mx-auto mt-8 max-w-md border-t pt-7 text-left" style={{ borderColor: `${v.accent_color}40` }}>{children}</div>}
        {deadline && <p className="mt-6 text-xs" style={{ color: t.soft }}>Por favor confirma tu asistencia antes del {deadline}.</p>}
      </div>
    </article>
  );
}

function Row({ icon, color, children }: { icon: ReactNode; color: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl px-4 py-3" style={{ background: `${color}14` }}>
      <span className="mt-0.5" style={{ color }}>{icon}</span>
      <div className="min-w-0 text-[15px]">{children}</div>
    </div>
  );
}
