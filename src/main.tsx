import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import App from "./App";
import "./index.css";

// Tras una nueva publicación, una pestaña abierta (o en caché) puede pedir archivos que ya no existen.
// En ese caso se recarga una sola vez para obtener la versión actual.
const RELOAD_KEY = "e360-chunk-reload";
function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return; // evita bucles
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* sin sessionStorage: recarga igualmente */ }
  window.location.reload();
}
window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); reloadForNewVersion(); });
window.addEventListener("unhandledrejection", (e) => {
  const msg = String((e.reason as Error | undefined)?.message ?? e.reason ?? "");
  if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(msg)) reloadForNewVersion();
});

// GitHub Pages: 404.html es una copia de index.html para que funcionen las rutas profundas.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
