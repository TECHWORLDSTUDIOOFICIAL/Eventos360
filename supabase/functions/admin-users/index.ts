// Eventos360 · Edge Function `admin-users`
// Operaciones sobre cuentas de Auth que requieren service role, solo para administradores de plataforma.
//   POST { action: "reset_password", userId }        → devuelve una contraseña temporal (se obliga a cambiarla)
//   POST { action: "set_disabled", userId, disabled } → bloquea / desbloquea el inicio de sesión
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = allowedOrigins.includes("*") ? "*" : allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function tempPassword(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, 4) + "-" + out.slice(4, 8) + "-" + out.slice(8) + "7";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Autenticación del solicitante (token de sesión del panel)
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(req, 401, { error: "No autenticado" });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json(req, 401, { error: "Sesión no válida" });

  const { data: callerAdmin } = await admin
    .from("platform_admins").select("role, profiles!inner(is_disabled)").eq("user_id", caller.user.id).maybeSingle();
  // deno-lint-ignore no-explicit-any
  if (!callerAdmin || (callerAdmin as any).profiles?.is_disabled) return json(req, 403, { error: "No autorizado" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Solicitud no válida" });
  }
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!UUID_RE.test(userId)) return json(req, 400, { error: "Usuario no válido" });
  if (userId === caller.user.id) return json(req, 400, { error: "No puedes aplicar esta acción a tu propia cuenta" });

  const { data: target } = await admin.from("profiles").select("id, username").eq("id", userId).maybeSingle();
  if (!target) return json(req, 404, { error: "Usuario no encontrado" });
  const { data: targetAdmin } = await admin.from("platform_admins").select("role").eq("user_id", userId).maybeSingle();
  if (targetAdmin && callerAdmin.role !== "owner") {
    return json(req, 403, { error: "Solo el propietario puede gestionar otros administradores" });
  }

  const audit = (action: string, details: Record<string, unknown> = {}) =>
    admin.from("audit_logs").insert({ actor_id: caller.user.id, action, entity: "profile", entity_id: userId, details });

  if (body.action === "reset_password") {
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) {
      console.error("reset_password", error);
      return json(req, 500, { error: "No se pudo restablecer la contraseña" });
    }
    await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
    await audit("user.password_reset");
    return json(req, 200, { ok: true, username: target.username, temporaryPassword: password });
  }

  if (body.action === "set_disabled") {
    const disabled = body.disabled === true;
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: disabled ? "876000h" : "none" });
    if (error) {
      console.error("set_disabled", error);
      return json(req, 500, { error: "No se pudo actualizar el usuario" });
    }
    await admin.from("profiles").update({ is_disabled: disabled }).eq("id", userId);
    await audit(disabled ? "user.disabled" : "user.enabled");
    return json(req, 200, { ok: true, disabled });
  }

  return json(req, 400, { error: "Acción no válida" });
});
