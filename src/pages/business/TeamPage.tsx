import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Lock, Plus, ShieldCheck, Trash2, Unlock, UserCog } from "lucide-react";
import { callFunction, supabase } from "@/lib/supabase";
import { unwrap, useWorkspaceEntitlements } from "@/lib/queries";
import { ROLE_LABEL } from "@/lib/modalities";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { MemberRole } from "@/lib/types";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";

interface Member {
  user_id: string; username: string; full_name: string; phone: string | null; role: MemberRole;
  is_disabled: boolean; must_change_password: boolean; joined_at: string;
}

const ROLE_INFO: Partial<Record<MemberRole, string>> = {
  owner: "Dueño de la cuenta: todo, incluida la suscripción.",
  admin: "Todo: configuración, equipo, finanzas y operación.",
  manager: "Operación completa y finanzas (cobros y reportes). No gestiona el equipo.",
  staff: "Operación: inventario, reservaciones, entregas, devoluciones y mantenimiento. No ve cobros ni finanzas.",
  viewer: "Solo consulta. No puede crear ni modificar nada.",
};
const ASSIGNABLE: MemberRole[] = ["admin", "manager", "staff", "viewer"];

function suggestPassword() {
  const a = "abcdefghjkmnpqrstuvwxyz", d = "23456789";
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0]! % s.length];
  return `${Array.from({ length: 5 }, () => pick(a)).join("")}${Array.from({ length: 3 }, () => pick(d)).join("")}`;
}

