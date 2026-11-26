// Las cuentas se identifican por nombre de usuario (no por correo).
// Internamente Supabase Auth necesita un "email": usamos un dominio reservado que jamás recibe correo.
export const ACCOUNT_EMAIL_DOMAIN = "cuentas.eventos360.invalid";
export const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,29}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${ACCOUNT_EMAIL_DOMAIN}`;
}

export function usernameError(username: string): string | null {
  const u = normalizeUsername(username);
  if (!u) return "Ingresa un nombre de usuario.";
  if (!USERNAME_RE.test(u)) return "De 3 a 30 caracteres: letras minúsculas, números, punto o guion bajo. Debe iniciar con letra o número.";
  return null;
}

export function passwordError(password: string): string | null {
  if (password.length < 8) return "Mínimo 8 caracteres.";
  if (password.length > 72) return "Máximo 72 caracteres.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Debe incluir letras y números.";
  return null;
}

/** Formato visual del código de acceso: E360-XXXX-XXXX-XXXX-XXXX */
export function formatAccessCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^E360/, "").slice(0, 16);
  const groups = clean.match(/.{1,4}/g) ?? [];
  return groups.length ? `E360-${groups.join("-")}` : "";
}
