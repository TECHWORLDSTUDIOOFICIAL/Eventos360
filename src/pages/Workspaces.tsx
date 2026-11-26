import { Link, Navigate } from "react-router";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMyWorkspaces } from "@/lib/queries";
import { MODALITIES, STATUS_LABEL, STATUS_TONE, workspacePath } from "@/lib/modalities";
import { formatDate } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { Alert, Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";

/** Selector de espacios. Si el usuario tiene uno solo, entra directo. */
export default function Workspaces() {
  const { profile, platformRole, signOut } = useAuth();
  const { data, isLoading, error } = useMyWorkspaces();

  if (isLoading) return <div className="min-h-dvh bg-paper"><Spinner /></div>;
  const list = data ?? [];
  const active = list.filter((w) => !w.is_disabled);
  if (!platformRole && active.length === 1 && list.length === 1) {
    const only = active[0]!;
    return <Navigate to={workspacePath(only.kind, only.id)} replace />;
  }
  if (platformRole && list.length === 0) return <Navigate to="/admin" replace />;

  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-6">
        <Logo />
        <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>Salir</Button>
      </header>
      <main className="mx-auto max-w-4xl px-4 pb-16">
        <h1 className="font-display text-3xl font-semibold">Hola, {profile?.full_name.split(" ")[0]}</h1>
        <p className="mt-1 text-muted">Elige el espacio en el que quieres trabajar.</p>
        {error && <div className="mt-6"><Alert tone="danger">{(error as Error).message}</Alert></div>}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {platformRole && (
            <Link to="/admin" className="group">
              <Card className="h-full p-5 transition group-hover:border-ink/30" >
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-ink text-champagne"><ShieldCheck className="size-5" /></span>
                  <div>
                    <div className="font-semibold">Panel de administración</div>
                    <div className="text-sm text-muted">Códigos, cuentas, pagos y planes</div>
                  </div>
                  <ArrowRight className="ml-auto size-5 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </div>
              </Card>
            </Link>
          )}
          {list.map((w) => {
            const m = MODALITIES[w.kind];
            const card = (
              <Card className="h-full p-5 transition group-hover:border-ink/30">
                <div data-mode={w.kind} className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] font-display text-lg font-semibold text-[var(--accent)]">
                    {w.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{w.name}</div>
                    <div className="text-sm text-muted">{m.product}{w.primary_specialty ? ` · ${w.primary_specialty}` : ""}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {w.is_disabled ? <Badge tone="danger">Desactivado</Badge> : w.subscription_status && (
                        <Badge tone={STATUS_TONE[w.subscription_status]}>{STATUS_LABEL[w.subscription_status]}</Badge>
                      )}
                      {w.period_end && <span className="text-xs text-muted">Vence {formatDate(w.period_end)}</span>}
                    </div>
                  </div>
                  {!w.is_disabled && <ArrowRight className="size-5 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />}
                </div>
              </Card>
            );
            return w.is_disabled ? <div key={w.id} className="opacity-70">{card}</div> : (
              <Link key={w.id} to={workspacePath(w.kind, w.id)} className="group">{card}</Link>
            );
          })}
        </div>
        {list.length === 0 && !platformRole && (
          <Card className="mt-8">
            <EmptyState title="No tienes espacios de trabajo">
              Tu cuenta no está asociada a ningún espacio. Contacta a soporte de Eventos360.
            </EmptyState>
          </Card>
        )}
      </main>
    </div>
  );
}
