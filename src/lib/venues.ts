import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export type SetupKey = "banquet" | "theater" | "cocktail" | "classroom" | "u" | "other";
export interface Venue {
  id: string; workspace_id: string; name: string; kind: string; description: string | null; indoor: boolean; area_m2: number | null;
  cap_banquet: number | null; cap_theater: number | null; cap_cocktail: number | null; cap_classroom: number | null; cap_u: number | null;
  amenities: string[]; includes: string | null; rules: string | null; setup_minutes: number; teardown_minutes: number;
  photos: string[]; color: string; sort: number; is_active: boolean;
}
export interface VenuePart { venue_id: string; part_id: string }
export interface VenueRate {
  id: string; venue_id: string; name: string; weekdays: number[]; season_from: string | null; season_to: string | null; base_hours: number;
  base_price: number; extra_hour_price: number; deposit_amount: number; currency_code: string; is_active: boolean; sort: number;
}
export type BookingStatus = "inquiry" | "hold" | "confirmed" | "done" | "canceled";
export interface Booking {
  id: string; workspace_id: string; number: number; kind: "event" | "block"; status: BookingStatus; venue_id: string; customer_id: string | null;
  event_id: string | null; title: string; setup: SetupKey; guests: number | null; starts_at: string; ends_at: string; setup_minutes: number;
  teardown_minutes: number; hold_until: string | null; hold_expired_at: string | null; rate_id: string | null; source: string | null;
  currency_code: string; discount_amount: number; tax_rate: number; advance_pct: number; subtotal: number; tax_amount: number; total: number;
  deposit_amount: number; deposit_received: number; deposit_refunded: number; deposit_retained: number; deposit_notes: string | null;
  client_message: string | null; ops_notes: string | null; notes: string | null; confirmed_at: string | null; created_at: string;
}
export interface BookingItem { id: string; booking_id: string; sort: number; description: string; quantity: number; unit_price: number; line_total: number }
export interface Conflict { id: string; number: number; title: string; status: BookingStatus; kind: string; venue_name: string; starts_at: string; ends_at: string; hold_until: string | null }
export interface PriceSuggestion {
  rate_id: string; rate_name: string; hours: number; base_hours: number; base_price: number; extra_hours: number; extra_hour_price: number;
  deposit_amount: number; currency_code: string; total: number;
}

/** Tipos de montaje y la columna de capacidad que usa cada uno. */
export const SETUPS: Record<SetupKey, { label: string; hint: string; cap: keyof Venue | null }> = {
  banquet: { label: "Banquete", hint: "Mesas redondas", cap: "cap_banquet" },
  theater: { label: "Auditorio", hint: "Sillas en filas", cap: "cap_theater" },
  cocktail: { label: "Cóctel", hint: "De pie, mesas altas", cap: "cap_cocktail" },
  classroom: { label: "Escuela", hint: "Mesas y sillas en filas", cap: "cap_classroom" },
  u: { label: "Imperial / en U", hint: "Mesa larga o en forma de U", cap: "cap_u" },
  other: { label: "Otro", hint: "", cap: null },
};
export const VENUE_KINDS: Record<string, string> = {
  salon: "Salón", jardin: "Jardín", terraza: "Terraza", rancho: "Rancho", auditorio: "Auditorio", finca: "Finca / quinta", piscina: "Área de piscina", otro: "Otro",
};
export const AMENITIES = [
  "Aire acondicionado", "Planta eléctrica", "Parqueo", "Seguridad", "Baños", "Camerino / cuarto de novia", "Cocina de apoyo", "Escenario",
  "Pista de baile", "Sonido básico", "Proyector y pantalla", "Wi-Fi", "Mesas y sillas incluidas", "Mantelería incluida", "Acceso para silla de ruedas",
  "Área techada", "Iluminación decorativa", "Zona de fotos",
];
export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "danger"; hint: string }> = {
  inquiry: { label: "Consulta", tone: "neutral", hint: "Aún no aparta la fecha. Útil como lista de espera." },
  hold: { label: "Apartado provisional", tone: "warn", hint: "La fecha queda apartada hasta la fecha de vencimiento; si no se confirma, se libera sola." },
  confirmed: { label: "Confirmada", tone: "ok", hint: "La fecha está reservada." },
  done: { label: "Realizada", tone: "info", hint: "El evento ya se realizó." },
  canceled: { label: "Cancelada", tone: "danger", hint: "No aparta la fecha." },
};
export const SOURCES: Record<string, string> = {
  telefono: "Llamada", whatsapp: "WhatsApp", visita: "Visita al local", web: "Página de consultas", redes: "Redes sociales", referido: "Recomendación", otro: "Otro",
};
export const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"];
export const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const capacityFor = (v: Venue | undefined, setup: SetupKey) => (v && SETUPS[setup].cap ? (v[SETUPS[setup].cap!] as number | null) : null);
export const maxCapacity = (v: Venue) => Math.max(0, ...[v.cap_banquet, v.cap_theater, v.cap_cocktail, v.cap_classroom, v.cap_u].map((x) => x ?? 0));
export const docBooking = (n: number) => `RSV-${String(n).padStart(4, "0")}`;
const appBase = () => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
export const venuePublicUrl = (token: string) => `${appBase()}/r/${token}`;

