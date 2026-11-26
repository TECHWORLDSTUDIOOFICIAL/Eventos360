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
/** `print`: versión para papel (media carta), sin sombras y más compacta. */
export function InvitationCard({ v, children, print }: { v: InvitationView; children?: ReactNode; print?: boolean }) {
  const t = TEMPLATES[v.template];
  const e = v.event;
  const rawDate = fmt(e.starts_at, e.timezone, e.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const date = rawDate ? rawDate.charAt(0).toUpperCase() + rawDate.slice(1) : null;
  const time = fmt(e.starts_at, e.timezone, e.locale, { hour: "numeric", minute: "2-digit" });
  const deadline = v.rsvp_deadline ? new Intl.DateTimeFormat(e.locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${v.rsvp_deadline}T00:00:00Z`)) : null;

  return (
    <article className={print ? "flex min-h-[8.4in] flex-col overflow-hidden" : "overflow-hidden rounded-[28px] shadow-[0_30px_80px_-30px_rgb(29_21_48/0.45)]"} style={{ background: t.bg, color: t.ink }}>
      {e.cover_url ? (
        <div className={cx("relative", print ? "h-[1.9in]" : "aspect-[4/3] sm:aspect-[16/9]")}>
          <img src={e.cover_url} alt="" className="size-full object-cover" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 55%, ${t.bg})` }} />
        </div>
      ) : (
        <div className="h-3" style={{ background: v.accent_color }} />
      )}
      <div className={cx("text-center", print ? "flex flex-1 flex-col px-8 pb-6 pt-3" : "px-6 pb-8 pt-6 sm:px-10")}>
        {v.guestName && <p className="text-sm" style={{ color: t.soft }}>Querido(a) <strong style={{ color: t.ink }}>{v.guestName}</strong></p>}
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: v.accent_color }}>{v.title || "Estás invitado"}</p>
        <h1 className={cx("mt-3 font-semibold leading-[1.08]", print ? "text-[2rem]" : "text-[2.1rem] sm:text-5xl", t.font)}>{e.honorees || e.name}</h1>
        {e.honorees && <p className="mt-2 text-sm" style={{ color: t.soft }}>{e.name}</p>}
        <div className={cx("text-lg", print ? "my-3" : "my-6")} style={{ color: v.accent_color }} aria-hidden>{t.ornament} {t.ornament} {t.ornament}</div>
        {v.message && <p className={cx("mx-auto max-w-md whitespace-pre-line leading-relaxed", print ? "line-clamp-5 text-[13px]" : "text-[15px]")} style={{ color: t.soft }}>{v.message}</p>}

        <div className={cx("mx-auto grid max-w-md text-left", print ? "mt-3 w-full gap-1.5 text-[13px]" : "mt-7 gap-3")}>
          {date && <Row compact={print} icon={<CalendarDays className="size-4" />} color={v.accent_color}><span>{date}</span></Row>}
          {time && <Row compact={print} icon={<Clock className="size-4" />} color={v.accent_color}>{time}</Row>}
          {(e.venue_name || e.venue_address) && (
            <Row compact={print} icon={<MapPin className="size-4" />} color={v.accent_color}>
              <span className="font-semibold">{e.venue_name}</span>
              {e.venue_address && <span className="block text-sm" style={{ color: t.soft }}>{e.venue_address}</span>}
            </Row>
          )}
          {v.dress_code && <Row compact={print} icon={<Shirt className="size-4" />} color={v.accent_color}>Vestimenta: {v.dress_code}</Row>}
        </div>
        {e.venue_map_url && !print && (
          <a href={e.venue_map_url} target="_blank" rel="noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: v.accent_color, color: v.accent_color }}>
            <Navigation className="size-4" /> Cómo llegar
          </a>
        )}
        {children && <div className={cx("mx-auto w-full max-w-md border-t text-left", print ? "mt-auto pt-4" : "mt-8 pt-7")} style={{ borderColor: `${v.accent_color}40` }}>{children}</div>}
        {deadline && <p className={cx("text-xs", print ? "mt-3" : "mt-6")} style={{ color: t.soft }}>Por favor confirma tu asistencia antes del {deadline}.</p>}
      </div>
    </article>
  );
}

function Row({ icon, color, children, compact }: { icon: ReactNode; color: string; children: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex items-start gap-3 rounded-2xl px-4", compact ? "py-1.5" : "py-3")} style={{ background: `${color}14` }}>
      <span className="mt-0.5" style={{ color }}>{icon}</span>
      <div className={cx("min-w-0", compact ? "text-[13px]" : "text-[15px]")}>{children}</div>
    </div>
  );
}
