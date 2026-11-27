import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export interface Customer {
  id: string; workspace_id: string; kind: "person" | "company"; name: string; contact_name: string | null; phone: string | null;
  email: string | null; tax_id: string | null; address: string | null; source: string | null;
  status: "lead" | "active" | "inactive"; notes: string | null; created_at: string;
}
export interface Activity { id: string; customer_id: string; kind: string; body: string; follow_up_on: string | null; done: boolean; created_at: string }
export interface Quote {
  id: string; number: number; customer_id: string; event_id: string | null; title: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired"; issue_date: string; valid_until: string | null; currency_code: string;
  discount_amount: number; tax_rate: number; deposit_pct: number; subtotal: number; tax_amount: number; total: number;
  terms: string | null; notes: string | null; public_token: string; accepted_at: string | null; accepted_name: string | null; created_at: string;
}
export interface QuoteItem { id: string; quote_id: string; sort: number; description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number }
export interface Contract {
  id: string; number: number; customer_id: string; event_id: string | null; quote_id: string | null; title: string; body: string;
  amount: number | null; currency_code: string; status: "draft" | "sent" | "accepted" | "canceled"; public_token: string;
  accepted_at: string | null; accepted_name: string | null; accepted_id_doc: string | null; accepted_ip: string | null; accepted_hash: string | null; created_at: string;
}
export interface Payment {
  id: string; customer_id: string; event_id: string | null; quote_id: string | null; kind: "deposit" | "installment" | "final" | "other";
  amount: number; currency_code: string; method: string; reference: string | null; paid_at: string; notes: string | null;
}
export interface CalendarItem {
  id: string; kind: "meeting" | "delivery" | "payment" | "visit" | "other"; title: string; starts_at: string; ends_at: string | null;
  customer_id: string | null; event_id: string | null; location: string | null; notes: string | null;
}

export const CUSTOMER_STATUS = {
  lead: { label: "Prospecto", tone: "info" as const }, active: { label: "Activo", tone: "ok" as const }, inactive: { label: "Inactivo", tone: "neutral" as const },
};
export const ACTIVITY_KIND: Record<string, string> = { note: "Nota", call: "Llamada", whatsapp: "WhatsApp", meeting: "Reunión", email: "Correo", visit: "Visita" };
export const QUOTE_STATUS = {
  draft: { label: "Borrador", tone: "neutral" as const }, sent: { label: "Enviada", tone: "info" as const },
  accepted: { label: "Aceptada", tone: "ok" as const }, rejected: { label: "Rechazada", tone: "danger" as const }, expired: { label: "Vencida", tone: "warn" as const },
};
export const CONTRACT_STATUS = {
  draft: { label: "Borrador", tone: "neutral" as const }, sent: { label: "Enviado", tone: "info" as const },
  accepted: { label: "Aceptado", tone: "ok" as const }, canceled: { label: "Cancelado", tone: "danger" as const },
};
export const PAYMENT_KIND: Record<Payment["kind"], string> = { deposit: "Anticipo", installment: "Cuota", final: "Pago final", other: "Otro" };
export const CALENDAR_KIND: Record<CalendarItem["kind"], { label: string; color: string }> = {
  meeting: { label: "Reunión", color: "#3d4fc4" }, delivery: { label: "Entrega", color: "#0f7468" }, payment: { label: "Cobro / pago", color: "#b9802a" },
  visit: { label: "Visita al lugar", color: "#c2416b" }, other: { label: "Otro", color: "#6f6680" },
};

