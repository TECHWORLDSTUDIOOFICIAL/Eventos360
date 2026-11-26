import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AuthLayout } from "@/components/AuthLayout";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function Login() {
  const { session, profile, signIn, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; noProfile?: boolean };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session && profile) return <Navigate to={state.from ?? "/espacios"} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(username, password);
      navigate(state.from ?? "/espacios", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Inicia sesión"
      subtitle="Ingresa con tu nombre de usuario y contraseña."
      footer={
        <>
          ¿Tienes un código de acceso?{" "}
          <Link to="/registro" className="font-semibold text-brand underline-offset-4 hover:underline">Crea tu cuenta</Link>
          <p className="mt-3">¿Olvidaste tu contraseña? Contacta a soporte de Eventos360 para restablecerla.</p>
        </>
      }
    >
      {state.noProfile && session && (
        <div className="mb-5">
          <Alert tone="warn" title="Cuenta sin perfil">
            Esta sesión no corresponde a una cuenta de Eventos360.{" "}
            <button className="font-semibold underline" onClick={() => void signOut()}>Cerrar sesión</button>
          </Alert>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="Usuario">
          {(id) => (
            <Input id={id} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username}
              onChange={(e) => setUsername(e.target.value)} placeholder="tu_usuario" required />
          )}
        </Field>
        <Field label="Contraseña">
          {(id) => (
            <div className="relative">
              <Input id={id} type={show ? "text" : "password"} autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} className="pr-11" required />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink"
                aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!username || !password}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
