import type { ReactNode } from "react";
import { Link } from "react-router";
import { Logo } from "./Logo";

/** Pantallas de acceso: panel de marca a la izquierda (oculto en móvil) y formulario. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="bg-grain relative hidden overflow-hidden bg-ink p-12 text-paper lg:flex lg:flex-col">
        <Link to="/"><Logo light /></Link>
        <div className="mt-auto max-w-md">
          <p className="font-display text-[2.6rem] font-semibold leading-[1.08]">
            Cada celebración, cada cliente, cada reserva. <span className="text-champagne">En un solo lugar.</span>
          </p>
          <p className="mt-5 text-paper/70">
            Eventos360 se adapta a lo que haces: tu propio evento, tu actividad como organizador o tu empresa de servicios para eventos.
          </p>
        </div>
        <div className="mt-12 flex gap-6 text-sm text-paper/50">
          <span>Personal</span><span>Profesional</span><span>Business</span>
        </div>
      </aside>
      <main className="flex flex-col bg-paper px-4 py-8 sm:px-10">
        <Link to="/" className="lg:hidden"><Logo /></Link>
        <div className="mx-auto my-auto w-full max-w-md py-10">
          <h1 className="font-display text-3xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
