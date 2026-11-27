import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { unwrap } from "./queries";

export interface CatalogItem {
  id: string; kind: "service" | "product" | "rental"; name: string; category: string | null; description: string | null; image_path: string | null;
  unit: string; price: number; cost_total: number; currency_code: string; is_active: boolean; notes: string | null;
}
export interface CatalogCost { id: string; item_id: string | null; package_id: string | null; kind: CostKind; description: string; amount: number; supplier_id: string | null; sort: number }
export type CostKind = "material" | "labor" | "supplier" | "transport" | "other";
export interface Package {
  id: string; name: string; description: string | null; image_path: string | null; price: number; cost_total: number; items_value: number; currency_code: string; is_active: boolean;
}
export interface PackageItem { id: string; package_id: string; item_id: string; quantity: number; sort: number }
export interface BusinessExpense {
  id: string; spent_at: string; category: string; description: string; amount: number; currency_code: string; supplier_id: string | null; method: string | null; notes: string | null;
}

export const COST_KINDS: Record<CostKind, { label: string; hint: string }> = {
  material: { label: "Materiales e insumos", hint: "Flores, telas, comida, decoración que se consume" },
  labor: { label: "Mano de obra", hint: "Personal, montadores, meseros, técnicos" },
  supplier: { label: "Proveedor / subcontrato", hint: "Lo que le pagas a otro negocio" },
  transport: { label: "Transporte", hint: "Camión, combustible, fletes" },
  other: { label: "Otro", hint: "Alquileres, permisos, desgaste…" },
};
export const ITEM_KINDS: Record<CatalogItem["kind"], string> = { service: "Servicio", product: "Producto", rental: "Alquiler" };
export const EXPENSE_CATEGORIES: Record<string, string> = {
  alquiler: "Alquiler del local / bodega", salarios: "Salarios y planilla", servicios_basicos: "Luz, agua, internet, teléfono", transporte: "Transporte y combustible",
  publicidad: "Publicidad y redes", impuestos: "Impuestos y trámites", mantenimiento: "Mantenimiento y reparaciones", compras: "Compras generales",
  comisiones: "Comisiones bancarias y de tarjeta", otros: "Otros",
};

/** Ganancia y margen: siempre sobre el precio SIN IVA (el IVA no es del negocio). */
export function profit(price: number, cost: number) {
  const gain = Number(price) - Number(cost);
  const margin = Number(price) > 0 ? (gain / Number(price)) * 100 : 0;
  return { gain, margin };
}
/** Precio necesario para ganar un % del precio de venta (margen), dado el costo. */
export const priceForMargin = (cost: number, marginPct: number) => (marginPct >= 100 ? 0 : Math.ceil((Number(cost) / (1 - marginPct / 100)) * 100) / 100);
export const marginTone = (m: number) => (m < 0 ? "text-danger" : m < 20 ? "text-warn" : "text-ok");

export const useCatalog = (wsId: string) =>
  useQuery({ queryKey: ["catalog", wsId], queryFn: async () => unwrap<CatalogItem[]>(await supabase.from("catalog_items").select("*").eq("workspace_id", wsId).order("category", { nullsFirst: false }).order("name")) });
export const useCatalogCosts = (wsId: string) =>
  useQuery({ queryKey: ["catalog-costs", wsId], queryFn: async () => unwrap<CatalogCost[]>(await supabase.from("catalog_costs").select("*").eq("workspace_id", wsId).order("sort").order("id")) });
export const usePackages = (wsId: string) =>
  useQuery({ queryKey: ["packages", wsId], queryFn: async () => unwrap<Package[]>(await supabase.from("packages").select("*").eq("workspace_id", wsId).order("name")) });
export const usePackageItems = (wsId: string) =>
  useQuery({ queryKey: ["package-items", wsId], queryFn: async () => unwrap<PackageItem[]>(await supabase.from("package_items").select("*").eq("workspace_id", wsId).order("sort")) });
export const useBusinessExpenses = (wsId: string) =>
  useQuery({ queryKey: ["business-expenses", wsId], queryFn: async () => unwrap<BusinessExpense[]>(await supabase.from("business_expenses").select("*").eq("workspace_id", wsId).order("spent_at", { ascending: false })) });

export function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => Promise.all(["catalog", "catalog-costs", "packages", "package-items"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
