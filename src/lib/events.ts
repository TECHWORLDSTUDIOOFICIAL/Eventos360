import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export interface EventRow {
  id: string; workspace_id: string; name: string; category: string; honorees: string | null;
  starts_at: string | null; ends_at: string | null; venue_name: string | null; venue_address: string | null;
  venue_map_url: string | null; budget: number; currency_code: string; description: string | null;
  cover_path: string | null; status: "planning" | "confirmed" | "done" | "canceled"; created_at: string;
}

export interface GuestRow {
  id: string; workspace_id: string; event_id: string; group_id: string | null; table_id: string | null;
  first_name: string; last_name: string | null; phone: string | null; email: string | null;
  max_companions: number; adults: number; children: number;
  status: "pending" | "invited" | "confirmed" | "declined"; notes: string | null;
  invite_token: string; rsvp_message: string | null; responded_at: string | null;
}

export interface GuestGroup { id: string; name: string; event_id: string }
export interface EventTable { id: string; name: string; capacity: number; shape: "round" | "rect"; sort: number; event_id: string }

export interface EventSummary {
  guests_total: number; guests_confirmed: number; guests_declined: number; guests_pending: number;
  people_confirmed: number; adults_confirmed: number; children_confirmed: number; people_invited: number;
  planned_total: number; committed_total: number; paid_total: number;
  tasks_total: number; tasks_done: number; tasks_overdue: number;
  tables_total: number; seats_total: number; seated_people: number;
}

export const EVENT_CATEGORIES: Record<string, string> = {
  boda: "Boda", quinceanos: "Quinceaños", cumpleanos: "Cumpleaños", graduacion: "Graduación", aniversario: "Aniversario",
  bautizo: "Bautizo", baby_shower: "Baby shower", despedida: "Despedida", corporativo: "Corporativo", fiesta: "Fiesta privada", otro: "Otro",
};

export const GUEST_STATUS: Record<GuestRow["status"], { label: string; tone: "neutral" | "info" | "ok" | "danger" }> = {
  pending: { label: "Pendiente", tone: "neutral" },
  invited: { label: "Invitado", tone: "info" },
  confirmed: { label: "Confirmado", tone: "ok" },
  declined: { label: "No asistirá", tone: "danger" },
};

export const guestName = (g: Pick<GuestRow, "first_name" | "last_name">) => [g.first_name, g.last_name].filter(Boolean).join(" ");
/** Lugares que ocupa un invitado (misma regla que la base de datos: private.guest_seats). */
export const guestSeats = (g: Pick<GuestRow, "status" | "adults" | "children" | "max_companions">) =>
  g.status === "declined" ? 0 : g.status === "confirmed" ? Math.max(g.adults, 1) + g.children : g.max_companions + 1;

// ------------------------------------------------------------------ Consultas
export const useEvents = (wsId: string) =>
  useQuery({
    queryKey: ["events", wsId],
    queryFn: async () => unwrap<EventRow[]>(await supabase.from("events").select("*").eq("workspace_id", wsId).order("starts_at", { ascending: true, nullsFirst: false })),
  });

export const useEventSummary = (eventId: string | undefined) =>
  useQuery({
    queryKey: ["event-summary", eventId],
    enabled: !!eventId,
    queryFn: async () => unwrap<EventSummary>(await supabase.rpc("event_summary", { p_event_id: eventId })),
  });

export const useGuests = (eventId: string | undefined) =>
  useQuery({
    queryKey: ["guests", eventId],
    enabled: !!eventId,
    queryFn: async () => unwrap<GuestRow[]>(await supabase.from("guests").select("*").eq("event_id", eventId).order("last_name").order("first_name")),
  });

export const useGuestGroups = (eventId: string | undefined) =>
  useQuery({
    queryKey: ["guest-groups", eventId],
    enabled: !!eventId,
    queryFn: async () => unwrap<GuestGroup[]>(await supabase.from("guest_groups").select("id, name, event_id").eq("event_id", eventId).order("name")),
  });

export const useEventTables = (eventId: string | undefined) =>
  useQuery({
    queryKey: ["event-tables", eventId],
    enabled: !!eventId,
    queryFn: async () => unwrap<EventTable[]>(await supabase.from("event_tables").select("id, name, capacity, shape, sort, event_id").eq("event_id", eventId).order("sort").order("name")),
  });

/** Invalida todo lo que depende de un evento tras una escritura. */
export function useInvalidateEvent() {
  const qc = useQueryClient();
  return useCallback(
    (eventId: string | undefined, ...keys: string[]) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["event-summary", eventId] }),
        ...keys.map((k) => qc.invalidateQueries({ queryKey: [k, eventId] })),
      ]),
    [qc],
  );
}

// ------------------------------------------------------------------ Evento activo (por espacio, en este navegador)
export function useCurrentEvent(wsId: string) {
  const key = `e360:event:${wsId}`;
  const { data: events, isLoading } = useEvents(wsId);
  const [selected, setSelected] = useState<string | null>(() => {
    try { return localStorage.getItem(key); } catch { return null; }
  });
  const list = events ?? [];
  const current = list.find((e) => e.id === selected) ?? list.find((e) => e.status !== "canceled" && e.status !== "done") ?? list[0];
  useEffect(() => {
    if (current && current.id !== selected) setSelected(current.id);
  }, [current, selected]);
  const select = useCallback((id: string) => {
    setSelected(id);
    try { localStorage.setItem(key, id); } catch { /* sin almacenamiento local */ }
  }, [key]);
  return { events: list, event: current, isLoading, select };
}

// ------------------------------------------------------------------ Imágenes
/** Reduce la imagen (lado mayor `max` px) y la convierte a WebP para ahorrar almacenamiento. */
export async function compressImage(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}

export async function uploadImage(bucket: "event-media" | "workspace-files", path: string, file: File, max?: number) {
  const blob = await compressImage(file, max);
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(error.message.includes("exceeded") ? "La imagen es demasiado grande." : "No se pudo subir la imagen.");
  return path;
}

export const publicMediaUrl = (path: string | null | undefined) =>
  path ? supabase.storage.from("event-media").getPublicUrl(path).data.publicUrl : null;

/** Enlace público de la invitación de un invitado. */
export const invitationUrl = (token: string) =>
  `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/i/${token}`;

/** Fecha/hora local (zona del espacio) en formato para <input type="datetime-local">. */
export function toLocalInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Convierte "YYYY-MM-DDTHH:mm" interpretado en la zona del espacio a ISO UTC. */
export function fromLocalInput(value: string, timeZone: string): string | null {
  if (!value) return null;
  const asUtc = new Date(`${value}:00Z`);
  const shown = new Date(new Date(asUtc).toLocaleString("en-US", { timeZone }));
  const utcShown = new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asUtc.getTime() - (shown.getTime() - utcShown.getTime())).toISOString();
}
