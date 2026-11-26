import type { MemberRole, SubscriptionStatus, WorkspaceKind } from "./types";

export interface ModalityMeta {
  kind: WorkspaceKind;
  product: string;
  short: string;
  prefix: string;           // prefijo de ruta
  tagline: string;
  audience: string;
}

export const MODALITIES: Record<WorkspaceKind, ModalityMeta> = {
  personal: {
    kind: "personal",
    product: "Eventos360 Personal",
    short: "Personal",
    prefix: "/p",
    tagline: "Organiza tu propia celebración, sin contratar a nadie.",
    audience: "Quinceaños, bodas, cumpleaños, graduaciones y aniversarios.",
  },
  professional: {
    kind: "professional",
    product: "Eventos360 Profesional",
    short: "Profesional",
    prefix: "/pro",
    tagline: "Tu actividad de organizador: clientes, eventos, cotizaciones y cobros.",
    audience: "Wedding planners, coordinadores y productores independientes.",
  },
  business: {
    kind: "business",
    product: "Eventos360 Business",
    short: "Business",
    prefix: "/b",
    tagline: "Un sistema adaptado a lo que hace tu empresa.",
    audience: "Decoración, alquiler, salones, catering, fotografía, sonido y más.",
  },
};

export const workspacePath = (kind: WorkspaceKind, id: string, sub = "") =>
  `${MODALITIES[kind].prefix}/${id}${sub ? `/${sub}` : ""}`;

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: "Prueba",
  active: "Activa",
  past_due: "Vencida (en gracia)",
  suspended: "Suspendida",
  canceled: "Cancelada",
};

export const STATUS_TONE: Record<SubscriptionStatus, "ok" | "warn" | "danger" | "neutral"> = {
  trialing: "ok",
  active: "ok",
  past_due: "warn",
  suspended: "danger",
  canceled: "neutral",
};

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Coordinador",
  staff: "Personal",
  viewer: "Solo lectura",
  collaborator: "Colaborador",
};
