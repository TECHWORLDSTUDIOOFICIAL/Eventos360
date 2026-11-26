import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Activity, Building2, CreditCard, KeyRound, LayoutDashboard, LogOut, Menu, Package, Settings, Users, X, ArrowLeftRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { cx } from "@/components/ui";

const NAV = [
  { to: "/admin", label: "Resumen", icon: LayoutDashboard, end: true },
  { to: "/admin/codigos", label: "Códigos de acceso", icon: KeyRound },
  { to: "/admin/pagos", label: "Pagos", icon: CreditCard },
  { to: "/admin/cuentas", label: "Cuentas", icon: Building2 },
  { to: "/admin/usuarios", label: "Usuarios", icon: Users },
  { to: "/admin/planes", label: "Planes y precios", icon: Package },
  { to: "/admin/actividad", label: "Actividad", icon: Activity },
  { to: "/admin/ajustes", label: "Ajustes", icon: Settings },
];

export default function AdminShell() {
  const { profile, platformRole, signOut } = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [location.pathname]);

  const nav = (
    <nav className="flex h-full flex-col text-paper">
      <div className="px-5 pb-6 pt-5"><Link to="/admin"><Logo light suffix="Admin" /></Link></div>
      <div className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2 text-[14.5px] font-medium transition",
              isActive ? "bg-white/10 text-paper" : "text-paper/65 hover:bg-white/5 hover:text-paper")}>
            <Icon className="size-[18px]" />{label}
          </NavLink>
        ))}
      </div>
      <div className="border-t border-white/10 px-3 py-3">
        <Link to="/espacios" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-paper/65 hover:bg-white/5 hover:text-paper">
          <ArrowLeftRight className="size-4" /> Mis espacios
        </Link>
        <div className="flex items-center gap-3 px-3 pt-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{profile?.full_name}</div>
            <div className="truncate text-xs text-paper/50">@{profile?.username} · {platformRole === "owner" ? "Propietario" : "Administrador"}</div>
          </div>
          <button onClick={() => void signOut()} className="rounded-lg p-2 text-paper/60 hover:bg-white/10 hover:text-paper" aria-label="Cerrar sesión"><LogOut className="size-4" /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-dvh bg-ink lg:block">{nav}</aside>
      <div className="sticky top-0 z-30 flex items-center justify-between bg-ink px-4 py-3 lg:hidden">
        <Logo light suffix="Admin" />
        <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-paper hover:bg-white/10" aria-label="Abrir menú"><Menu className="size-5" /></button>
      </div>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} />
          <aside className="animate-rise absolute inset-y-0 left-0 w-[84%] max-w-72 bg-ink">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-2 text-paper hover:bg-white/10" aria-label="Cerrar menú"><X className="size-5" /></button>
            {nav}
          </aside>
        </div>
      )}
      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
}
