import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, CalendarOff, Copy, Link2, MessageCircle, Phone, Plus, Search, Trash2, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { waNumber } from "@/lib/pro";
import { formatDate, formatMoney, plural } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import {
  ASSIGNMENT_STATUS, PAY_TYPES, POSITIONS, useAssignments, useInvalidateStaff, usePayouts, useShifts, useUnavailability, useWorkers, workerPortalUrl,
  type Assignment, type PayType, type Worker,
} from "@/lib/staff";
import { scheduleText } from "@/lib/venues";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

const METHODS: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", deposito: "Depósito", otro: "Otro" };

/** Personal: las personas que trabajan en tus eventos, su tarifa y lo que se les debe. */
export default function WorkforcePage() {
  const { ws, region, readOnly } = useWorkspace();
  const canPay = ws.role === "owner" || ws.role === "admin" || ws.role === "manager";
  const { data: workers, isLoading } = useWorkers(ws.id);
  const { data: assignments } = useAssignments(ws.id);
  const { data: shifts } = useShifts(ws.id);
  const [tab, setTab] = useState<"personal" | "pagos">("personal");
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Worker | "new" | null>(null);
  const money = (n: number, c: string) => formatMoney(n, c, region.locale);

  const positions = useMemo(() => [...new Set((workers ?? []).flatMap((w) => w.positions))].sort(), [workers]);
  const list = (workers ?? []).filter((w) => (showInactive || w.is_active) && (!pos || w.positions.includes(pos))
    && (!q || `${w.full_name} ${w.phone ?? ""} ${w.positions.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const shiftOf = (id: string) => shifts?.find((s) => s.id === id);
  const now = Date.now();
  const upcoming = (wid: string) => (assignments ?? []).filter((a) => a.worker_id === wid && a.status !== "declined" && a.status !== "absent"
    && new Date(shiftOf(a.shift_id)?.ends_at ?? 0).getTime() > now).length;
  const owed = (wid: string) => (assignments ?? []).filter((a) => a.worker_id === wid && !a.payout_id && Number(a.pay_amount) > 0
    && new Date(shiftOf(a.shift_id)?.starts_at ?? Date.now() + 1).getTime() <= now);

  return (
    <div className="animate-rise">
      <PageHeader title="Personal" description="Las personas que trabajan en tus eventos: qué puestos cubren, cuánto se les paga y cuándo no están disponibles."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agregar persona</Button>} />

      {canPay && (
        <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
          {([["personal", "Trabajadores"], ["pagos", "Pagos al personal"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cx("border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-muted hover:text-ink")}>{l}</button>
          ))}
        </div>
      )}

      {tab === "pagos" && canPay ? <PayrollTab /> : (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o puesto" className="h-10 pl-9" />
            </div>
            {positions.length > 0 && <Select value={pos} onChange={(e) => setPos(e.target.value)} className="h-10 w-auto" aria-label="Puesto"><option value="">Todos los puestos</option>{positions.map((p) => <option key={p}>{p}</option>)}</Select>}
            <label className="flex items-center gap-2 px-1 text-sm text-muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-ink" />Ver inactivos</label>
          </div>
          {isLoading ? <Spinner /> : !workers?.length ? (
            <EmptyState icon={<Users className="size-6" />} title="Todavía no tienes personal registrado"
              action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Agregar la primera persona</Button>}>
              Agrega a tus meseros, montadores, choferes, técnicos o ayudantes con su teléfono y tarifa. Después los asignas a turnos y el sistema calcula lo que se les paga.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((w) => {
                const o = owed(w.id);
                const owedTotal = o.reduce((s, a) => s + Number(a.pay_amount), 0);
                const up = upcoming(w.id);
                return (
                  <li key={w.id}>
                    <button onClick={() => setEditing(w)} className={cx("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-paper sm:px-5", !w.is_active && "opacity-60")}>
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] font-semibold text-[var(--accent)]">{w.full_name.split(" ").slice(0, 2).map((x) => x[0]).join("")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{w.full_name}{!w.is_active && <Badge className="ml-2">Inactivo</Badge>}</span>
                        <span className="block truncate text-xs text-muted">{[w.positions.join(", ") || "Sin puesto", w.phone].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="text-right text-sm">
                        <span className="block font-semibold tabular-nums">{money(Number(w.rate), w.currency_code)} <span className="font-normal text-muted">{PAY_TYPES[w.pay_type].per}</span></span>
                        <span className="block text-xs text-muted">{up ? `${plural(up, "turno próximo", "turnos próximos")}` : "Sin turnos próximos"}{canPay && owedTotal > 0 ? ` · se le debe ${money(owedTotal, o[0]!.currency_code)}` : ""}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {!list.length && <li className="px-5 py-8 text-center text-sm text-muted">Nadie coincide con la búsqueda.</li>}
            </ul>
          )}
        </Card>
      )}
      {editing && <WorkerDialog worker={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WorkerDialog({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const { ws, region, readOnly } = useWorkspace();
  const invalidate = useInvalidateStaff();
  const { data: unav } = useUnavailability(ws.id);
  const { data: assignments } = useAssignments(ws.id);
  const { data: shifts } = useShifts(ws.id);
  const [f, setF] = useState({
    full_name: worker?.full_name ?? "", phone: worker?.phone ?? "", id_number: worker?.id_number ?? "", positions: worker?.positions ?? [],
    pay_type: worker?.pay_type ?? "shift" as PayType, rate: worker ? String(worker.rate) : "", currency_code: worker?.currency_code ?? region.currency_code,
    is_active: worker?.is_active ?? true, emergency_contact: worker?.emergency_contact ?? "", notes: worker?.notes ?? "",
  });
  const [newPos, setNewPos] = useState("");
  const [away, setAway] = useState({ from: "", to: "", reason: "" });
  const [link, setLink] = useState<string | null>(worker?.portal_token ? workerPortalUrl(worker.portal_token) : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const togglePos = (p: string) => set("positions", f.positions.includes(p) ? f.positions.filter((x) => x !== p) : [...f.positions, p]);
  const myAway = (unav ?? []).filter((u) => u.worker_id === worker?.id && u.ends_on >= new Date().toISOString().slice(0, 10));
  const history = (assignments ?? []).filter((a) => a.worker_id === worker?.id)
    .map((a) => ({ a, s: shifts?.find((s) => s.id === a.shift_id) })).filter((x) => x.s)
    .sort((x, y) => y.s!.starts_at.localeCompare(x.s!.starts_at)).slice(0, 6);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.full_name.trim().length < 2) return setError("Escribe el nombre completo.");
    if (!f.positions.length) return setError("Elige al menos un puesto (por ejemplo, Mesero).");
    if (!(Number(f.rate) >= 0) || f.rate === "") return setError("Indica cuánto se le paga.");
    setBusy(true);
    const row = { full_name: f.full_name.trim(), phone: f.phone.trim() || null, id_number: f.id_number.trim() || null, positions: f.positions,
      pay_type: f.pay_type, rate: Number(f.rate), currency_code: f.currency_code, is_active: f.is_active, emergency_contact: f.emergency_contact.trim() || null, notes: f.notes.trim() || null };
    const res = worker ? await supabase.from("workers").update(row).eq("id", worker.id) : await supabase.from("workers").insert({ ...row, workspace_id: ws.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate();
    onClose();
  }
  async function remove() {
    if (!worker) return;
    if ((assignments ?? []).some((a) => a.worker_id === worker.id)) {
      if (!confirm(`${worker.full_name} tiene turnos registrados, así que se marcará como inactivo (su historial y pagos se conservan). ¿Continuar?`)) return;
      await supabase.from("workers").update({ is_active: false }).eq("id", worker.id);
    } else {
      if (!confirm(`¿Eliminar a ${worker.full_name}?`)) return;
      const { error: err } = await supabase.from("workers").delete().eq("id", worker.id);
      if (err) return setError(err.message);
    }
    await invalidate();
    onClose();
  }
  async function addAway() {
    if (!worker || !away.from) return;
    const { error: err } = await supabase.from("worker_unavailability").insert({ workspace_id: ws.id, worker_id: worker.id, starts_on: away.from, ends_on: away.to || away.from, reason: away.reason.trim() || null });
    if (err) return setError(err.message.includes("check") ? "La fecha final no puede ser antes de la inicial." : err.message);
    setAway({ from: "", to: "", reason: "" });
    await invalidate();
  }
  async function removeAway(id: string) {
    await supabase.from("worker_unavailability").delete().eq("id", id);
    await invalidate();
  }
  async function makeLink(renew = false) {
    if (!worker) return;
    if (renew && !confirm("El enlace anterior dejará de funcionar. ¿Crear uno nuevo?")) return;
    const { data, error: err } = await supabase.rpc("worker_portal_link", { p_worker: worker.id, p_renew: renew });
    if (err) return setError(err.message);
    setLink(workerPortalUrl(data as string));
    await invalidate();
  }
  const linkMsg = link ? `Hola ${f.full_name.split(" ")[0]}, este es tu enlace de ${ws.name} para ver tus turnos y confirmar si puedes ir:\n${link}` : "";

  return (
    <Dialog open onClose={onClose} title={worker ? worker.full_name : "Agregar persona"} wide
      footer={!readOnly && <>
        {worker && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="worker-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="worker-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre completo">{(id) => <Input id={id} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} autoFocus={!worker} disabled={readOnly} />}</Field>
          <Field label="Teléfono / WhatsApp" optional>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} disabled={readOnly} />}</Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">Puestos que puede cubrir</div>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...POSITIONS, ...f.positions])].map((p) => (
              <button key={p} type="button" disabled={readOnly} onClick={() => togglePos(p)} aria-pressed={f.positions.includes(p)}
                className={cx("rounded-full border px-3 py-1 text-sm", f.positions.includes(p) ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]" : "border-line text-muted hover:text-ink")}>{p}</button>
            ))}
          </div>
          {!readOnly && <div className="mt-2 flex gap-2">
            <Input value={newPos} onChange={(e) => setNewPos(e.target.value)} placeholder="Otro puesto…" className="h-9" aria-label="Otro puesto"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newPos.trim().length >= 2) { togglePos(newPos.trim()); setNewPos(""); } } }} />
            <Button type="button" size="sm" variant="secondary" disabled={newPos.trim().length < 2} onClick={() => { togglePos(newPos.trim()); setNewPos(""); }}>Agregar</Button>
          </div>}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_150px]">
          <Field label="Cómo se le paga" hint={PAY_TYPES[f.pay_type].hint}>{(id, d) => <Select id={id} aria-describedby={d} value={f.pay_type} onChange={(e) => set("pay_type", e.target.value as PayType)} disabled={readOnly}>{(Object.keys(PAY_TYPES) as PayType[]).map((k) => <option key={k} value={k}>{PAY_TYPES[k].label}</option>)}</Select>}</Field>
          <Field label={`Tarifa ${PAY_TYPES[f.pay_type].per}`}>{(id) => <Input id={id} type="number" min="0" step="0.01" inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} disabled={readOnly} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)} disabled={readOnly}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cédula" optional>{(id) => <Input id={id} value={f.id_number} onChange={(e) => set("id_number", e.target.value)} disabled={readOnly} />}</Field>
          <Field label="Contacto de emergencia" optional>{(id) => <Input id={id} value={f.emergency_contact} onChange={(e) => set("emergency_contact", e.target.value)} placeholder="Nombre y teléfono" disabled={readOnly} />}</Field>
        </div>
        <Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-16" placeholder="Talla de uniforme, experiencia, si tiene vehículo…" disabled={readOnly} />}</Field>
        {worker && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" disabled={readOnly} />Activo (aparece para asignar turnos)</label>}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>

      {worker && <>
        <section className="mt-6 rounded-2xl border border-line p-4">
          <h3 className="flex items-center gap-2 font-semibold"><Link2 className="size-4" />Su enlace personal</h3>
          <p className="mt-1 text-sm text-muted">Con este enlace ve sus turnos (fecha, lugar, uniforme y pago) y confirma si puede ir, sin crear cuenta.</p>
          {link ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Input readOnly value={link} onFocus={(e) => e.target.select()} className="h-10 min-w-0 flex-1 text-xs" aria-label="Enlace personal" />
              <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(link)}>Copiar</Button>
              {worker.phone && <a href={`https://wa.me/${waNumber(worker.phone)}?text=${encodeURIComponent(linkMsg)}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>Enviar por WhatsApp</Button></a>}
              {!readOnly && <Button size="sm" variant="ghost" onClick={() => void makeLink(true)}>Crear otro</Button>}
            </div>
          ) : !readOnly && <Button size="sm" variant="secondary" className="mt-3" icon={<Link2 className="size-4" />} onClick={() => void makeLink()}>Crear su enlace</Button>}
        </section>

        <section className="mt-4 rounded-2xl border border-line p-4">
          <h3 className="flex items-center gap-2 font-semibold"><CalendarOff className="size-4" />Días que no puede trabajar</h3>
          <p className="mt-1 text-sm text-muted">El sistema no te dejará asignarle turnos en esas fechas.</p>
          {myAway.length > 0 && <ul className="mt-3 space-y-1.5">
            {myAway.map((u) => (
              <li key={u.id} className="flex items-center gap-2 rounded-lg bg-paper px-3 py-2 text-sm">
                <span className="flex-1">{formatDate(`${u.starts_on}T12:00:00Z`, { timeZone: "UTC" })}{u.ends_on !== u.starts_on && ` al ${formatDate(`${u.ends_on}T12:00:00Z`, { timeZone: "UTC" })}`}{u.reason && <span className="text-muted"> · {u.reason}</span>}</span>
                {!readOnly && <button onClick={() => void removeAway(u.id)} className="rounded p-1 text-muted hover:text-danger" aria-label="Quitar fechas"><X className="size-4" /></button>}
              </li>
            ))}
          </ul>}
          {!readOnly && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
            <Input type="date" value={away.from} onChange={(e) => setAway((s) => ({ ...s, from: e.target.value }))} aria-label="Desde" className="h-10" />
            <Input type="date" value={away.to} min={away.from} onChange={(e) => setAway((s) => ({ ...s, to: e.target.value }))} aria-label="Hasta" className="h-10" />
            <Input value={away.reason} onChange={(e) => setAway((s) => ({ ...s, reason: e.target.value }))} placeholder="Motivo (opcional)" aria-label="Motivo" className="h-10" />
            <Button size="sm" variant="secondary" className="h-10" disabled={!away.from} onClick={() => void addAway()}>Agregar</Button>
          </div>}
        </section>

        {history.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-2 font-semibold">Últimos turnos</h3>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {history.map(({ a, s }) => (
                <li key={a.id}><Link to={workspacePath(ws.kind, ws.id, `m/shifts/${s!.id}`)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-paper">
                  <span className="flex-1">{s!.position} · <span className="text-muted">{scheduleText(s!.starts_at, s!.ends_at, region.timezone, region.locale)}</span></span>
                  <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
                </Link></li>
              ))}
            </ul>
          </section>
        )}
        {worker.phone && <a href={`tel:${worker.phone}`} className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Phone className="size-4" />Llamar a {worker.full_name.split(" ")[0]}</a>}
      </>}
    </Dialog>
  );
}

