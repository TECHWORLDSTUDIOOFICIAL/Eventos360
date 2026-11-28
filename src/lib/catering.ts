import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export type Dim = "mass" | "volume" | "count";
/** Unidades estándar: se convierten solas dentro del mismo tipo (la base de datos usa los mismos factores). */
export const UNITS: Record<string, { label: string; short: string; dim: Dim; factor: number }> = {
  lb: { label: "Libra", short: "lb", dim: "mass", factor: 453.592 },
  kg: { label: "Kilogramo", short: "kg", dim: "mass", factor: 1000 },
  g: { label: "Gramo", short: "g", dim: "mass", factor: 1 },
  oz: { label: "Onza", short: "oz", dim: "mass", factor: 28.3495 },
  quintal: { label: "Quintal (100 lb)", short: "qq", dim: "mass", factor: 45359.2 },
  l: { label: "Litro", short: "l", dim: "volume", factor: 1000 },
  ml: { label: "Mililitro", short: "ml", dim: "volume", factor: 1 },
  gal: { label: "Galón", short: "gal", dim: "volume", factor: 3785.41 },
  botella: { label: "Botella (750 ml)", short: "bot.", dim: "volume", factor: 750 },
  taza: { label: "Taza", short: "taza", dim: "volume", factor: 240 },
  cda: { label: "Cucharada", short: "cda", dim: "volume", factor: 15 },
  cdta: { label: "Cucharadita", short: "cdta", dim: "volume", factor: 5 },
  oz_fl: { label: "Onza líquida", short: "oz fl", dim: "volume", factor: 29.5735 },
  unidad: { label: "Unidad", short: "u.", dim: "count", factor: 1 },
  docena: { label: "Docena", short: "doc.", dim: "count", factor: 12 },
  cajilla: { label: "Cajilla (30)", short: "cajilla", dim: "count", factor: 30 },
  ciento: { label: "Ciento", short: "ciento", dim: "count", factor: 100 },
};
export const DIM_LABEL: Record<Dim, string> = { mass: "Peso", volume: "Volumen", count: "Unidades" };
export const unitsOf = (dim: Dim) => Object.entries(UNITS).filter(([, u]) => u.dim === dim);
export const COURSES: Record<string, string> = {
  bocadillo: "Bocadillos", entrada: "Entrada", sopa: "Sopa / crema", fuerte: "Plato fuerte", acompanamiento: "Acompañamiento", postre: "Postre", bebida: "Bebida", otro: "Otro",
};
export const ORDER_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "danger"; hint: string }> = {
  draft: { label: "Borrador", tone: "neutral", hint: "Todavía no se compra ni se produce." },
  confirmed: { label: "Confirmado", tone: "info", hint: "Entra a la lista de compras." },
  production: { label: "En producción", tone: "warn", hint: "La cocina ya está preparando." },
  delivered: { label: "Entregado", tone: "ok", hint: "Servido; registra las compras reales." },
  canceled: { label: "Cancelado", tone: "danger", hint: "No cuenta para compras ni ventas." },
};
export const TASTING_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "danger" }> = {
  scheduled: { label: "Agendada", tone: "info" }, done: { label: "Realizada", tone: "ok" }, canceled: { label: "Cancelada", tone: "neutral" }, no_show: { label: "No llegó", tone: "danger" },
};