export const useVenues = (wsId: string, opts?: { includeInactive?: boolean }) =>
  useQuery({
    queryKey: ["venues", wsId, !!opts?.includeInactive],
    queryFn: async () => {
      let q = supabase.from("venues").select("*").eq("workspace_id", wsId);
      if (!opts?.includeInactive) q = q.eq("is_active", true);
      return unwrap<Venue[]>(await q.order("sort").order("name"));
    },
  });
export const useVenueParts = (wsId: string) =>
  useQuery({ queryKey: ["venue-parts", wsId], queryFn: async () => unwrap<VenuePart[]>(await supabase.from("venue_parts").select("venue_id, part_id").eq("workspace_id", wsId)) });
export const useVenueRates = (wsId: string) =>
  useQuery({ queryKey: ["venue-rates", wsId], queryFn: async () => unwrap<VenueRate[]>(await supabase.from("venue_rates").select("*").eq("workspace_id", wsId).order("sort").order("name")) });
export const useBookings = (wsId: string) =>
  useQuery({ queryKey: ["bookings", wsId], queryFn: async () => unwrap<Booking[]>(await supabase.from("bookings").select("*").eq("workspace_id", wsId).order("starts_at")) });
export const useBookingItems = (id: string | undefined) =>
  useQuery({ queryKey: ["booking-items", id], enabled: !!id, queryFn: async () => unwrap<BookingItem[]>(await supabase.from("booking_items").select("*").eq("booking_id", id!).order("sort").order("id")) });

/** Reservas que chocan con un espacio y horario (montaje/desmontaje incluidos por el servidor en las demás). */
export const useConflicts = (wsId: string, venueId: string, from: string | null, to: string | null, exclude?: string) =>
  useQuery({
    queryKey: ["venue-check", wsId, venueId, from, to, exclude ?? null],
    enabled: !!venueId && !!from && !!to && new Date(to) > new Date(from),
    queryFn: async () => unwrap<Conflict[]>(await supabase.rpc("venue_check", { p_ws: wsId, p_venue: venueId, p_from: from, p_to: to, p_exclude: exclude ?? null })),
  });
export const usePriceSuggestion = (wsId: string, venueId: string, from: string | null, to: string | null) =>
  useQuery({
    queryKey: ["venue-price", wsId, venueId, from, to],
    enabled: !!venueId && !!from && !!to && new Date(to) > new Date(from),
    queryFn: async () => unwrap<PriceSuggestion | null>(await supabase.rpc("venue_price", { p_ws: wsId, p_venue: venueId, p_from: from, p_to: to })),
  });

export function useInvalidateVenues() {
  const qc = useQueryClient();
  return () => Promise.all(["venues", "venue-parts", "venue-rates", "bookings", "booking", "booking-items", "venue-check", "venue-price", "venue-month", "venue-dashboard", "getting-started"]
    .map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** Texto de horario: "sáb 20 mar 2027, 6:00 p. m. – 11:00 p. m.". */
export function scheduleText(starts: string, ends: string, tz: string, locale: string) {
  const d = (x: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: tz, ...o }).format(new Date(x));
  const sameDay = d(starts, { year: "numeric", month: "2-digit", day: "2-digit" }) === d(ends, { year: "numeric", month: "2-digit", day: "2-digit" });
  const start = d(starts, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const end = sameDay ? d(ends, { hour: "numeric", minute: "2-digit" }) : d(ends, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return `${start} – ${end}`;
}
export const minutesText = (m: number) => (m % 60 === 0 ? `${m / 60} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
