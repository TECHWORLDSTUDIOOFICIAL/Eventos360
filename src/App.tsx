import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./lib/auth";
import { FullPageSpinner } from "./components/ui";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ChangePassword from "./pages/ChangePassword";
import Workspaces from "./pages/Workspaces";
import NotFound from "./pages/NotFound";
const PublicInvitation = lazy(() => import("./pages/PublicInvitation"));
const PublicDocument = lazy(() => import("./pages/PublicDocument"));
const PublicVenues = lazy(() => import("./pages/PublicVenues"));
import WorkspaceShell from "./layouts/WorkspaceShell";
import WorkspaceHome from "./pages/workspace/WorkspaceHome";
import ModulePage from "./pages/workspace/ModulePage";
import SubscriptionPage from "./pages/workspace/SubscriptionPage";
import WorkspaceSettings from "./pages/workspace/WorkspaceSettings";
const PrintPage = lazy(() => import("./pages/personal/print/PrintPage"));
// El panel administrativo se carga bajo demanda: los clientes no descargan su código.
// Si el archivo ya no existe (nueva versión publicada), recarga la página una vez.
function lazyPage<T extends { default: ComponentType }>(load: () => Promise<T>) {
  return lazy(() =>
    load().catch((err) => {
      const key = "e360-lazy-reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return new Promise<T>(() => {});
      }
      sessionStorage.removeItem(key);
      throw err;
    }),
  );
}
const AdminShell = lazyPage(() => import("./layouts/AdminShell"));
const AdminDashboard = lazyPage(() => import("./pages/admin/AdminDashboard"));
const AdminCodes = lazyPage(() => import("./pages/admin/AdminCodes"));
const AdminPayments = lazyPage(() => import("./pages/admin/AdminPayments"));
const AdminAccounts = lazyPage(() => import("./pages/admin/AdminAccounts"));
const AdminUsers = lazyPage(() => import("./pages/admin/AdminUsers"));
const AdminPlans = lazyPage(() => import("./pages/admin/AdminPlans"));
const AdminSettings = lazyPage(() => import("./pages/admin/AdminSettings"));
const AdminAudit = lazyPage(() => import("./pages/admin/AdminAudit"));
import type { WorkspaceKind } from "./lib/types";

function RequireAuth() {
  const { loading, session, profile } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/acceso" replace state={{ from: location.pathname }} />;
  if (!profile) return <Navigate to="/acceso" replace state={{ noProfile: true }} />;
  if (profile.must_change_password && location.pathname !== "/cambiar-clave") return <Navigate to="/cambiar-clave" replace />;
  return <Outlet />;
}

function RequirePlatformAdmin() {
  const { platformRole } = useAuth();
  if (!platformRole) return <NotFound />;
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Outlet />
    </Suspense>
  );
}

const workspaceRoutes = (kind: WorkspaceKind) => (
  <Route element={<WorkspaceShell kind={kind} />}>
    <Route index element={<WorkspaceHome />} />
    <Route path="suscripcion" element={<SubscriptionPage />} />
    <Route path="configuracion" element={<WorkspaceSettings />} />
    <Route path="m/:moduleKey" element={<ModulePage />} />
    <Route path="m/:moduleKey/:itemId" element={<ModulePage />} />
    <Route path="imprimir/:doc" element={<Suspense fallback={<FullPageSpinner />}><PrintPage /></Suspense>} />
  </Route>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/acceso" element={<Login />} />
      <Route path="/registro" element={<Register />} />
      <Route path="/i/:token" element={<Suspense fallback={<FullPageSpinner />}><PublicInvitation /></Suspense>} />
      <Route path="/q/:token" element={<Suspense fallback={<FullPageSpinner />}><PublicDocument kind="quote" /></Suspense>} />
      <Route path="/k/:token" element={<Suspense fallback={<FullPageSpinner />}><PublicDocument kind="contract" /></Suspense>} />
      <Route path="/r/:token" element={<Suspense fallback={<FullPageSpinner />}><PublicVenues /></Suspense>} />

      <Route element={<RequireAuth />}>
        <Route path="/cambiar-clave" element={<ChangePassword />} />
        <Route path="/espacios" element={<Workspaces />} />
        <Route path="/p/:wsId">{workspaceRoutes("personal")}</Route>
        <Route path="/pro/:wsId">{workspaceRoutes("professional")}</Route>
        <Route path="/b/:wsId">{workspaceRoutes("business")}</Route>

        <Route element={<RequirePlatformAdmin />}>
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<AdminDashboard />} />
            <Route path="codigos" element={<AdminCodes />} />
            <Route path="pagos" element={<AdminPayments />} />
            <Route path="cuentas" element={<AdminAccounts />} />
            <Route path="usuarios" element={<AdminUsers />} />
            <Route path="planes" element={<AdminPlans />} />
            <Route path="ajustes" element={<AdminSettings />} />
            <Route path="actividad" element={<AdminAudit />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