export interface Ingredient {
  id: string; name: string; category: string | null; purchase_unit: string; pack_name: string | null; pack_size: number | null; pack_unit: string | null;
  price: number; currency_code: string; yield_pct: number; supplier_id: string | null; is_active: boolean; notes: string | null; dim: Dim; base_qty: number; cost_base: number;
}
export interface Recipe {
  id: string; name: string; course: string; portions: number; currency_code: string; description: string | null; instructions: string | null;
  image_path: string | null; is_active: boolean; cost_total: number; cost_portion: number;
}
export interface RecipeItem { id: string; recipe_id: string; ingredient_id: string; quantity: number; unit: string; note: string | null; sort: number; cost: number }
export interface Menu {
  id: string; name: string; description: string | null; image_path: string | null; currency_code: string; price_per_person: number; kids_price: number | null;
  min_guests: number; is_active: boolean; cost_per_person: number;
}
export interface MenuItem { id: string; menu_id: string; recipe_id: string; portions: number; option_group: string | null; sort: number }
export interface PriceTier { id: string; menu_id: string; min_guests: number; price_per_person: number }
export interface CateringOrder {
  id: string; number: number; customer_id: string; event_id: string | null; quote_id: string | null; title: string; status: string; service_at: string;
  location: string | null; menu_id: string | null; adults: number; kids: number; cutoff_days: number | null; currency_code: string; price_per_person: number;
  kids_price: number; other_charges: number; discount_amount: number; tax_rate: number; subtotal: number; tax_amount: number; total: number;
  cost_estimated: number; cost_actual: number; kitchen_notes: string | null; notes: string | null; created_at: string;
}
export interface OrderChoice { id: string; order_id: string; menu_item_id: string; plates: number }
export interface Restriction { id: string; order_id: string; label: string; people: number; notes: string | null }
export interface Purchase { id: string; order_id: string; purchased_on: string; description: string; amount: number; supplier_id: string | null }
export interface Tasting {
  id: string; customer_id: string; quote_id: string | null; menu_id: string | null; scheduled_at: string; people: number; dishes: string | null; price: number;
  currency_code: string; credit_on_hire: boolean; status: string; result: string | null; notes: string | null;
}
export interface CateringSettings { workspace_id: string; cutoff_days: number; guests_per_waiter: number; kids_portion: number; food_cost_target: number }
export interface SheetDish { recipe_id: string; name: string; course: string; option_group: string | null; portions: number; instructions: string | null; ingredients: { name: string; quantity: number; unit: string; note: string | null }[] }
export interface ShoppingRow {
  ingredient_id: string; name: string; category: string | null; purchase_unit: string; pack_name: string | null; pack_size: number | null; pack_unit: string | null;
  dim: Dim; base_needed: number; purchase_qty: number; est_cost: number; currency_code: string; supplier_id: string | null; orders: number;
}

const list = <T,>(table: string, wsId: string, order: string) => async () => unwrap<T[]>(await supabase.from(table).select("*").eq("workspace_id", wsId).order(order));
export const useIngredients = (wsId: string) => useQuery({ queryKey: ["ingredients", wsId], queryFn: list<Ingredient>("ingredients", wsId, "name") });
export const useRecipes = (wsId: string, enabled = true) => useQuery({ enabled, queryKey: ["recipes", wsId], queryFn: list<Recipe>("recipes", wsId, "name") });
export const useRecipeItems = (wsId: string) => useQuery({ queryKey: ["recipe-items", wsId], queryFn: list<RecipeItem>("recipe_items", wsId, "sort") });
export const useMenus = (wsId: string, enabled = true) => useQuery({ enabled, queryKey: ["menus", wsId], queryFn: list<Menu>("menus", wsId, "name") });
export const useMenuItems = (wsId: string, enabled = true) => useQuery({ enabled, queryKey: ["menu-items", wsId], queryFn: list<MenuItem>("menu_items", wsId, "sort") });
export const usePriceTiers = (wsId: string, enabled = true) => useQuery({ enabled, queryKey: ["menu-tiers", wsId], queryFn: list<PriceTier>("menu_price_tiers", wsId, "min_guests") });
export const useCateringOrders = (wsId: string, enabled = true) => useQuery({ enabled, queryKey: ["catering-orders", wsId], queryFn: list<CateringOrder>("catering_orders", wsId, "service_at") });
export const useTastings = (wsId: string, enabled = true) => useQuery({ enabled, queryKey: ["tastings", wsId], queryFn: list<Tasting>("tastings", wsId, "scheduled_at") });
export const useOrderParts = (orderId: string) => useQuery({
  queryKey: ["catering-order-parts", orderId],
  queryFn: async () => {
    const [c, r, p] = await Promise.all([
      supabase.from("catering_order_choices").select("*").eq("order_id", orderId),
      supabase.from("catering_order_restrictions").select("*").eq("order_id", orderId),
      supabase.from("catering_purchases").select("*").eq("order_id", orderId).order("purchased_on"),
    ]);
    return { choices: unwrap<OrderChoice[]>(c), restrictions: unwrap<Restriction[]>(r), purchases: unwrap<Purchase[]>(p) };
  },
});
export const useSheet = (orderId: string) => useQuery({
  queryKey: ["catering-sheet", orderId],
  queryFn: async () => unwrap<{ dishes: SheetDish[] }>(await supabase.rpc("catering_sheet", { p_order: orderId })),
});
export const useShopping = (wsId: string, from: string, to: string) => useQuery({
  enabled: !!from && !!to && from <= to, queryKey: ["catering-shopping", wsId, from, to],
  queryFn: async () => unwrap<ShoppingRow[]>(await supabase.rpc("catering_shopping", { p_ws: wsId, p_from: from, p_to: to })),
});
export const useCateringSettings = (wsId: string) => useQuery({
  queryKey: ["catering-settings", wsId],
  queryFn: async () => {
    const { data } = await supabase.from("catering_settings").select("*").eq("workspace_id", wsId).maybeSingle();
    return (data as CateringSettings | null) ?? { workspace_id: wsId, cutoff_days: 7, guests_per_waiter: 12, kids_portion: 0.5, food_cost_target: 33 };
  },
});

