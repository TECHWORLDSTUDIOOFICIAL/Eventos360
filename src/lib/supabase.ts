import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !key) {
  throw new Error("Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY");
}

// Cliente del navegador: SOLO usa la clave publicable. La autorización real vive en RLS y en las RPC.
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const functionsUrl = `${url}/functions/v1`;

/** Llama a una Edge Function y devuelve el JSON o lanza un Error con el mensaje del servidor. */
export async function callFunction<T>(name: string, body: unknown, withSession = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: key! };
  if (withSession) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${functionsUrl}/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new Error("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Ocurrió un error inesperado.");
  return data as T;
}
