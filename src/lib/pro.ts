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
  template: QuoteTemplate; intro: string | null;
}
export interface QuoteItem {
  id: string; quote_id: string; sort: number; description: string; details: string | null; image_path: string | null; resource_id?: string | null;
  quantity: number; unit_price: number; discount_pct: number; line_total: number;
}
export type QuoteTemplate = "clasica" | "catalogo" | "elegante";
export type ContractStyle = "clasica" | "elegante" | "moderna";
export interface Contract {
  id: string; number: number; customer_id: string; event_id: string | null; quote_id: string | null; title: string; body: string;
  amount: number | null; currency_code: string; status: "draft" | "sent" | "accepted" | "canceled"; public_token: string;
  accepted_at: string | null; accepted_name: string | null; accepted_id_doc: string | null; accepted_ip: string | null; accepted_hash: string | null; created_at: string;
  template: ContractStyle; include_provider_signature: boolean; accepted_signature: string | null;
}
export interface Payment {
  id: string; customer_id: string; event_id: string | null; quote_id: string | null; rental_id?: string | null; kind: "deposit" | "installment" | "final" | "other";
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
  accepted: { label: "Firmado", tone: "ok" as const }, canceled: { label: "Cancelado", tone: "danger" as const },
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
  ["monto", "Monto total"], ["anticipo", "Anticipo"], ["articulos", "Artículos y cantidades"], ["fecha_entrega", "Fecha de entrega"],
  ["fecha_devolucion", "Fecha de devolución"], ["deposito", "Depósito de garantía"], ["organizador", "Tu nombre comercial"], ["organizador_identificacion", "Tu RUC / cédula"], ["fecha_hoy", "Fecha de hoy"],
];

export const QUOTE_TEMPLATES: Record<QuoteTemplate, { name: string; description: string }> = {
  clasica: { name: "Clásica", description: "Tabla de servicios clara y formal. Ideal para coordinación, personal o servicios por cantidad." },
  catalogo: { name: "Catálogo con fotos", description: "Cada opción con su foto, descripción y precio. Ideal para ofrecer decoraciones, paquetes o montajes." },
  elegante: { name: "Elegante", description: "Presentación tipo propuesta, con tipografía fina y mucho aire. Ideal para bodas y eventos de alto nivel." },
};

export const CONTRACT_STYLES: Record<ContractStyle, { name: string; description: string }> = {
  clasica: { name: "Clásico", description: "Formato legal tradicional, sobrio." },
  elegante: { name: "Elegante", description: "Tipografía fina con detalles en el color de tu marca." },
  moderna: { name: "Moderno", description: "Encabezado de color y cláusulas bien espaciadas." },
};

export const DEFAULT_QUOTE_INTRO = "Gracias por considerarnos para su evento. A continuación le presentamos nuestra propuesta, preparada especialmente según lo conversado.";
export const DEFAULT_QUOTE_TERMS = `1. Para reservar la fecha se requiere el anticipo indicado en esta cotización.
2. El saldo debe cancelarse a más tardar siete (7) días antes del evento.
3. Los precios incluyen montaje y desmontaje, salvo que se indique lo contrario.
4. Cualquier cambio en cantidades o servicios puede modificar el precio final.
5. Esta cotización es válida hasta la fecha indicada.`;

const BASE_CLOSING = `Leído el presente contrato y enteradas las partes de su contenido, alcance y efectos legales, lo firman en dos tantos de un mismo tenor, en la fecha {{fecha_hoy}}.`;

