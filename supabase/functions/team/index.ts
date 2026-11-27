// Eventos360 · Edge Function `team`
// Equipo de trabajo de un negocio (Business). Solo propietario o administrador del negocio.
//   POST { action: "create", workspaceId, username, password, fullName, phone?, role }
//   POST { action: "reset_password", workspaceId, userId }  → contraseña temporal (se obliga a cambiarla)
//   POST { action: "set_disabled", workspaceId, userId, disabled }
//   POST { action: "remove", workspaceId, userId }          → quita del equipo (y borra la cuenta si era solo de este negocio)
// Las reglas (rol del solicitante, límite del plan, propietario intocable) se validan en la base de datos.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const EMAIL_DOMAIN = "cuentas.eventos360.invalid";
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["admin", "manager", "staff", "viewer"];

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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
}

function tempPassword(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, 4) + "-" + out.slice(4, 8) + "-" + out.slice(8) + "7";
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(req, 401, { error: "No autenticado" });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json(req, 401, { error: "Sesión no válida" });
  const callerId = caller.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Solicitud no válida" });
  }
  const workspaceId = str(body.workspaceId, 64);
  if (!UUID_RE.test(workspaceId)) return json(req, 400, { error: "Espacio no válido" });

  // ------------------------------------------------------------------ crear
  if (body.action === "create") {
    const username = str(body.username, 30).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = str(body.fullName, 120);
    const phone = str(body.phone, 30);
    const role = str(body.role, 20);
    if (!ROLES.includes(role)) return json(req, 400, { error: "Rol no válido" });
    if (!USERNAME_RE.test(username)) {
      return json(req, 400, { error: "El usuario debe tener 3 a 30 caracteres: letras minúsculas, números, punto o guion bajo." });
    }
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return json(req, 400, { error: "La contraseña debe tener entre 8 y 72 caracteres, con letras y números." });
    }
    if (fullName.length < 2) return json(req, 400, { error: "Ingresa el nombre completo." });

    const { data: check, error: checkErr } = await admin.rpc("svc_team_check", { p_ws: workspaceId, p_caller: callerId, p_target: null, p_role: role });
    if (checkErr) {
      console.error("svc_team_check", checkErr);
      return json(req, 500, { error: "No se pudo validar la solicitud." });
    }
    if (!check?.ok) return json(req, 403, { error: check?.message ?? "No autorizado" });

    const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return json(req, 409, { error: "Ese nombre de usuario ya está en uso." });

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: `${username}@${EMAIL_DOMAIN}`, password, email_confirm: true,
    });
    if (createErr || !created?.user) {
      console.error("createUser", createErr);
      const msg = createErr?.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered")) return json(req, 409, { error: "Ese nombre de usuario ya está en uso." });
      return json(req, 500, { error: "No se pudo crear la cuenta." });
    }
    const { error: addErr } = await admin.rpc("svc_team_add", {
      p_ws: workspaceId, p_caller: callerId, p_user: created.user.id, p_username: username,
      p_full_name: fullName, p_phone: phone || null, p_role: role,
    });
    if (addErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      console.error("svc_team_add", addErr);
      return json(req, 400, { error: addErr.code === "23505" ? "Ese nombre de usuario ya está en uso." : addErr.code === "P0001" ? addErr.message : "No se pudo agregar al equipo." });
    }
    return json(req, 200, { ok: true, userId: created.user.id, username });
  }

  // ------------------------------------------------- acciones sobre un miembro
  const userId = str(body.userId, 64);
  if (!UUID_RE.test(userId)) return json(req, 400, { error: "Usuario no válido" });
  const { data: check, error: checkErr } = await admin.rpc("svc_team_check", { p_ws: workspaceId, p_caller: callerId, p_target: userId, p_role: "staff" });
  if (checkErr) {
    console.error("svc_team_check", checkErr);
    return json(req, 500, { error: "No se pudo validar la solicitud." });
  }
  if (!check?.ok) return json(req, 403, { error: check?.message ?? "No autorizado" });
  const exclusive = check.exclusive === true;

  if (body.action === "reset_password" || body.action === "set_disabled") {
    // Una cuenta que también usa otro negocio (o la plataforma) solo la administra su dueño o soporte.
    if (!exclusive) return json(req, 403, { error: "Esta cuenta también se usa en otro espacio; solo soporte puede cambiarla." });
    if (body.action === "reset_password") {
      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) {
        console.error("reset_password", error);
        return json(req, 500, { error: "No se pudo restablecer la contraseña." });
      }
      await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
      await admin.rpc("svc_team_log", { p_ws: workspaceId, p_caller: callerId, p_user: userId, p_action: "team.password_reset" });
      return json(req, 200, { ok: true, temporaryPassword: password });
    }
    const disabled = body.disabled === true;
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: disabled ? "876000h" : "none" });
    if (error) {
      console.error("set_disabled", error);
      return json(req, 500, { error: "No se pudo actualizar la cuenta." });
    }
    await admin.from("profiles").update({ is_disabled: disabled }).eq("id", userId);
    await admin.rpc("svc_team_log", { p_ws: workspaceId, p_caller: callerId, p_user: userId, p_action: disabled ? "team.member_disabled" : "team.member_enabled" });
    return json(req, 200, { ok: true, disabled });
  }

  if (body.action === "remove") {
    const { data: removed, error } = await admin.rpc("svc_team_remove", { p_ws: workspaceId, p_caller: callerId, p_user: userId });
    if (error) {
      console.error("svc_team_remove", error);
      return json(req, 400, { error: error.code === "P0001" ? error.message : "No se pudo quitar del equipo." });
    }
    // Si la cuenta era solo de este negocio, se elimina para que no quede un acceso huérfano.
    if (removed?.exclusive) {
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) console.error("deleteUser", delErr);
    }
    return json(req, 200, { ok: true });
  }

  return json(req, 400, { error: "Acción no válida" });
});