/** Lo que se le debe a cada persona por turnos ya trabajados, y los pagos hechos. */
function PayrollTab() {
  const { ws, region, readOnly } = useWorkspace();
  const { data: workers } = useWorkers(ws.id);
  const { data: assignments } = useAssignments(ws.id);
  const { data: shifts } = useShifts(ws.id);
  const { data: payouts, isLoading } = usePayouts(ws.id);
  const invalidate = useInvalidateStaff();
  const [paying, setPaying] = useState<Worker | null>(null);
  const money = (n: number, c: string) => formatMoney(n, c, region.locale);
  const shiftOf = (id: string) => shifts?.find((s) => s.id === id);
  const now = Date.now();
  const pending = (wid: string) => (assignments ?? []).filter((a) => a.worker_id === wid && !a.payout_id && Number(a.pay_amount) > 0
    && (a.status === "assigned" || a.status === "confirmed" || a.status === "attended") && new Date(shiftOf(a.shift_id)?.starts_at ?? now + 1).getTime() <= now);
  const owedRows = (workers ?? []).map((w) => ({ w, items: pending(w.id) })).filter((r) => r.items.length);
  const totals = owedRows.reduce<Record<string, number>>((acc, r) => { for (const a of r.items) acc[a.currency_code] = (acc[a.currency_code] ?? 0) + Number(a.pay_amount); return acc; }, {});

  async function annul(id: string) {
    if (!confirm("¿Anular este pago? Los turnos vuelven a quedar pendientes de pago.")) return;
    const { error } = await supabase.from("staff_payouts").delete().eq("id", id);
    if (error) return alert(error.message);
    await invalidate();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Pendiente de pagar" description="Turnos que ya ocurrieron y todavía no se le pagan a la persona."
          action={Object.keys(totals).length > 0 && <div className="text-right font-display text-xl font-semibold tabular-nums">{Object.entries(totals).map(([c, n]) => money(n, c)).join(" + ")}</div>} />
        {!owedRows.length ? <p className="px-5 pb-5 text-sm text-muted">No le debes a nadie. Cuando pase un turno, aquí verás cuánto toca pagarle a cada persona.</p> : (
          <ul className="divide-y divide-line">
            {owedRows.map(({ w, items }) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <span className="min-w-0 flex-1"><span className="block font-medium">{w.full_name}</span>
                  <span className="block text-xs text-muted">{plural(items.length, "turno", "turnos")} · {items.some((a) => a.status !== "attended") ? "marca la asistencia antes de pagar si alguien no llegó" : "asistencia registrada"}</span></span>
                <span className="font-semibold tabular-nums">{money(items.reduce((s, a) => s + Number(a.pay_amount), 0), items[0]!.currency_code)}</span>
                {!readOnly && <Button size="sm" variant="accent" icon={<BadgeDollarSign className="size-4" />} onClick={() => setPaying(w)}>Pagar</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Pagos hechos" description="Cada pago queda ligado a sus turnos. Si te equivocaste, anúlalo y vuelve a registrarlo." />
        {isLoading ? <Spinner /> : !payouts?.length ? <p className="px-5 pb-5 text-sm text-muted">Aún no hay pagos registrados.</p> : (
          <ul className="divide-y divide-line">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <span className="w-24 text-sm text-muted">{formatDate(`${p.paid_on}T12:00:00Z`, { timeZone: "UTC" })}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{workers?.find((w) => w.id === p.worker_id)?.full_name}</span>
                  <span className="block truncate text-xs text-muted">{[p.method && (METHODS[p.method] ?? p.method), p.reference && `Ref. ${p.reference}`, plural((assignments ?? []).filter((a) => a.payout_id === p.id).length, "turno", "turnos")].filter(Boolean).join(" · ")}</span></span>
                <span className="font-semibold tabular-nums">{money(Number(p.amount), p.currency_code)}</span>
                {!readOnly && <button onClick={() => void annul(p.id)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-ink/5 hover:text-danger">Anular</button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {paying && <PayDialog worker={paying} items={pending(paying.id)} onClose={() => setPaying(null)} />}
    </div>
  );
}

function PayDialog({ worker, items, onClose }: { worker: Worker; items: Assignment[]; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const qc = useQueryClient();
  const { data: shifts } = useShifts(ws.id);
  const [sel, setSel] = useState<string[]>(items.filter((a) => a.currency_code === items[0]?.currency_code).map((a) => a.id));
  const [f, setF] = useState({ paid_on: new Date().toISOString().slice(0, 10), method: "efectivo", reference: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = items.filter((a) => sel.includes(a.id));
  const total = chosen.reduce((s, a) => s + Number(a.pay_amount), 0);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen.length) return setError("Elige al menos un turno.");
    if (new Set(chosen.map((a) => a.currency_code)).size > 1) return setError("Paga por separado los turnos en córdobas y en dólares.");
    setBusy(true);
    const { error: err } = await supabase.rpc("staff_pay", { p_ws: ws.id, p_worker: worker.id, p_assignments: sel, p_paid_on: f.paid_on, p_method: f.method, p_reference: f.reference, p_notes: f.notes });
    setBusy(false);
    if (err) return setError(err.message);
    await Promise.all(["staff-payouts", "shift-assignments"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    onClose();
  }
  return (
    <Dialog open onClose={onClose} title={`Pagar a ${worker.full_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="pay-form" variant="accent" loading={busy}>Registrar pago de {formatMoney(total, chosen[0]?.currency_code ?? worker.currency_code, region.locale)}</Button></>}>
      <form id="pay-form" onSubmit={submit} className="space-y-4">
        <ul className="divide-y divide-line rounded-xl border border-line">
          {items.map((a) => {
            const s = shifts?.find((x) => x.id === a.shift_id);
            return (
              <li key={a.id}><label className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel((x) => e.target.checked ? [...x, a.id] : x.filter((y) => y !== a.id))} className="size-4 accent-ink" />
                <span className="flex-1">{s?.position} · <span className="text-muted">{s && scheduleText(s.starts_at, s.ends_at, region.timezone, region.locale)}</span>
                  {Number(a.extras) > 0 && <span className="block text-xs text-muted">Incluye extras: {formatMoney(Number(a.extras), a.currency_code, region.locale)}{a.extras_note ? ` (${a.extras_note})` : ""}</span>}</span>
                <span className="font-semibold tabular-nums">{formatMoney(Number(a.pay_amount), a.currency_code, region.locale)}</span>
              </label></li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha del pago">{(id) => <Input id={id} type="date" value={f.paid_on} onChange={(e) => setF((s) => ({ ...s, paid_on: e.target.value }))} />}</Field>
          <Field label="Método">{(id) => <Select id={id} value={f.method} onChange={(e) => setF((s) => ({ ...s, method: e.target.value }))}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        </div>
        <Field label="Referencia" optional>{(id) => <Input id={id} value={f.reference} onChange={(e) => setF((s) => ({ ...s, reference: e.target.value }))} placeholder="N.º de transferencia" />}</Field>
        <p className="text-xs text-muted">El costo del personal ya se cuenta en Finanzas como costo de cada evento; este pago solo registra que ya se le entregó el dinero.</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