/** Equipo de trabajo: cuentas con usuario y contraseña (sin correo), cada una con su rol. */
export default function TeamPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["team", ws.id],
    queryFn: async () => unwrap<Member[]>(await supabase.rpc("team_members", { p_ws: ws.id })),
  });
  const { data: ent } = useWorkspaceEntitlements(ws.id);
  const max = ent?.find((e) => e.feature_key === "members.max")?.limit_value ?? null;
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string; copy?: string } | null>(null);
  const isOwner = ws.role === "owner";
  const canManage = !readOnly && (ws.role === "owner" || ws.role === "admin");
  const refresh = () => qc.invalidateQueries({ queryKey: ["team", ws.id] });
  const full = max !== null && (data?.length ?? 0) >= max;

  const canTouch = (m: Member) => canManage && m.user_id !== profile?.id && m.role !== "owner" && (isOwner || m.role !== "admin");

  async function act(m: Member, action: "reset_password" | "set_disabled" | "remove") {
    const q = action === "remove" ? `¿Quitar a ${m.full_name} del equipo? Su cuenta se eliminará y ya no podrá entrar.`
      : action === "set_disabled" ? (m.is_disabled ? `¿Reactivar la cuenta de ${m.full_name}?` : `¿Bloquear el acceso de ${m.full_name}? Podrás reactivarlo después.`)
      : `¿Generar una contraseña temporal para ${m.full_name}? Deberá cambiarla al entrar.`;
    if (!confirm(q)) return;
    try {
      const r = await callFunction<{ temporaryPassword?: string }>("team", { action, workspaceId: ws.id, userId: m.user_id, disabled: !m.is_disabled }, true);
      if (action === "reset_password" && r.temporaryPassword) setMsg({ tone: "ok", text: `Contraseña temporal de @${m.username}: ${r.temporaryPassword}`, copy: r.temporaryPassword });
      else setMsg({ tone: "ok", text: action === "remove" ? `${m.full_name} ya no forma parte del equipo.` : m.is_disabled ? "Cuenta reactivada." : "Acceso bloqueado." });
      await refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  }
  async function setRole(m: Member, role: MemberRole) {
    const { error } = await supabase.rpc("team_set_role", { p_ws: ws.id, p_user: m.user_id, p_role: role });
    if (error) setMsg({ tone: "danger", text: error.message });
    else setMsg({ tone: "ok", text: `${m.full_name} ahora es ${ROLE_LABEL[role]}.` });
    await refresh();
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Equipo" description="Crea cuentas para tu personal con usuario y contraseña. Cada rol ve y hace solo lo que le corresponde."
        actions={canManage && <Button variant="accent" icon={<Plus className="size-4" />} disabled={full} onClick={() => setCreating(true)}>Nuevo usuario</Button>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone} onClose={() => setMsg(null)}>
        {msg.text}
        {msg.copy && <button className="ml-2 inline-flex items-center gap-1 font-semibold underline" onClick={() => void navigator.clipboard.writeText(msg.copy!)}><Copy className="size-3.5" />Copiar</button>}
      </Alert></div>}
      {full && canManage && <div className="mb-4"><Alert tone="info">Tu plan permite {max} usuarios (incluido el propietario). Para agregar más, cambia a un plan superior.</Alert></div>}

      <Card>
        <CardHeader title={`Usuarios${max !== null ? ` (${data?.length ?? 0} de ${max})` : ""}`} />
        {isLoading ? <Spinner /> : (
          <ul className="divide-y divide-line">
            {(data ?? []).map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] font-display font-semibold text-[var(--accent)]">{m.full_name.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{m.full_name}{m.user_id === profile?.id && <span className="font-normal text-muted"> (tú)</span>}</span>
                  <span className="block truncate text-xs text-muted">@{m.username}{m.phone ? ` · ${m.phone}` : ""} · desde {formatDate(m.joined_at, { timeZone: region.timezone })}</span>
                </span>
                {m.is_disabled && <Badge tone="danger">Bloqueado</Badge>}
                {m.must_change_password && !m.is_disabled && <Badge tone="warn">Contraseña temporal</Badge>}
                {canTouch(m) ? (
                  <Select value={m.role} onChange={(e) => void setRole(m, e.target.value as MemberRole)} className="h-9 w-auto" aria-label={`Rol de ${m.full_name}`}>
                    {ASSIGNABLE.filter((r) => isOwner || r !== "admin").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>
                ) : <Badge tone={m.role === "owner" ? "info" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>}
                {canTouch(m) && (
                  <span className="flex gap-0.5">
                    <button onClick={() => void act(m, "reset_password")} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" title="Restablecer contraseña" aria-label={`Restablecer contraseña de ${m.full_name}`}><KeyRound className="size-4" /></button>
                    <button onClick={() => void act(m, "set_disabled")} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" title={m.is_disabled ? "Reactivar" : "Bloquear acceso"} aria-label={m.is_disabled ? `Reactivar a ${m.full_name}` : `Bloquear a ${m.full_name}`}>{m.is_disabled ? <Unlock className="size-4" /> : <Lock className="size-4" />}</button>
                    <button onClick={() => void act(m, "remove")} className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" title="Quitar del equipo" aria-label={`Quitar a ${m.full_name}`}><Trash2 className="size-4" /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Qué puede hacer cada rol" />
        <dl className="divide-y divide-line">
          {(["owner", "admin", "manager", "staff", "viewer"] as MemberRole[]).map((r) => (
            <div key={r} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <dt className="w-32 shrink-0 font-semibold">{r === "owner" ? <span className="inline-flex items-center gap-1"><ShieldCheck className="size-4 text-[var(--accent)]" />{ROLE_LABEL[r]}</span> : ROLE_LABEL[r]}</dt>
              <dd className="min-w-0 flex-1 text-muted">{ROLE_INFO[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(u, p) => { setCreating(false); setMsg({ tone: "ok", text: `Cuenta creada. Usuario: @${u} · Contraseña: ${p}. Deberá cambiarla al entrar por primera vez.`, copy: `Usuario: ${u}\nContraseña: ${p}` }); void refresh(); }} />}
    </div>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (username: string, password: string) => void }) {
  const { ws } = useWorkspace();
  const [f, setF] = useState({ fullName: "", username: "", password: suggestPassword(), phone: "", role: "staff" as MemberRole });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await callFunction("team", { action: "create", workspaceId: ws.id, ...f, username: f.username.trim().toLowerCase() }, true);
      onCreated(f.username.trim().toLowerCase(), f.password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Nuevo usuario del equipo"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="team-form" variant="accent" loading={busy} icon={<UserCog className="size-4" />}>Crear cuenta</Button></>}>
      <form id="team-form" onSubmit={submit} className="space-y-3">
        <Field label="Nombre completo">{(id) => <Input id={id} value={f.fullName} onChange={(e) => set("fullName", e.target.value)} autoFocus />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Usuario" hint="Minúsculas, números, punto o guion bajo.">{(id, d) => <Input id={id} aria-describedby={d} value={f.username} onChange={(e) => set("username", e.target.value.toLowerCase().replace(/\s/g, ""))} autoComplete="off" />}</Field>
          <Field label="Contraseña inicial" hint="Deberá cambiarla al entrar.">{(id, d) => <Input id={id} aria-describedby={d} value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />}</Field>
          <Field label="Teléfono" optional>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
          <Field label="Rol">{(id) => <Select id={id} value={f.role} onChange={(e) => set("role", e.target.value)}>{ASSIGNABLE.filter((r) => ws.role === "owner" || r !== "admin").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}</Field>
        </div>
        <p className="text-xs text-muted">{ROLE_INFO[f.role]}</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