export function useInvalidateCatering() {
  const qc = useQueryClient();
  return () => Promise.all(["ingredients", "recipes", "recipe-items", "menus", "menu-items", "menu-tiers", "catering-orders", "catering-order-parts", "catering-sheet", "catering-shopping", "tastings", "catering-settings"]
    .map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** "lb", "saco de 50 lb" … */
export const purchaseLabel = (i: Pick<Ingredient, "purchase_unit" | "pack_name" | "pack_size" | "pack_unit">) =>
  i.purchase_unit === "paquete" ? `${i.pack_name} de ${Number(i.pack_size)} ${UNITS[i.pack_unit ?? ""]?.short ?? ""}` : UNITS[i.purchase_unit]?.short ?? i.purchase_unit;
/** Precio del menú según invitados (precios por volumen). */
export function priceFor(menu: Menu, tiers: PriceTier[], guests: number) {
  const t = tiers.filter((x) => x.menu_id === menu.id && x.min_guests <= guests).sort((a, b) => b.min_guests - a.min_guests)[0];
  return Number(t?.price_per_person ?? menu.price_per_person);
}
/** % de costo de comida y su tono contra la meta del negocio. */
export function foodCost(cost: number, price: number, target: number) {
  const pct = price > 0 ? Math.round((cost / price) * 1000) / 10 : null;
  const tone = pct === null ? "text-muted" : pct <= target ? "text-ok" : pct <= target + 7 ? "text-warn" : "text-danger";
  return { pct, tone };
}
/** Fecha y hora en que se cierra el número de invitados. */
export const cutoffDate = (o: Pick<CateringOrder, "service_at" | "cutoff_days">, s: CateringSettings) =>
  new Date(new Date(o.service_at).getTime() - (o.cutoff_days ?? s.cutoff_days) * 864e5);

/** Texto del menú para la cotización: platos fijos y opciones ("Plato fuerte a elegir: pollo o res"). */
export function menuDescription(menu: Menu, items: MenuItem[], recipes: Recipe[]) {
  const mine = items.filter((i) => i.menu_id === menu.id).sort((a, b) => Object.keys(COURSES).indexOf(recipes.find((r) => r.id === a.recipe_id)?.course ?? "otro") - Object.keys(COURSES).indexOf(recipes.find((r) => r.id === b.recipe_id)?.course ?? "otro"));
  const name = (i: MenuItem) => recipes.find((r) => r.id === i.recipe_id)?.name ?? "";
  const lines: string[] = []; const seen = new Set<string>();
  for (const i of mine) {
    if (!i.option_group) { lines.push(`• ${name(i)}`); continue; }
    if (seen.has(i.option_group)) continue;
    seen.add(i.option_group);
    lines.push(`• ${i.option_group} a elegir: ${mine.filter((x) => x.option_group === i.option_group).map(name).join(" o ")}`);
  }
  return [menu.description, lines.join("\n"), `Precio por persona. Mínimo ${menu.min_guests} invitados.`].filter(Boolean).join("\n");
}
