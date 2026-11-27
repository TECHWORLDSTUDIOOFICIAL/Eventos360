import {
  Armchair, BadgeDollarSign, BarChart3, Boxes, Building2, CalendarDays, CalendarRange, Camera, ChefHat,
  ClipboardCheck, ClipboardList, Contact, FileSignature, FileText, Hammer, Heart, Home, Image, LayoutDashboard,
  ListChecks, Mail, Package, PartyPopper, Receipt, RotateCcw, Sparkles, Truck, UserCog, Users, UtensilsCrossed,
  Wallet, Wrench, type LucideIcon, CalendarCheck, Clock, Tag, Carrot, Store,
} from "lucide-react";

/**
 * Manifiesto de módulos del frontend.
 * La BASE DE DATOS decide qué módulos tiene cada workspace (especialidad + plan);
 * este archivo solo aporta icono, descripción y la etapa en que se implementa.
 * `stage: null` = ya implementado.
 */
export interface ModuleMeta {
  icon: LucideIcon;
  description: string;
  stage: number | null;
}

const m = (icon: LucideIcon, description: string, stage: number | null): ModuleMeta => ({ icon, description, stage });

export const MODULES: Record<string, ModuleMeta> = {
  // Personal
  home: m(Home, "Resumen de tu evento: cuenta regresiva, presupuesto, invitados y tareas.", null),
  my_event: m(PartyPopper, "Datos del evento: categoría, fecha, lugar, presupuesto y fotos de referencia.", null),
  guests: m(Users, "Lista de invitados, grupos familiares, acompañantes y confirmaciones.", null),
  invitations: m(Mail, "Invitaciones digitales con enlace, QR y confirmación de asistencia.", null),
  budget: m(Wallet, "Presupuesto por categorías, gastos, anticipos y pagos pendientes.", 2),
  seating: m(Armchair, "Mesas, capacidad y asignación de invitados.", 2),
  schedule: m(Clock, "Cronograma del día: horarios, actividades y responsables.", 2),
  tasks: m(ListChecks, "Tareas con fecha límite, prioridad y seguimiento.", 2),
  suppliers: m(Store, "Proveedores, cotizaciones, costos y pagos.", 2),
  inspiration: m(Heart, "Referencias visuales, paletas de colores e ideas.", 2),
  // Profesional / Business compartidos
  dashboard: m(LayoutDashboard, "Indicadores de tu actividad.", null),
  customers: m(Contact, "CRM de clientes: contactos, historial y seguimiento.", 3),
  events: m(CalendarRange, "Eventos de tus clientes, presupuestos, avances y documentos.", 3),
  quotes: m(FileText, "Cotizaciones con productos, servicios, descuentos, impuestos y PDF.", 3),
  contracts: m(FileSignature, "Contratos a partir de plantillas, con aceptación registrada.", 3),
  calendar: m(CalendarDays, "Calendario de eventos, reuniones, entregas y pagos, con alertas de conflicto.", 3),
  finance: m(BadgeDollarSign, "Ingresos, anticipos, saldos, gastos y rentabilidad por evento.", 3),
  reports: m(BarChart3, "Reportes de tu operación.", 5),
  team: m(UserCog, "Usuarios de tu empresa y sus permisos.", null),
  // Business especializados
  catalog: m(Tag, "Catálogo de productos y servicios que ofreces.", 5),
  packages: m(Package, "Paquetes compuestos con cálculo de costo y precio de venta.", 5),
  inventory: m(Boxes, "Existencias, unidades disponibles, reservadas, dañadas y en mantenimiento.", null),
  reservations: m(CalendarCheck, "Reservaciones por fecha con control de disponibilidad.", null),
  availability: m(ClipboardCheck, "Calendario de disponibilidad: evita sobreventas y reservas duplicadas.", null),
  deliveries: m(Truck, "Entregas, transporte y control de salida.", null),
  returns: m(RotateCcw, "Devoluciones, revisión y depósitos de garantía.", null),
  maintenance: m(Wrench, "Daños, limpieza y mantenimiento.", null),
  installations: m(Hammer, "Montajes, instalación y desmontaje.", 7),
  venues: m(Building2, "Espacios: capacidad, características, fotos y reglas de uso.", 7),
  venue_rates: m(Receipt, "Tarifas por día, temporada, horario, duración y tipo de evento.", 7),
  menus: m(UtensilsCrossed, "Menús y precios por persona.", 8),
  orders: m(ClipboardList, "Pedidos y producción.", 8),
  ingredients: m(Carrot, "Ingredientes, recetas y costo de preparación.", 8),
  workforce: m(Users, "Personal, disponibilidad y tarifas.", 8),
  shifts: m(Clock, "Asignación de personal a eventos, horarios y asistencia.", 8),
  sessions: m(Camera, "Sesiones y pruebas agendadas.", 8),
  deliverables: m(Image, "Entregables y galerías para clientes.", 8),
  portfolio: m(Sparkles, "Galería de trabajos realizados.", 8),
};

export const SPECIALTY_ICONS: Record<string, LucideIcon> = {
  decoration: Sparkles, rental: Armchair, venue: Building2, catering: ChefHat, photo_video: Camera,
  sound_lighting: BarChart3, florist: Heart, attire: Tag, staffing: Users, full_service: CalendarRange,
};

/** Módulos ya implementados por modalidad (el resto indica su etapa). */
const IMPLEMENTED: Record<string, string[]> = {
  personal: ["home", "my_event", "guests", "invitations", "budget", "suppliers", "seating", "schedule", "tasks", "inspiration"],
  professional: ["dashboard", "customers", "events", "quotes", "contracts", "calendar", "finance", "suppliers", "tasks", "guests", "invitations", "seating", "schedule", "budget"],
  business: ["dashboard", "customers", "events", "quotes", "contracts", "calendar", "finance", "suppliers", "tasks", "guests", "invitations", "seating", "schedule", "budget",
    "inventory", "reservations", "availability", "deliveries", "returns", "maintenance", "team"],
};

export function moduleMeta(key: string, kind?: string): ModuleMeta {
  const base = MODULES[key] ?? m(Package, "", 9);
  if (kind && IMPLEMENTED[kind]?.includes(key)) return { ...base, stage: null };
  if (kind && base.stage === null) return { ...base, stage: 5 };   // existe en otra modalidad, aquí aún no
  return base;
}