/** Plantillas de texto de contrato incluidas (todas editables). */
export const CONTRACT_TEMPLATES: { key: string; name: string; description: string; body: string }[] = [
  {
    key: "organizacion",
    name: "Organización y coordinación de eventos",
    description: "Para wedding planners y coordinadores que organizan el evento completo o parte de él.",
    body: `CONTRATO DE PRESTACIÓN DE SERVICIOS DE ORGANIZACIÓN Y COORDINACIÓN DE EVENTO

Entre {{organizador}}, identificado con {{organizador_identificacion}}, en adelante "EL PRESTADOR", y {{cliente}}, identificado con {{cliente_identificacion}}, con domicilio en {{cliente_direccion}}, en adelante "EL CLIENTE", se celebra el presente contrato de prestación de servicios, que se regirá por las siguientes cláusulas:

PRIMERA. OBJETO. EL PRESTADOR se compromete a organizar y coordinar el evento denominado "{{evento}}", que se realizará el {{fecha_evento}} en {{lugar}}, para aproximadamente {{invitados}} invitados, conforme a los servicios detallados en la cotización aceptada por EL CLIENTE, la cual forma parte integral de este contrato.

SEGUNDA. PRECIO. El valor total de los servicios contratados es de {{monto}}.

TERCERA. FORMA DE PAGO. EL CLIENTE pagará un anticipo de {{anticipo}} a la firma de este contrato, con el cual se reserva la fecha. El saldo restante deberá cancelarse a más tardar siete (7) días calendario antes de la fecha del evento. Sin el pago total en ese plazo, EL PRESTADOR no estará obligado a prestar el servicio.

CUARTA. OBLIGACIONES DEL PRESTADOR. a) Prestar los servicios con la calidad y en los tiempos acordados; b) coordinar a los proveedores incluidos en la cotización; c) mantener comunicación oportuna con EL CLIENTE sobre el avance de la organización; d) estar presente o representado el día del evento durante el horario contratado.

QUINTA. OBLIGACIONES DEL CLIENTE. a) Realizar los pagos en las fechas pactadas; b) entregar a tiempo la información necesaria (lista de invitados, preferencias, horarios); c) informar por escrito cualquier cambio con la mayor anticipación posible.

SEXTA. CAMBIOS. Toda modificación en fecha, número de invitados o servicios deberá acordarse por escrito y podrá ajustar el precio total.

SÉPTIMA. CANCELACIÓN. Si EL CLIENTE cancela el evento, el anticipo no será reembolsable por cubrir la reserva de la fecha y los gastos iniciales de organización. Si la cancelación ocurre con menos de treinta (30) días de anticipación, EL CLIENTE deberá cubrir además los costos ya comprometidos con proveedores.

OCTAVA. FUERZA MAYOR. Ninguna de las partes será responsable por el incumplimiento causado por caso fortuito o fuerza mayor debidamente comprobados. En ese caso, las partes acordarán de buena fe una nueva fecha o la forma de liquidar lo pagado.

NOVENA. RESPONSABILIDAD. EL CLIENTE responde por los daños que sus invitados ocasionen a bienes del lugar, del PRESTADOR o de terceros.

DÉCIMA. DOMICILIO Y CONTROVERSIAS. Para cualquier diferencia derivada de este contrato, las partes procurarán primero un arreglo directo y amistoso.

${BASE_CLOSING}`,
  },
  {
    key: "decoracion",
    name: "Decoración y montaje",
    description: "Para servicios de decoración, ambientación, flores y montajes con materiales del prestador.",
    body: `CONTRATO DE SERVICIOS DE DECORACIÓN Y MONTAJE

Entre {{organizador}}, identificado con {{organizador_identificacion}}, en adelante "EL PRESTADOR", y {{cliente}}, identificado con {{cliente_identificacion}}, en adelante "EL CLIENTE", acuerdan el siguiente contrato:

PRIMERA. OBJETO. EL PRESTADOR realizará la decoración y el montaje del evento "{{evento}}", el {{fecha_evento}} en {{lugar}}, según el diseño, los elementos y las cantidades descritos en la cotización aceptada, que forma parte de este contrato.

SEGUNDA. PRECIO Y PAGO. El valor total es de {{monto}}. Para confirmar la reserva, EL CLIENTE pagará un anticipo de {{anticipo}}. El saldo se cancelará a más tardar tres (3) días antes del evento.

TERCERA. MONTAJE Y DESMONTAJE. EL CLIENTE gestionará con el lugar del evento el acceso del personal del PRESTADOR con el tiempo suficiente para el montaje, y la salida para el desmontaje al finalizar. Los horarios se coordinarán por escrito. Si el lugar no permite el acceso en el horario acordado, EL PRESTADOR no será responsable por retrasos en la entrega.

CUARTA. MATERIALES. Los elementos decorativos reutilizables (bases, estructuras, mobiliario decorativo, telas, iluminación, entre otros) son propiedad del PRESTADOR y se entregan en uso únicamente durante el evento. Las flores naturales y los elementos consumibles quedan para EL CLIENTE, salvo que se indique otra cosa.

QUINTA. DAÑOS Y PÉRDIDAS. EL CLIENTE responde por la pérdida o el daño de los elementos del PRESTADOR causados por invitados o terceros durante el evento. Su valor de reposición se cobrará según la lista de precios del PRESTADOR.

SEXTA. CAMBIOS EN EL DISEÑO. Los cambios de diseño, colores o elementos deberán solicitarse a más tardar quince (15) días antes del evento y pueden modificar el precio. La disponibilidad de flores naturales está sujeta a temporada; EL PRESTADOR podrá sustituirlas por otras de similar calidad y color.

SÉPTIMA. CANCELACIÓN. El anticipo no es reembolsable. Si la cancelación ocurre con menos de quince (15) días de anticipación, EL CLIENTE deberá cubrir los materiales ya adquiridos para su evento.

OCTAVA. FOTOGRAFÍAS. EL PRESTADOR podrá fotografiar la decoración realizada y usar las imágenes en su portafolio y redes sociales, sin mostrar datos personales de EL CLIENTE, salvo que este indique por escrito lo contrario.

${BASE_CLOSING}`,
  },
  {
    key: "alquiler",
    name: "Alquiler de mobiliario y equipo",
    description: "Para alquiler de sillas, mesas, mantelería, carpas, vajilla, sonido u otros equipos.",
    body: `CONTRATO DE ALQUILER DE MOBILIARIO Y EQUIPO PARA EVENTOS

Entre {{organizador}}, identificado con {{organizador_identificacion}}, en adelante "EL ARRENDADOR", y {{cliente}}, identificado con {{cliente_identificacion}}, con domicilio en {{cliente_direccion}}, en adelante "EL ARRENDATARIO", se acuerda el siguiente contrato de alquiler:

PRIMERA. OBJETO. EL ARRENDADOR entrega en alquiler a EL ARRENDATARIO el siguiente mobiliario y equipo: {{articulos}}; para ser utilizado en el evento "{{evento}}", el {{fecha_evento}}, en {{lugar}}.

SEGUNDA. PRECIO Y PAGO. El valor del alquiler es de {{monto}}. EL ARRENDATARIO pagará un anticipo de {{anticipo}} para reservar los artículos. El saldo se cancelará al momento de la entrega.

TERCERA. ENTREGA Y DEVOLUCIÓN. Los artículos se entregarán el {{fecha_entrega}} y se recogerán el {{fecha_devolucion}}, salvo otro acuerdo por escrito. EL ARRENDATARIO, o la persona que designe, revisará la cantidad y el estado de los artículos al recibirlos. A la devolución se verificarán nuevamente.

CUARTA. DEPÓSITO DE GARANTÍA. EL ARRENDATARIO entregará un depósito de garantía de {{deposito}}, que será devuelto íntegramente una vez revisados los artículos, descontando, si los hubiera, los daños, faltantes o cargos por limpieza extraordinaria.

QUINTA. CUIDADO DE LOS ARTÍCULOS. EL ARRENDATARIO se obliga a usar los artículos solo para el fin acordado, no subarrendarlos ni trasladarlos a otro lugar, y protegerlos de la lluvia, el fuego y el mal uso.

SEXTA. DAÑOS Y FALTANTES. Los artículos dañados, perdidos o no devueltos se cobrarán a su valor de reposición según la lista de precios del ARRENDADOR.

SÉPTIMA. RETRASOS. Si los artículos no están disponibles para la recolección en el horario acordado, EL ARRENDADOR podrá cobrar un día adicional de alquiler por cada día de retraso.

OCTAVA. CANCELACIÓN. El anticipo no es reembolsable si la cancelación ocurre con menos de siete (7) días de anticipación a la fecha del evento.

${BASE_CLOSING}`,
  },
];

/** Compatibilidad: plantilla predeterminada. */
export const DEFAULT_CONTRACT = CONTRACT_TEMPLATES[0]!.body;
