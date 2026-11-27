import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Card, cx } from "./ui";

interface Step { key: string; title: string; text: string; to: string; table?: string; module?: string }

const PRO_STEPS: Step[] = [
  { key: "biz", title: "Completa los datos de tu negocio", text: "Logo, teléfono y RUC: aparecen en tus cotizaciones y contratos.", to: "configuracion" },
  { key: "customer", title: "Registra tu primer cliente", text: "Cada persona o empresa que te pide precio.", to: "m/customers", table: "customers", module: "customers" },
  { key: "quote", title: "Crea tu primera cotización", text: "Agrega servicios con foto y precio, y envíala por WhatsApp.", to: "m/quotes/nueva", table: "quotes", module: "quotes" },
  { key: "event", title: "Crea el evento de tu cliente", text: "Para organizar invitados, cronograma, costos y cobros.", to: "m/events", table: "events", module: "events" },
];
const RENTAL_STEPS: Step[] = [
  { key: "biz", title: "Completa los datos de tu negocio", text: "Logo, teléfono y RUC: aparecen en órdenes, cotizaciones y contratos.", to: "configuracion" },
  { key: "inventory", title: "Agrega tu inventario", text: "Sillas, mesas, mantelería… con su cantidad total. También desde Excel.", to: "m/inventory", table: "resources", module: "inventory" },
  { key: "customer", title: "Registra tu primer cliente", text: "Cada persona o empresa que te alquila.", to: "m/customers", table: "customers", module: "customers" },
  { key: "rental", title: "Crea tu primera reservación", text: "Elige fechas y artículos: el sistema aparta las unidades sin sobrevender.", to: "m/reservations/nueva", table: "rentals", module: "reservations" },
];

/** Guía de primeros pasos para cuentas nuevas. Se oculta sola al completarse (o si el usuario la cierra). */
export function GettingStarted({ variant }: { variant: "pro" | "rental" }) {
  const { ws, modules, readOnly } = useWorkspace();
  const key = `e360-guide-${ws.id}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const steps = (variant === "pro" ? PRO_STEPS : RENTAL_STEPS).filter((s) => !s.module || modules.some((m) => m.module_key === s.module));
  const { data: done } = useQuery({
    queryKey: ["getting-started", ws.id, variant],
    enabled: !hidden && !readOnly,
    queryFn: async () => {
      const out: Record<string, boolean> = {};
      const { data: w } = await supabase.from("workspaces").select("logo_path, contact_phone, tax_id").eq("id", ws.id).single();
      out.biz = !!(w && (w.logo_path || w.contact_phone || w.tax_id));
      await Promise.all(steps.filter((s) => s.table).map(async (s) => {
        const { count } = await supabase.from(s.table!).select("id", { count: "exact", head: true }).eq("workspace_id", ws.id);
        out[s.key] = (count ?? 0) > 0;
      }));
      return out;
    },
  });
  if (hidden || readOnly || !done) return null;
  const completed = steps.filter((s) => done[s.key]).length;
  if (completed === steps.length) return null;
  const next = steps.find((s) => !done[s.key]);
  const close = () => { try { localStorage.setItem(key, "1"); } catch { /* sin almacenamiento */ } setHidden(true); };

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-semibold">Primeros pasos</h2>
          <p className="text-sm text-muted">{completed} de {steps.length} listos. Sigue este orden y en pocos minutos tendrás todo funcionando.</p>
        </div>
        <button onClick={close} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Ocultar primeros pasos" title="Ocultar"><X className="size-4" /></button>
      </div>
      <div className="h-1 bg-line"><div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${(completed / steps.length) * 100}%` }} /></div>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => {
          const ok = done[s.key];
          const isNext = s === next;
          return (
            <li key={s.key}>
              <Link to={workspacePath(ws.kind, ws.id, s.to)} className={cx("flex items-center gap-3 px-5 py-3 transition hover:bg-paper", isNext && "bg-[var(--accent-soft)]/50")}>
                {ok ? <CheckCircle2 className="size-5 shrink-0 text-ok" /> : <Circle className={cx("size-5 shrink-0", isNext ? "text-[var(--accent)]" : "text-faint")} />}
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-sm font-semibold", ok && "text-muted line-through decoration-1")}>{i + 1}. {s.title}</span>
                  {!ok && <span className="block text-xs text-muted">{s.text}</span>}
                </span>
                {isNext && <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-[var(--accent)] sm:inline-flex">Empezar<ArrowRight className="size-4" /></span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