export const docNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, "0")}`;

const appBase = () => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
export const quoteUrl = (token: string) => `${appBase()}/q/${token}`;
export const contractUrl = (token: string) => `${appBase()}/k/${token}`;

/** Número local de Nicaragua (8 dígitos) → formato internacional para WhatsApp. */
export const waNumber = (phone: string | null | undefined) => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length === 8 ? `505${d}` : d;
};

export const useCustomers = (wsId: string) =>
  useQuery({
    queryKey: ["customers", wsId],
    queryFn: async () => unwrap<Customer[]>(await supabase.from("customers").select("*").eq("workspace_id", wsId).order("name")),
  });

export const useQuotes = (wsId: string, filter?: { customerId?: string; eventId?: string }) =>
  useQuery({
    queryKey: ["quotes", wsId, filter?.customerId ?? null, filter?.eventId ?? null],
    queryFn: async () => {
      let q = supabase.from("quotes").select("*").eq("workspace_id", wsId);
      if (filter?.customerId) q = q.eq("customer_id", filter.customerId);
      if (filter?.eventId) q = q.eq("event_id", filter.eventId);
      return unwrap<Quote[]>(await q.order("number", { ascending: false }));
    },
  });

export const useContracts = (wsId: string, filter?: { customerId?: string; eventId?: string }) =>
  useQuery({
    queryKey: ["contracts", wsId, filter?.customerId ?? null, filter?.eventId ?? null],
    queryFn: async () => {
      let q = supabase.from("contracts").select("*").eq("workspace_id", wsId);
      if (filter?.customerId) q = q.eq("customer_id", filter.customerId);
      if (filter?.eventId) q = q.eq("event_id", filter.eventId);
      return unwrap<Contract[]>(await q.order("number", { ascending: false }));
    },
  });

export const usePayments = (wsId: string, filter?: { customerId?: string; eventId?: string }) =>
  useQuery({
    queryKey: ["payments", wsId, filter?.customerId ?? null, filter?.eventId ?? null],
    queryFn: async () => {
      let q = supabase.from("customer_payments").select("*").eq("workspace_id", wsId);
      if (filter?.customerId) q = q.eq("customer_id", filter.customerId);
      if (filter?.eventId) q = q.eq("event_id", filter.eventId);
      return unwrap<Payment[]>(await q.order("paid_at", { ascending: false }));
    },
  });

/** Sustituye los marcadores {{...}} de una plantilla de contrato. */
export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => vars[k.toLowerCase()] ?? m);
}

export const TEMPLATE_VARS: [string, string][] = [
  ["cliente", "Nombre del cliente"], ["cliente_identificacion", "Cédula / RUC del cliente"], ["cliente_direccion", "Dirección del cliente"],
  ["evento", "Nombre del evento"], ["fecha_evento", "Fecha del evento"], ["lugar", "Lugar del evento"], ["invitados", "Invitados estimados"],
  ["monto", "Monto total"], ["anticipo", "Anticipo"], ["organizador", "Tu nombre comercial"], ["organizador_identificacion", "Tu RUC / cédula"], ["fecha_hoy", "Fecha de hoy"],
];

export const DEFAULT_CONTRACT = `CONTRATO DE PRESTACIÓN DE SERVICIOS PARA EVENTOS

Entre {{organizador}}, identificado con {{organizador_identificacion}}, en adelante "EL ORGANIZADOR", y {{cliente}}, identificado con {{cliente_identificacion}}, en adelante "EL CLIENTE", se celebra el presente contrato, sujeto a las siguientes cláusulas:

PRIMERA. OBJETO. EL ORGANIZADOR se compromete a prestar los servicios de organización y coordinación del evento "{{evento}}", a realizarse el {{fecha_evento}} en {{lugar}}, para aproximadamente {{invitados}} invitados, conforme a la cotización aceptada por EL CLIENTE.

SEGUNDA. PRECIO Y FORMA DE PAGO. El valor total de los servicios es de {{monto}}. EL CLIENTE pagará un anticipo de {{anticipo}} para reservar la fecha. El saldo deberá cancelarse a más tardar siete (7) días antes del evento.

TERCERA. CAMBIOS. Cualquier cambio en los servicios contratados deberá acordarse por escrito y podrá modificar el precio.

CUARTA. CANCELACIÓN. Si EL CLIENTE cancela el evento, el anticipo no será reembolsable, salvo acuerdo distinto entre las partes.

QUINTA. RESPONSABILIDADES. EL ORGANIZADOR no será responsable por causas de fuerza mayor ajenas a su control. EL CLIENTE responde por daños ocasionados por sus invitados a bienes de terceros.

Ambas partes aceptan el contenido de este contrato en la fecha {{fecha_hoy}}.`;
