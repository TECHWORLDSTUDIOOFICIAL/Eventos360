import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useOutletContext, useParams } from "react-router";
import { ChevronsUpDown, CreditCard, LogOut, Menu, Settings, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap, useMyWorkspaces, usePlatformSettings, useWorkspaceModules, whatsappLink } from "@/lib/queries";
import { MODALITIES, workspacePath } from "@/lib/modalities";
import { moduleMeta } from "@/lib/modules";
import { daysUntil, formatDate } from "@/lib/format";
import type { MyWorkspace, WorkspaceKind, WorkspaceModule } from "@/lib/types";
import { Logo } from "@/components/Logo";
import { Alert, FullPageSpinner, cx } from "@/components/ui";
import NotFound from "@/pages/NotFound";
import { EVENT_SCOPED } from "@/pages/workspace/moduleRegistry";

export interface WorkspaceRegion { timezone: string; locale: string; currency_code: string; tax_rate: number }

export interface WorkspaceContext {
  ws: MyWorkspace;
  region: WorkspaceRegion;
  modules: WorkspaceModule[];
  canManage: boolean;      // propietario o administrador
  readOnly: boolean;       // suscripción suspendida/cancelada o rol de solo lectura
}

export const useWorkspace = () => useOutletContext<WorkspaceContext>();

export default function WorkspaceShell({ kind }: { kind: WorkspaceKind }) {
  const { wsId } = useParams();
  const location = useLocation();
  const { profile, platformRole, signOut } = useAuth();
  const { data: workspaces, isLoading } = useMyWorkspaces();
  const { data: modules, isLoading: loadingModules } = useWorkspaceModules(wsId);
  const { data: settings } = usePlatformSettings();
  const { data: region, isLoading: loadingRegion } = useQuery({
    queryKey: ["ws-region", wsId],
    enabled: !!wsId,
    queryFn: async () => unwrap<WorkspaceRegion>(await supabase.from("workspaces").select("timezone, locale, currency_code, tax_rate").eq("id", wsId).single()),
  });
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [location.pathname]);

  if (isLoading) return <FullPageSpinner />;
  const ws = workspaces?.find((w) => w.id === wsId);
  if (!ws || ws.is_disabled) return <NotFound />;
  // Cada modalidad tiene su propio prefijo de rutas: corrige si se accede por otro.
  if (ws.kind !== kind) return <Navigate to={workspacePath(ws.kind, ws.id)} replace />;
  if (loadingModules || loadingRegion) return <FullPageSpinner />;

  const meta = MODALITIES[kind];
  const status = ws.subscription_status;
  // Solo lectura: suscripción suspendida/cancelada, o miembro con rol de consulta.
  const suspended = status === "suspended" || status === "canceled";
  const readOnly = suspended || ws.role === "viewer";
  const canManage = ws.role === "owner" || ws.role === "admin";
  const base = workspacePath(kind, ws.id);
  const left = daysUntil(ws.period_end);
  const renewWa = whatsappLink(settings, `Hola, quiero renovar mi plan de ${meta.product} (${ws.name}).`);
  const homeKey = kind === "personal" ? "home" : "dashboard";
  const hidden = EVENT_SCOPED[kind] ?? [];
  const navModules = (modules ?? []).filter((m) => m.module_key !== homeKey && !hidden.includes(m.module_key));
  const homeLabel = modules?.find((m) => m.module_key === homeKey)?.label ?? "Inicio";
  const HomeIcon = moduleMeta(homeKey).icon;

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cx("flex items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] font-medium transition",
      isActive ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-ink-soft hover:bg-ink/5 hover:text-ink");

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-4 pb-4 pt-5">
        <Link to={base}><Logo suffix={meta.short} /></Link>
      </div>
      <Link to="/espacios" className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-line bg-paper/60 px-3 py-2.5 hover:border-line-strong">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent)] font-display font-semibold text-white">{ws.name.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{ws.name}</span>
          <span className="block truncate text-xs text-muted">{ws.primary_specialty ?? meta.product}</span>
        </span>
        <ChevronsUpDown className="size-4 text-faint" />
      </Link>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        <NavLink to={base} end className={linkCls}><HomeIcon className="size-[18px]" />{homeLabel}</NavLink>
        {navModules.map((m) => {
          const Icon = moduleMeta(m.module_key).icon;
          return (
            <NavLink key={m.module_key} to={`${base}/m/${m.module_key}`} className={linkCls}>
              <Icon className="size-[18px]" />
              <span className="truncate">{m.label}</span>
            </NavLink>
          );
        })}
      </div>
      <div className="space-y-0.5 border-t border-line px-3 py-3">
        <NavLink to={`${base}/suscripcion`} className={linkCls}><CreditCard className="size-[18px]" />Suscripción</NavLink>
        {canManage && <NavLink to={`${base}/configuracion`} className={linkCls}><Settings className="size-[18px]" />Configuración</NavLink>}
        {platformRole && <Link to="/admin" className={linkCls({ isActive: false })}><ShieldCheck className="size-[18px]" />Administración</Link>}
        <div className="flex items-center gap-3 px-3 pt-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{profile?.full_name}</div>
            <div className="truncate text-xs text-muted">@{profile?.username}</div>
          </div>
          <button onClick={() => void signOut()} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div data-mode={kind} className="min-h-dvh bg-paper lg:grid lg:grid-cols-[272px_1fr] print:block print:min-h-0 print:bg-white">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-card lg:block print:hidden">{nav}</aside>

      {/* Barra superior móvil */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-card/95 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <Link to={base}><Logo suffix={meta.short} /></Link>
        <button onClick={() => setDrawer(true)} className="rounded-lg p-2 hover:bg-ink/5" aria-label="Abrir menú"><Menu className="size-5" /></button>
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <aside className="animate-rise absolute inset-y-0 left-0 w-[86%] max-w-80 bg-card shadow-[var(--shadow-pop)]">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-2 hover:bg-ink/5" aria-label="Cerrar menú"><X className="size-5" /></button>
            {nav}
          </aside>
        </div>
      )}

      <div className="min-w-0">
        {(status === "past_due" || suspended || (left !== null && left <= 7 && left >= 0)) && (
          <div className="px-4 pt-4 sm:px-8 print:hidden">
            <Alert
              tone={suspended ? "danger" : "warn"}
              title={suspended ? "Tu suscripción está suspendida: el espacio está en modo solo lectura." :
                status === "past_due" ? "Tu suscripción venció. Renueva para no perder el acceso de escritura." :
                `Tu suscripción vence el ${formatDate(ws.period_end)}.`}
            >
              <Link to={`${base}/suscripcion`} className="font-semibold underline">Ingresar código de renovación</Link>
              {renewWa && <> · <a href={renewWa} target="_blank" rel="noreferrer" className="font-semibold underline">Solicitar renovación</a></>}
            </Alert>
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 print:max-w-none print:p-0">
          <Outlet context={{ ws, region: region ?? { timezone: "America/Managua", locale: "es-NI", currency_code: "NIO", tax_rate: 15 }, modules: modules ?? [], canManage, readOnly } satisfies WorkspaceContext} />
        </main>
      </div>
    </div>
  );
}
