import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Search, Unlock, Users } from "lucide-react";
import { supabase, callFunction } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { unwrap } from "@/lib/queries";
import { formatDate, plural } from "@/lib/format";
import type { PlatformRole } from "@/lib/types";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Input, PageHeader, Spinner } from "@/components/ui";

interface UserRow {
  id: string; username: string; full_name: string; phone: string | null; is_disabled: boolean; must_change_password: boolean;
  created_at: string; platform_role: PlatformRole | null; workspaces: number;
}

export default function AdminUsers() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", search],
    queryFn: async () => unwrap<UserRow[]>(await supabase.rpc("admin_list_users", { p_search: search || null })),
  });

  async function resetPassword(u: UserRow) {
    if (!confirm(`¿Restablecer la contraseña de @${u.username}? Se generará una contraseña temporal.`)) return;
    setBusy(u.id); setError(null);
    try {
      const r = await callFunction<{ username: string; temporaryPassword: string }>("admin-users", { action: "reset_password", userId: u.id }, true);
      setTemp({ username: r.username, password: r.temporaryPassword });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function toggleDisabled(u: UserRow) {
    if (!u.is_disabled && !confirm(`¿Bloquear el acceso de @${u.username}?`)) return;
    setBusy(u.id); setError(null);
    try {
      await callFunction("admin-users", { action: "set_disabled", userId: u.id, disabled: !u.is_disabled }, true);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administración" title="Usuarios" description="Restablece contraseñas olvidadas y bloquea accesos. Las cuentas no usan correo electrónico." />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por usuario, nombre o teléfono" className="pl-10" />
      </div>
      {error && <div className="mb-4"><Alert tone="danger" onClose={() => setError(null)}>{error}</Alert></div>}
      <Card>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Users className="size-6" />} title="Sin usuarios" />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{u.full_name}</span>
                    <span className="text-sm text-muted">@{u.username}</span>
                    {u.platform_role && <Badge tone="info">{u.platform_role === "owner" ? "Propietario" : "Admin"}</Badge>}
                    {u.is_disabled && <Badge tone="danger">Bloqueado</Badge>}
                    {u.must_change_password && <Badge tone="warn">Contraseña temporal</Badge>}
                  </div>
                  <div className="text-xs text-muted">{u.phone ?? "Sin teléfono"} · {plural(u.workspaces, "espacio", "espacios")} · Alta {formatDate(u.created_at)}</div>
                </div>
                {u.id !== profile?.id && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={<KeyRound className="size-3.5" />} loading={busy === u.id} onClick={() => void resetPassword(u)}>Restablecer clave</Button>
                    <Button size="sm" variant="ghost" icon={u.is_disabled ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />} disabled={busy === u.id} onClick={() => void toggleDisabled(u)}>
                      {u.is_disabled ? "Desbloquear" : "Bloquear"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {temp && (
        <Dialog open onClose={() => setTemp(null)} title="Contraseña temporal" footer={<Button onClick={() => setTemp(null)}>Listo</Button>}>
          <p className="text-sm text-muted">Entrega estos datos al cliente. Al iniciar sesión se le pedirá crear una nueva contraseña.</p>
          <div className="mt-4 rounded-2xl border-2 border-dashed border-line-strong bg-paper p-5 text-center">
            <div className="text-sm text-muted">Usuario</div>
            <div className="font-mono text-lg font-semibold">{temp.username}</div>
            <div className="mt-3 text-sm text-muted">Contraseña temporal</div>
            <div className="select-all font-mono text-2xl font-semibold tracking-wider">{temp.password}</div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
