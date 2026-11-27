import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, CalendarClock, Check, Contact, MessageCircle, Pencil, Phone, Plus, Search, Trash2, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { ACTIVITY_KIND, CUSTOMER_STATUS, QUOTE_STATUS, docNumber, useCustomers, usePayments, useQuotes, waNumber, type Activity, type Customer } from "@/lib/pro";
import { useEvents } from "@/lib/events";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

export default function CustomersPage() {
  const { itemId } = useParams();
  return itemId ? <CustomerDetail id={itemId} /> : <CustomerList />;
}

function CustomerList() {
  const { ws, readOnly } = useWorkspace();
  const { data, isLoading } = useCustomers(ws.id);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const navigate = useNavigate();
  const list = useMemo(() => (data ?? []).filter((c) =>
    (!status || c.status === status) && (!q || `${c.name} ${c.contact_name ?? ""} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);

  return (
    <div className="animate-rise">
      <PageHeader title="Clientes" description="Tus prospectos y clientes, con su historial de seguimiento, eventos, cotizaciones y pagos."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo cliente</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o correo" className="h-10 pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-auto" aria-label="Estado">
            <option value="">Todos</option>
            {Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<Contact className="size-6" />} title="Aún no tienes clientes"
            action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Registrar el primero</Button>}>
            Registra a cada persona o empresa que te pida una cotización. Así llevas su seguimiento desde el primer contacto.
          </EmptyState>
        ) : !list.length ? <p className="px-5 py-10 text-center text-sm text-muted">Ningún cliente coincide.</p> : (
          <ul className="divide-y divide-line">
            {list.map((c) => (
              <li key={c.id}>
                <Link to={workspacePath(ws.kind, ws.id, `m/customers/${c.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    {c.kind === "company" ? <Building2 className="size-5" /> : <User className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block truncate text-xs text-muted">{[c.contact_name, c.phone, c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</span>
                  </span>
                  <Badge tone={CUSTOMER_STATUS[c.status].tone}>{CUSTOMER_STATUS[c.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <CustomerDialog customer={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(id, isNew) => { setEditing(null); if (isNew) navigate(workspacePath(ws.kind, ws.id, `m/customers/${id}`)); }} />}
    </div>
  );
}

export function CustomerDialog({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: (id: string, isNew: boolean) => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({
    kind: customer?.kind ?? "person", name: customer?.name ?? "", contact_name: customer?.contact_name ?? "", phone: customer?.phone ?? "",
    email: customer?.email ?? "", tax_id: customer?.tax_id ?? "", address: customer?.address ?? "", source: customer?.source ?? "",
    status: customer?.status ?? "lead", notes: customer?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del cliente.");
    setBusy(true);
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])) as Record<string, string | null>;
    row.kind = f.kind; row.status = f.status; row.name = f.name.trim();
    const res = customer ? await supabase.from("customers").update(row).eq("id", customer.id).select("id").single()
      : await supabase.from("customers").insert({ ...row, workspace_id: ws.id }).select("id").single();
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await qc.invalidateQueries({ queryKey: ["customers", ws.id] });
    onSaved((res.data as { id: string }).id, !customer);
  }

  return (
    <Dialog open onClose={onClose} title={customer ? "Editar cliente" : "Nuevo cliente"} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="customer-form" variant="accent" loading={busy}>Guardar</Button></>}>
      <form id="customer-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          {([["person", "Persona", User], ["company", "Empresa", Building2]] as const).map(([k, l, I]) => (
            <button key={k} type="button" onClick={() => set("kind", k)}
              className={cx("inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold", f.kind === k ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-line")}>
              <I className="size-4" />{l}
            </button>
          ))}
        </div>
        <Field label={f.kind === "company" ? "Nombre de la empresa" : "Nombre completo"}>{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />}</Field>
        {f.kind === "company" ? <Field label="Persona de contacto" optional>{(id) => <Input id={id} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} />}</Field>
          : <Field label="Estado">{(id) => <Select id={id} value={f.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>}
        <Field label="Teléfono / WhatsApp" optional>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
        <Field label="Correo" optional>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />}</Field>
        <Field label={f.kind === "company" ? "RUC" : "Cédula"} optional hint="Aparece en contratos.">{(id, d) => <Input id={id} aria-describedby={d} value={f.tax_id} onChange={(e) => set("tax_id", e.target.value)} />}</Field>
        <Field label="¿Cómo te conoció?" optional>{(id) => <Input id={id} value={f.source} onChange={(e) => set("source", e.target.value)} placeholder="Instagram, recomendación…" />}</Field>
        {f.kind === "company" && <Field label="Estado">{(id) => <Select id={id} value={f.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>}
        <div className="sm:col-span-2"><Field label="Dirección" optional>{(id) => <Input id={id} value={f.address} onChange={(e) => set("address", e.target.value)} />}</Field></div>
        <div className="sm:col-span-2"><Field label="Notas" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field></div>
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}

function CustomerDetail({ id }: { id: string }) {
  const { ws, region, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: customers, isLoading } = useCustomers(ws.id);
  const { data: events } = useEvents(ws.id);
  const { data: quotes } = useQuotes(ws.id, { customerId: id });
  const { data: payments } = usePayments(ws.id, { customerId: id });
  const activities = useQuery({
    queryKey: ["activities", id],
    queryFn: async () => unwrap<Activity[]>(await supabase.from("customer_activities").select("*").eq("customer_id", id).order("created_at", { ascending: false })),
  });
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState({ kind: "note", body: "", follow_up_on: "" });
  const [error, setError] = useState<string | null>(null);
  const c = customers?.find((x) => x.id === id);
  if (isLoading) return <Spinner />;
  if (!c) return <Card><EmptyState title="Cliente no encontrado" /></Card>;

  const myEvents = (events ?? []).filter((e) => e.customer_id === id);
  const accepted = (quotes ?? []).filter((q) => q.status === "accepted");
  const currency = accepted[0]?.currency_code ?? quotes?.[0]?.currency_code ?? region.currency_code;
  const contracted = accepted.reduce((s, q) => s + Number(q.total), 0);
  const paid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const money = (n: number, cur = currency) => formatMoney(n, cur, region.locale);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);

  async function addActivity(e: FormEvent) {
    e.preventDefault();
    if (!note.body.trim()) return;
    const { error: err } = await supabase.from("customer_activities").insert({ workspace_id: ws.id, customer_id: id, kind: note.kind, body: note.body.trim(), follow_up_on: note.follow_up_on || null });
    if (err) return setError(err.message);
    setNote({ kind: "note", body: "", follow_up_on: "" });
    await qc.invalidateQueries({ queryKey: ["activities", id] });
  }
  async function toggleDone(a: Activity) {
    await supabase.from("customer_activities").update({ done: !a.done }).eq("id", a.id);
    await qc.invalidateQueries({ queryKey: ["activities", id] });
  }
  async function remove() {
    if (!confirm(`¿Eliminar a ${c!.name}? Solo es posible si no tiene cotizaciones, contratos ni pagos.`)) return;
    const { error: err } = await supabase.from("customers").delete().eq("id", id);
    if (err) return setError(err.code === "23503" ? "No se puede eliminar: el cliente tiene cotizaciones, contratos o pagos registrados. Puedes marcarlo como inactivo." : err.message);
    await qc.invalidateQueries({ queryKey: ["customers", ws.id] });
    navigate(base("m/customers"));
  }

  return (
    <div className="animate-rise">
      <Link to={base("m/customers")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Clientes</Link>
      <PageHeader title={c.name} description={[c.contact_name, c.phone, c.email].filter(Boolean).join(" · ")}
        eyebrow={<Badge tone={CUSTOMER_STATUS[c.status].tone}>{CUSTOMER_STATUS[c.status].label}</Badge>}
        actions={<>
          {c.phone && <a href={`https://wa.me/${waNumber(c.phone)}`} target="_blank" rel="noreferrer"><Button variant="secondary" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>WhatsApp</Button></a>}
          {c.phone && <a href={`tel:${c.phone}`} className="sm:hidden"><Button variant="secondary" icon={<Phone className="size-4" />}>Llamar</Button></a>}
          {!readOnly && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>}
          {!readOnly && <Link to={base(`m/quotes/nueva?cliente=${id}`)}><Button variant="accent" icon={<Plus className="size-4" />}>Cotización</Button></Link>}
        </>} />
      {error && <div className="mb-4"><Alert tone="danger" onClose={() => setError(null)}>{error}</Alert></div>}

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[{ l: "Contratado", v: money(contracted) }, { l: "Pagado", v: money(paid) }, { l: "Saldo", v: money(Math.max(0, contracted - paid)), warn: contracted - paid > 0 }].map((s) => (
          <Card key={s.l} className="p-4"><div className="text-xs text-muted">{s.l}</div><div className={cx("mt-1 font-display text-lg font-semibold tabular-nums sm:text-2xl", s.warn && "text-warn")}>{s.v}</div></Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader title="Seguimiento" description="Registra llamadas, reuniones y notas. Agrega una fecha para que aparezca como recordatorio." />
          {!readOnly && (
            <form onSubmit={addActivity} className="space-y-2 border-b border-line p-4">
              <Textarea value={note.body} onChange={(e) => setNote((s) => ({ ...s, body: e.target.value }))} placeholder="Ej. Llamó para cambiar la fecha al 20 de marzo" className="min-h-16" aria-label="Detalle" />
              <div className="flex flex-wrap gap-2">
                <Select value={note.kind} onChange={(e) => setNote((s) => ({ ...s, kind: e.target.value }))} className="h-9 w-auto text-sm" aria-label="Tipo">
                  {Object.entries(ACTIVITY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                <Input type="date" value={note.follow_up_on} onChange={(e) => setNote((s) => ({ ...s, follow_up_on: e.target.value }))} className="h-9 w-auto text-sm" aria-label="Recordarme el" title="Recordarme el" />
                <Button type="submit" size="sm" className="ml-auto" disabled={!note.body.trim()}>Registrar</Button>
              </div>
            </form>
          )}
          {activities.isLoading ? <Spinner /> : !activities.data?.length ? <p className="px-5 py-6 text-sm text-muted">Sin registros todavía.</p> : (
            <ul className="divide-y divide-line">
              {activities.data.map((a) => {
                const due = a.follow_up_on && !a.done;
                const overdue = due && a.follow_up_on! <= new Date().toISOString().slice(0, 10);
                return (
                  <li key={a.id} className="flex gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted">{ACTIVITY_KIND[a.kind]} · {formatDate(a.created_at, { timeZone: region.timezone, withTime: true })}</div>
                      <p className={cx("mt-0.5 whitespace-pre-line text-sm", a.done && "text-muted line-through")}>{a.body}</p>
                      {a.follow_up_on && (
                        <div className={cx("mt-1 inline-flex items-center gap-1 text-xs", overdue ? "font-semibold text-danger" : "text-muted")}>
                          <CalendarClock className="size-3.5" />Recordatorio: {formatDate(`${a.follow_up_on}T12:00:00Z`, { timeZone: "UTC" })}
                        </div>
                      )}
                    </div>
                    {a.follow_up_on && !readOnly && (
                      <button onClick={() => void toggleDone(a)} className={cx("grid size-7 shrink-0 place-items-center rounded-full border-2", a.done ? "border-ok bg-ok text-white" : "border-line-strong")} aria-label={a.done ? "Marcar pendiente" : "Marcar hecho"}>
                        {a.done && <Check className="size-3.5" />}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Eventos" action={!readOnly && <Link to={base(`m/events?nuevo=1&cliente=${id}`)} className="text-sm font-semibold text-[var(--accent)]">+ Nuevo</Link>} />
            {!myEvents.length ? <p className="px-5 py-5 text-sm text-muted">Sin eventos.</p> : (
              <ul className="divide-y divide-line">{myEvents.map((e) => (
                <li key={e.id}><Link to={base(`m/events/${e.id}`)} className="flex justify-between gap-2 px-5 py-3 text-sm hover:bg-paper">
                  <span className="font-medium">{e.name}</span><span className="text-muted">{e.starts_at ? formatDate(e.starts_at, { timeZone: region.timezone }) : "Sin fecha"}</span>
                </Link></li>))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Cotizaciones" />
            {!quotes?.length ? <p className="px-5 py-5 text-sm text-muted">Sin cotizaciones.</p> : (
              <ul className="divide-y divide-line">{quotes.map((q) => (
                <li key={q.id}><Link to={base(`m/quotes/${q.id}`)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-paper">
                  <span className="min-w-0"><span className="font-mono text-xs text-muted">{docNumber("COT", q.number)}</span> <span className="font-medium">{q.title}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums">{money(Number(q.total), q.currency_code)}</span><Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge></span>
                </Link></li>))}
              </ul>
            )}
          </Card>
          {!readOnly && <button onClick={() => void remove()} className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger"><Trash2 className="size-3.5" />Eliminar cliente</button>}
        </div>
      </div>
      {editing && <CustomerDialog customer={c} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}
