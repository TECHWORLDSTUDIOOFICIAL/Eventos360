import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { passwordError } from "@/lib/accounts";
import { AuthLayout } from "@/components/AuthLayout";
import { Alert, Button, Field, Input } from "@/components/ui";

export default function ChangePassword() {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forced = profile?.must_change_password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const pErr = passwordError(password) ?? (password !== password2 ? "Las contraseñas no coinciden." : null);
    if (pErr) return setError(pErr);
    setError(null);
    setBusy(true);
    const { error: upErr } = await supabase.auth.updateUser({ password });
    if (upErr) {
      setBusy(false);
      return setError(upErr.message.toLowerCase().includes("different") ? "La nueva contraseña debe ser distinta de la anterior." : "No se pudo cambiar la contraseña.");
    }
    await supabase.rpc("clear_must_change_password");
    await refreshProfile();
    navigate("/espacios", { replace: true });
  }

  return (
    <AuthLayout
      title={forced ? "Crea una nueva contraseña" : "Cambiar contraseña"}
      subtitle={forced ? "Tu contraseña fue restablecida por soporte. Elige una nueva para continuar." : `Usuario: ${profile?.username ?? ""}`}
      footer={<button className="font-semibold text-brand hover:underline" onClick={() => void signOut()}>Cerrar sesión</button>}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números.">
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Repite la contraseña">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Guardar contraseña</Button>
      </form>
    </AuthLayout>
  );
}
