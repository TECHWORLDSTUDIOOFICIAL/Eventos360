import { Link } from "react-router";
import { ArrowRight, Check, KeyRound, MessageCircle, UserPlus, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { MODALITIES } from "@/lib/modalities";
import { SPECIALTY_ICONS } from "@/lib/modules";
import { formatMoney } from "@/lib/format";
import { usePlatformSettings, usePublicPlans, useSpecialties, whatsappLink } from "@/lib/queries";
import type { WorkspaceKind } from "@/lib/types";
import { Logo } from "@/components/Logo";
import { cx } from "@/components/ui";

const HIGHLIGHTS: Record<WorkspaceKind, string[]> = {
  personal: ["Invitados y confirmaciones", "Invitaciones digitales con QR", "Presupuesto y proveedores", "Mesas, cronograma y tareas"],
  professional: ["CRM de clientes", "Cotizaciones y contratos", "Calendario con conflictos", "Rentabilidad por evento"],
  business: ["Módulos según tu especialidad", "Inventario y disponibilidad", "Reservas sin sobreventas", "Equipo con permisos"],
};

export default function Landing() {
  const { session } = useAuth();
  const { data: plans } = usePublicPlans();
  const { data: specialties } = useSpecialties();
  const { data: settings } = usePlatformSettings();
  const wa = whatsappLink(settings, "Hola, quiero información sobre los planes de Eventos360.");

  return (
    <div className="bg-paper">
      {/* Hero */}
      <section className="bg-grain relative overflow-hidden bg-ink text-paper">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <Logo light />
          <nav className="flex items-center gap-2 text-sm">
            <a href="#planes" className="hidden rounded-lg px-3 py-2 text-paper/75 hover:text-paper sm:inline">Planes</a>
            {session ? (
              <Link to="/espacios" className="rounded-xl bg-paper px-4 py-2 font-semibold text-ink hover:bg-white">Ir a mi cuenta</Link>
            ) : (
              <>
                <Link to="/acceso" className="rounded-lg px-3 py-2 font-medium text-paper/85 hover:text-paper">Entrar</Link>
                <Link to="/registro" className="rounded-xl bg-champagne px-4 py-2 font-semibold text-ink hover:brightness-105">Tengo un código</Link>
              </>
            )}
          </nav>
        </header>
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-14 sm:px-6 sm:pt-20">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-champagne">Plataforma para la industria de eventos</p>
          <h1 className="mt-4 max-w-3xl font-display text-[2.6rem] font-semibold leading-[1.04] sm:text-6xl">
            Del primer invitado a la última silla devuelta.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-paper/75">
            Eventos360 organiza tu celebración, tu actividad como organizador o tu empresa de servicios para eventos,
            con una experiencia diseñada para lo que realmente haces.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/registro" className="inline-flex items-center gap-2 rounded-xl bg-champagne px-5 py-3 font-semibold text-ink hover:brightness-105">
              <KeyRound className="size-4" /> Crear cuenta con mi código
            </Link>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 font-semibold text-paper hover:bg-white/5">
                <MessageCircle className="size-4" /> Solicitar un plan
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Modalidades */}
      <section className="relative z-10 mx-auto -mt-12 max-w-6xl px-4 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(MODALITIES) as WorkspaceKind[]).map((k) => {
            const m = MODALITIES[k];
            return (
              <article key={k} data-mode={k} className="rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-card)]">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">{m.short}</div>
                <h2 className="mt-2 font-display text-2xl font-semibold">{m.product}</h2>
                <p className="mt-2 text-[15px] text-ink-soft">{m.tagline}</p>
                <p className="mt-1 text-sm text-muted">{m.audience}</p>
                <ul className="mt-5 space-y-2">
                  {HIGHLIGHTS[k].map((h) => (
                    <li key={h} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" /> {h}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      {/* Especialidades */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-business">Eventos360 Business</p>
          <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">No todos los negocios de eventos hacen lo mismo.</h2>
          <p className="mt-3 text-muted">
            Al registrarte eliges tu especialidad y el sistema se configura para ella. Una empresa de alquiler de sillas no ve menús de catering;
            un salón no ve paquetes de fotografía.
          </p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(specialties ?? []).map((s) => {
            const Icon = SPECIALTY_ICONS[s.key];
            return (
              <div key={s.key} className="rounded-xl border border-line bg-card p-4">
                {Icon && <Icon className="size-5 text-business" />}
                <div className="mt-3 text-sm font-semibold leading-snug">{s.name}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="border-y border-line bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-3">
          {[
            { icon: Wallet, t: "1. Elige y paga tu plan", d: "Contáctanos y realiza el pago por transferencia o el medio acordado." },
            { icon: KeyRound, t: "2. Recibe tu código", d: "Te enviamos un código de acceso único para la modalidad que contrataste." },
            { icon: UserPlus, t: "3. Crea tu cuenta", d: "Ingresa el código, elige tu usuario y contraseña, y empieza a trabajar." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t}>
              <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" /></span>
              <h3 className="mt-4 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Planes */}
      <section id="planes" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="font-display text-3xl font-semibold sm:text-4xl">Planes</h2>
        <p className="mt-2 text-muted">Cada modalidad tiene sus propios planes.</p>
        <div className="mt-10 space-y-10">
          {(Object.keys(MODALITIES) as WorkspaceKind[]).map((k) => {
            const list = (plans ?? []).filter((p) => p.kind === k);
            if (!list.length) return null;
            return (
              <div key={k} data-mode={k}>
                <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--accent)]">{MODALITIES[k].product}</h3>
                <div className={cx("mt-4 grid gap-4", list.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2 lg:max-w-3xl")}>
                  {list.map((p) => (
                    <div key={p.id} className="rounded-2xl border border-line bg-card p-6">
                      <div className="font-semibold">{p.name}</div>
                      <div className="mt-3 flex items-baseline gap-1">
                        <span className="font-display text-4xl font-semibold tabular-nums">{formatMoney(p.price, p.currency_code)}</span>
                        <span className="text-sm text-muted">/ {p.duration_days >= 360 ? "año" : p.duration_days === 30 ? "mes" : `${p.duration_days} días`}</span>
                      </div>
                      {p.description && <p className="mt-2 text-sm text-muted">{p.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-4 rounded-2xl bg-ink p-6 text-paper sm:p-8">
          <div className="min-w-0 flex-1">
            <div className="font-display text-2xl font-semibold">¿Listo para empezar?</div>
            <p className="mt-1 text-paper/70">{String(settings?.["support.message"] ?? "")}</p>
          </div>
          {wa ? (
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-champagne px-5 py-3 font-semibold text-ink">
              <MessageCircle className="size-4" /> Escríbenos <ArrowRight className="size-4" />
            </a>
          ) : (
            <Link to="/registro" className="inline-flex items-center gap-2 rounded-xl bg-champagne px-5 py-3 font-semibold text-ink">Tengo un código <ArrowRight className="size-4" /></Link>
          )}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <Logo />
          <span>© {new Date().getFullYear()} Eventos360</span>
        </div>
      </footer>
    </div>
  );
}
