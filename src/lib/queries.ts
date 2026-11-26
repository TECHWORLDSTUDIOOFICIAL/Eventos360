import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Feature, MyWorkspace, Plan, PlanEntitlement, Specialty, WorkspaceModule } from "./types";

/** Convierte un error de PostgREST en un Error con mensaje legible. */
export function unwrap<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const useMyWorkspaces = (enabled = true) =>
  useQuery({
    queryKey: ["my-workspaces"],
    enabled,
    queryFn: async () => unwrap<MyWorkspace[]>(await supabase.rpc("my_workspaces")),
  });

export const useWorkspaceModules = (wsId: string | undefined) =>
  useQuery({
    queryKey: ["ws-modules", wsId],
    enabled: !!wsId,
    queryFn: async () => unwrap<WorkspaceModule[]>(await supabase.rpc("workspace_modules_for", { p_ws: wsId })),
  });

export const useWorkspaceEntitlements = (wsId: string | undefined) =>
  useQuery({
    queryKey: ["ws-entitlements", wsId],
    enabled: !!wsId,
    queryFn: async () =>
      unwrap<{ feature_key: string; is_enabled: boolean; limit_value: number | null }[]>(
        await supabase.rpc("workspace_entitlements_for", { p_ws: wsId }),
      ),
  });

export const usePublicPlans = () =>
  useQuery({
    queryKey: ["public-plans"],
    queryFn: async () =>
      unwrap<Plan[]>(await supabase.from("plans").select("*").eq("is_active", true).eq("is_public", true).order("sort")),
  });

export const useFeatures = () =>
  useQuery({
    queryKey: ["features"],
    staleTime: 3_600_000,
    queryFn: async () => unwrap<Feature[]>(await supabase.from("features").select("*").order("sort")),
  });

export const useEntitlements = () =>
  useQuery({
    queryKey: ["plan-entitlements"],
    queryFn: async () => unwrap<PlanEntitlement[]>(await supabase.from("plan_entitlements").select("*")),
  });

export const useSpecialties = () =>
  useQuery({
    queryKey: ["specialties"],
    staleTime: 3_600_000,
    queryFn: async () =>
      unwrap<Specialty[]>(await supabase.from("specialties").select("key, name, description, icon").eq("is_active", true).order("sort")),
  });

export const usePlatformSettings = () =>
  useQuery({
    queryKey: ["platform-settings"],
    staleTime: 600_000,
    queryFn: async () => {
      const rows = unwrap<{ key: string; value: unknown; description: string | null }[]>(
        await supabase.from("platform_settings").select("key, value, description"),
      );
      return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
    },
  });

/** Enlace de WhatsApp de soporte (vacío si no está configurado). */
export function whatsappLink(settings: Record<string, unknown> | undefined, text: string): string | null {
  const raw = String(settings?.["support.whatsapp"] ?? "").replace(/\D/g, "");
  if (!raw) return null;
  return `https://wa.me/${raw}?text=${encodeURIComponent(text)}`;
}
