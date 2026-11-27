import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export interface Resource {
  id: string; workspace_id: string; name: string; category: string | null; sku: string | null; description: string | null;
  image_path: string | null; unit: string; total_qty: number; rent_price: number; replacement_cost: number | null;
  currency_code: string; is_active: boolean; notes: string | null; created_at: string;
}
export type RentalStatus = "draft" | "reserved" | "out" | "returned" | "canceled";
export interface Rental {
  id: string; workspace_id: string; number: number; customer_id: string; event_id: string | null; quote_id: string | null; title: string;
  status: RentalStatus; starts_at: string; ends_at: string; delivery_mode: "delivery" | "pickup"; delivery_address: string | null;
  delivery_contact: string | null; delivery_phone: string | null; currency_code: string; discount_amount: number; tax_rate: number;
  advance_pct: number; subtotal: number; tax_amount: number; total: number; damage_total: number; deposit_amount: number;
  deposit_received: number; deposit_refunded: number; deposit_retained: number; deposit_notes: string | null; out_at: string | null;
  out_received_by: string | null; returned_at: string | null; return_notes: string | null; notes: string | null; created_at: string;
}
export interface RentalItem {
  id: string; rental_id: string; resource_id: string | null; sort: number; description: string; quantity: number; unit_price: number;
  line_total: number; returned_ok: number | null; damaged_qty: number; lost_qty: number; damage_charge: number; check_notes: string | null;
}
export interface MaintenanceRecord {
  id: string; resource_id: string; rental_id: string | null; kind: "damaged" | "lost" | "cleaning" | "repair"; quantity: number;
  status: "open" | "resolved" | "written_off"; description: string | null; cost: number | null; currency_code: string;
  opened_at: string; resolved_at: string | null; resolution_notes: string | null;
}
export interface Availability { resource_id: string; total: number; out_of_service: number; committed: number; available: number }

export const RENTAL_STATUS: Record<RentalStatus, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "danger"; hint: string }> = {
  draft: { label: "Borrador", tone: "neutral", hint: "Cotizando: todavía no aparta inventario." },
  reserved: { label: "Apartada", tone: "info", hint: "Las unidades quedan bloqueadas para estas fechas." },
  out: { label: "Entregada", tone: "warn", hint: "Los artículos están con el cliente." },
  returned: { label: "Devuelta", tone: "ok", hint: "Revisada y cerrada." },
  canceled: { label: "Cancelada", tone: "danger", hint: "No aparta inventario." },
};
export const MAINT_KIND: Record<MaintenanceRecord["kind"], string> = { damaged: "Dañado", lost: "Perdido / faltante", cleaning: "Limpieza", repair: "Reparación" };
export const MAINT_STATUS: Record<MaintenanceRecord["status"], { label: string; tone: "warn" | "ok" | "danger" }> = {
  open: { label: "Fuera de servicio", tone: "warn" }, resolved: { label: "De vuelta en inventario", tone: "ok" }, written_off: { label: "Dado de baja", tone: "danger" },
};
export const UNITS = ["unidad", "juego", "metro", "par", "paquete", "servicio"];

export const isOverdue = (r: Pick<Rental, "status" | "ends_at">) => r.status === "out" && new Date(r.ends_at).getTime() < Date.now();
export const depositHeld = (r: Pick<Rental, "deposit_received" | "deposit_refunded" | "deposit_retained">) =>
  Number(r.deposit_received) - Number(r.deposit_refunded) - Number(r.deposit_retained);

export const useResources = (wsId: string, opts?: { includeInactive?: boolean }) =>
  useQuery({
    queryKey: ["resources", wsId, !!opts?.includeInactive],
    queryFn: async () => {
      let q = supabase.from("resources").select("*").eq("workspace_id", wsId);
      if (!opts?.includeInactive) q = q.eq("is_active", true);
      return unwrap<Resource[]>(await q.order("category", { nullsFirst: false }).order("name"));
    },
  });

export const useRentals = (wsId: string, filter?: { customerId?: string; statuses?: RentalStatus[] }) =>
  useQuery({
    queryKey: ["rentals", wsId, filter?.customerId ?? null, filter?.statuses?.join(",") ?? null],
    queryFn: async () => {
      let q = supabase.from("rentals").select("*").eq("workspace_id", wsId);
      if (filter?.customerId) q = q.eq("customer_id", filter.customerId);
      if (filter?.statuses) q = q.in("status", filter.statuses);
      return unwrap<Rental[]>(await q.order("starts_at", { ascending: true }));
    },
  });

export const useRentalItems = (rentalId: string | undefined) =>
  useQuery({
    queryKey: ["rental-items", rentalId],
    enabled: !!rentalId,
    queryFn: async () => unwrap<RentalItem[]>(await supabase.from("rental_items").select("*").eq("rental_id", rentalId!).order("sort").order("id")),
  });

export const useMaintenance = (wsId: string) =>
  useQuery({
    queryKey: ["maintenance", wsId],
    queryFn: async () => unwrap<MaintenanceRecord[]>(await supabase.from("maintenance_records").select("*").eq("workspace_id", wsId).order("opened_at", { ascending: false })),
  });

/** Disponibilidad de todo el inventario en un rango (excluye opcionalmente una reservación). */
export const useAvailability = (wsId: string, from: string | null, to: string | null, exclude?: string) =>
  useQuery({
    queryKey: ["availability", wsId, from, to, exclude ?? null],
    enabled: !!from && !!to && new Date(to) > new Date(from),
    queryFn: async () => unwrap<Availability[]>(await supabase.rpc("rental_availability", { p_ws: wsId, p_from: from, p_to: to, p_exclude: exclude ?? null })),
  });

/** Invalida todo lo que depende del inventario y las reservaciones. */
export const RENTAL_KEYS = ["rentals", "rental", "rental-items", "resources", "availability", "availability-days", "maintenance", "rental-dashboard", "rental-shortages"];

export function useInvalidateRental() {
  const qc = useQueryClient();
  return () => Promise.all(RENTAL_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
