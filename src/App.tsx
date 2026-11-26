import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useAuth } from "./lib/auth";
import { FullPageSpinner } from "./components/ui";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ChangePassword from "./pages/ChangePassword";
import Workspaces from "./pages/Workspaces";
import NotFound from "./pages/NotFound";
import WorkspaceShell from "./layouts/WorkspaceShell";
import WorkspaceHome from "./pages/workspace/WorkspaceHome";
import ModulePage from "./pages/workspace/ModulePage";
import SubscriptionPage from "./pages/workspace/SubscriptionPage";
import WorkspaceSettings from "./pages/workspace/WorkspaceSettings";
// El panel administrativo se carga bajo demanda: los clientes no descargan su código.
const AdminShell = lazy(() => import("./layouts/AdminShell"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminCodes = lazy(() => import("./pages/admin/AdminCodes"));
const AdminPayments = lazy(() => import("./pages/admin/AdminPayments"));
const AdminAccounts = lazy(() => import("./pages/admin/AdminAccounts"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminPlans = lazy(() => import("./pages/admin/AdminPlans"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
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
  </Route>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/acceso" element={<Login />} />
      <Route path="/registro" element={<Register />} />

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
