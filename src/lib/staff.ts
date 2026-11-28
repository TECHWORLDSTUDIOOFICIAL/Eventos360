import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export type PayType = "hour" | "shift" | "day";
export type AssignmentStatus = "assigned" | "confirmed" | "declined" | "attended" | "absent";

export interface Worker {
  id: string; workspace_id: string; full_name: string; phone: string | null; id_number: string | null; positions: string[];
  pay_type: PayType; rate: number; currency_code: string; is_active: boolean; emergency_contact: string | null; notes: string | null;
  portal_token: string | null; created_at: string;
}
export interface Unavailability { id: string; worker_id: string; starts_on: string; ends_on: string; reason: string | null }
export interface Shift {
  id: string; workspace_id: string; event_id: string | null; rental_id: string | null; booking_id: string | null; position: string;
  starts_at: string; ends_at: string; needed: number; location: string | null; instructions: string | null; rate: number | null;
  pay_type: PayType | null; notes: string | null; created_at: string;
}
export interface Assignment {
  id: string; shift_id: string; worker_id: string; status: AssignmentStatus; responded_at: string | null; check_in: string | null; check_out: string | null;
  pay_type: PayType; rate: number; extras: number; extras_note: string | null; pay_amount: number; currency_code: string; payout_id: string | null; notes: string | null;
}
export interface Payout { id: string; worker_id: string; paid_on: string; amount: number; currency_code: string; method: string | null; reference: string | null; notes: string | null; created_at: string }
export interface Candidate { worker_id: string; full_name: string; phone: string | null; positions: string[]; pay_type: PayType; rate: number; currency_code: string; matches: boolean; conflict: string | null; assigned: boolean }

/** Puestos frecuentes en eventos (se pueden escribir otros). */
export const POSITIONS = [
  "Mesero", "Bartender", "Capitán de meseros", "Montaje", "Chofer", "Ayudante de carga", "Cocinero", "Ayudante de cocina",
  "Seguridad", "Protocolo / edecán", "Limpieza", "Coordinador", "Técnico de sonido", "Técnico de luces", "DJ", "Fotógrafo", "Videógrafo",
];
export const PAY_TYPES: Record<PayType, { label: string; per: string; hint: string }> = {
  shift: { label: "Por turno", per: "por turno", hint: "Un monto fijo por cada turno, dure lo que dure." },
  hour: { label: "Por hora", per: "por hora", hint: "Se calcula con las horas trabajadas (entrada y salida) o las programadas." },
  day: { label: "Por día", per: "por día", hint: "Un monto por cada día de trabajo." },
};
export const ASSIGNMENT_STATUS: Record<AssignmentStatus, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "danger"; hint: string }> = {
  assigned: { label: "Por confirmar", tone: "warn", hint: "Se le avisó, falta que confirme." },
  confirmed: { label: "Confirmó", tone: "info", hint: "Dijo que sí va." },
  declined: { label: "No puede", tone: "danger", hint: "Rechazó el turno: busca a otra persona." },
  attended: { label: "Asistió", tone: "ok", hint: "Trabajó el turno." },
  absent: { label: "No llegó", tone: "danger", hint: "No se le paga este turno." },
};
export const counts = (s: AssignmentStatus) => s === "assigned" || s === "confirmed" || s === "attended";

export const useWorkers = (wsId: string) =>
  useQuery({ queryKey: ["workers", wsId], queryFn: async () => unwrap<Worker[]>(await supabase.from("workers").select("*").eq("workspace_id", wsId).order("full_name")) });
export const useUnavailability = (wsId: string) =>
  useQuery({ queryKey: ["worker-unavailability", wsId], queryFn: async () => unwrap<Unavailability[]>(await supabase.from("worker_unavailability").select("*").eq("workspace_id", wsId).order("starts_on")) });
export const useShifts = (wsId: string, filter?: { eventId?: string; rentalId?: string; bookingId?: string }) =>
  useQuery({
    queryKey: ["shifts", wsId, filter ?? {}],
    queryFn: async () => {
      let q = supabase.from("shifts").select("*").eq("workspace_id", wsId).order("starts_at");
      if (filter?.eventId) q = q.eq("event_id", filter.eventId);
      if (filter?.rentalId) q = q.eq("rental_id", filter.rentalId);
      if (filter?.bookingId) q = q.eq("booking_id", filter.bookingId);
      return unwrap<Shift[]>(await q);
    },
  });
export const useAssignments = (wsId: string) =>
  useQuery({ queryKey: ["shift-assignments", wsId], queryFn: async () => unwrap<Assignment[]>(await supabase.from("shift_assignments").select("*").eq("workspace_id", wsId)) });
export const usePayouts = (wsId: string, enabled = true) =>
  useQuery({ enabled, queryKey: ["staff-payouts", wsId], queryFn: async () => unwrap<Payout[]>(await supabase.from("staff_payouts").select("*").eq("workspace_id", wsId).order("paid_on", { ascending: false })) });
export const useCandidates = (shiftId: string | undefined) =>
  useQuery({
    enabled: !!shiftId, queryKey: ["shift-candidates", shiftId],
    queryFn: async () => unwrap<Candidate[]>(await supabase.rpc("shift_candidates", { p_shift: shiftId })),
  });

export function useInvalidateStaff() {
  const qc = useQueryClient();
  return () => Promise.all(["workers", "worker-unavailability", "shifts", "shift-assignments", "staff-payouts", "shift-candidates", "getting-started"]
    .map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export const workerPortalUrl = (token: string) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/t/${token}`;

/** Horas entre dos fechas, redondeadas a 2 decimales. */
export const hoursBetween = (a: string, b: string) => Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 36e5) * 100) / 100;
export const hoursText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;

/** Estimación del pago (la base de datos calcula el definitivo con la misma regla). */
export function estimatePay(type: PayType, rate: number, start: string, end: string) {
  if (type === "hour") return Math.round(rate * hoursBetween(start, end) * 100) / 100;
  if (type === "day") return rate * Math.max(1, Math.ceil(hoursBetween(start, end) / 24));
  return rate;
}

/** Mensaje de WhatsApp para avisar a la persona de su turno. */
export function shiftMessage(o: { name: string; business: string; position: string; when: string; place: string | null; event: string | null; instructions: string | null; pay: string | null; link: string | null }) {
  return [
    `Hola ${o.name.split(" ")[0]}, te escribimos de ${o.business}.`,
    `Te tenemos para un turno de *${o.position}*${o.event ? ` en *${o.event}*` : ""}:`,
    `📅 ${o.when}`,
    o.place ? `📍 ${o.place}` : null,
    o.instructions ? `📝 ${o.instructions}` : null,
    o.pay ? `💵 Pago: ${o.pay}` : null,
    o.link ? `\nConfirma aquí si puedes ir:\n${o.link}` : "\n¿Nos confirmas si puedes ir?",
  ].filter(Boolean).join("\n");
}
