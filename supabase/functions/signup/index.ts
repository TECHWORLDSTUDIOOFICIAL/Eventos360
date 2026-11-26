// Eventos360 · Edge Function `signup`
// Registro exclusivamente mediante código de acceso (sin correo electrónico).
//   POST { action: "check", code }
//   POST { action: "register", code, username, password, fullName, phone?, workspaceName?, specialties? }
// Usa la service role SOLO aquí (servidor). Nunca se expone al navegador.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const EMAIL_DOMAIN = "cuentas.eventos360.invalid"; // dominio reservado (RFC 2606): jamás recibe correo
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/;

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

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "desconocida").trim();
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método no permitido" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Solicitud no válida" });
  }

  const actor = `ip:${clientIp(req)}`;
  const code = str(body.code, 64);
  if (!code) return json(req, 400, { error: "Ingresa tu código de acceso" });

  // ---------------------------------------------------------------- check
  const { data: check, error: checkErr } = await admin.rpc("svc_check_code", { p_code: code, p_actor: actor });
  if (checkErr) {
    console.error("svc_check_code", checkErr);
    return json(req, 500, { error: "No se pudo validar el código. Inténtalo más tarde." });
  }
  if (!check?.ok) {
    return json(req, check?.error === "too_many_attempts" ? 429 : 400, { error: check?.message ?? "Código no válido" });
  }

  if (body.action === "check") {
    const { data: specialties } = await admin
      .from("specialties").select("key, name, description, icon").eq("is_active", true).order("sort");
    return json(req, 200, { ...check, specialties: check.kind === "business" ? specialties : [] });
  }

  if (body.action !== "register") return json(req, 400, { error: "Acción no válida" });

  // ------------------------------------------------------------- register
  const username = str(body.username, 30).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = str(body.fullName, 120);
  const phone = str(body.phone, 30);
  const isAdminCode = check.purpose === "platform_admin";
  const workspaceName = str(body.workspaceName, 120) || (check.kind === "personal" ? `Eventos de ${fullName}` : "");
  const specialties = Array.isArray(body.specialties)
    ? body.specialties.filter((s): s is string => typeof s === "string").slice(0, 10)
    : [];

  if (!USERNAME_RE.test(username)) {
    return json(req, 400, { error: "El usuario debe tener 3 a 30 caracteres: letras minúsculas, números, punto o guion bajo." });
  }
  if (password.length < 8 || password.length > 72) {
    return json(req, 400, { error: "La contraseña debe tener entre 8 y 72 caracteres." });
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return json(req, 400, { error: "La contraseña debe incluir letras y números." });
  }
  if (fullName.length < 2) return json(req, 400, { error: "Ingresa tu nombre completo." });
  if (!isAdminCode && workspaceName.length < 2) return json(req, 400, { error: "Ingresa el nombre de tu negocio o espacio." });

  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return json(req, 409, { error: "Ese nombre de usuario ya está en uso." });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    console.error("createUser", createErr);
    const msg = createErr?.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("registered")) {
      return json(req, 409, { error: "Ese nombre de usuario ya está en uso." });
    }
    if (msg.includes("password")) return json(req, 400, { error: "La contraseña no cumple los requisitos de seguridad." });
    return json(req, 500, { error: "No se pudo crear la cuenta. Inténtalo más tarde." });
  }

  const { data: result, error: signupErr } = await admin.rpc("svc_complete_signup", {
    p_code: code,
    p_actor: actor,
    p_user_id: created.user.id,
    p_username: username,
    p_full_name: fullName,
    p_phone: phone || null,
    p_workspace_name: isAdminCode ? null : workspaceName,
    p_specialties: specialties,
  });
  if (signupErr) {
    // Deshacer el usuario de Auth para no dejar cuentas huérfanas.
    await admin.auth.admin.deleteUser(created.user.id);
    console.error("svc_complete_signup", signupErr);
    const userFacing = signupErr.code === "P0001" || signupErr.code === "23505";
    return json(req, 400, {
      error: signupErr.code === "23505" ? "Ese nombre de usuario ya está en uso." : userFacing ? signupErr.message : "No se pudo completar el registro.",
    });
  }

  return json(req, 200, { ok: true, email: `${username}@${EMAIL_DOMAIN}`, ...result });
});
