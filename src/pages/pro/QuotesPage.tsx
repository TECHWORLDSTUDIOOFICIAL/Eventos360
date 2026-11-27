import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, Check, Copy, FileSignature, FileText, ImagePlus, MessageCircle, Plus, Printer, Search, Send, Trash2, Wallet, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { publicMediaUrl, uploadImage, useEvents } from "@/lib/events";
import { DEFAULT_QUOTE_INTRO, DEFAULT_QUOTE_TERMS, QUOTE_STATUS, QUOTE_TEMPLATES, docNumber, quoteUrl, useCustomers, useQuotes, waNumber, type Quote, type QuoteItem, type QuoteTemplate } from "@/lib/pro";
import { useResources } from "@/lib/rental";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";
import { PaymentDialog } from "./FinancePage";

export default function QuotesPage() {
  const { itemId } = useParams();
  if (itemId === "nueva") return <NewQuote />;
  return itemId ? <QuoteEditor id={itemId} /> : <QuoteList />;
}

function QuoteList() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useQuotes(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const cust = (id: string) => customers?.find((c) => c.id === id)?.name ?? "";
  const list = useMemo(() => (data ?? []).filter((x) => (!status || x.status === status)
    && (!q || `${docNumber("COT", x.number)} ${x.title} ${cust(x.customer_id)}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="animate-rise">
      <PageHeader title="Cotizaciones" description="Propuestas para tus clientes con servicios, descuentos, impuestos y anticipo. Envíalas por enlace o en PDF."
        actions={!readOnly && <Link to={workspacePath(ws.kind, ws.id, "m/quotes/nueva")}><Button variant="accent" icon={<Plus className="size-4" />}>Nueva cotización</Button></Link>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, título o cliente" className="h-10 pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-auto" aria-label="Estado">
            <option value="">Todos los estados</option>
            {Object.entries(QUOTE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<FileText className="size-6" />} title="Aún no tienes cotizaciones"
            action={!readOnly && <Link to={workspacePath(ws.kind, ws.id, "m/quotes/nueva")}><Button variant="accent">Crear cotización</Button></Link>}>
            Arma tu propuesta por líneas: cada servicio con su cantidad y precio. El sistema calcula descuentos, IVA y total.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((x) => (
              <li key={x.id}>
                <Link to={workspacePath(ws.kind, ws.id, `m/quotes/${x.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                  <span className="w-20 font-mono text-xs text-muted">{docNumber("COT", x.number)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{x.title}</span><span className="block truncate text-xs text-muted">{cust(x.customer_id)} · {formatDate(`${x.issue_date}T12:00:00Z`, { timeZone: "UTC" })}</span></span>
                  <span className="font-semibold tabular-nums">{formatMoney(Number(x.total), x.currency_code, region.locale)}</span>
                  <Badge tone={QUOTE_STATUS[x.status].tone}>{QUOTE_STATUS[x.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NewQuote() {
  const { ws, region } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: customers, isLoading: loadingCustomers } = useCustomers(ws.id);
  const { data: events } = useEvents(ws.id);
  const [f, setF] = useState({ customer_id: params.get("cliente") ?? "", event_id: params.get("evento") ?? "", title: "", currency_code: region.currency_code, template: "clasica" as QuoteTemplate });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const evs = (events ?? []).filter((e) => !f.customer_id || e.customer_id === f.customer_id);
  useEffect(() => {
    const ev = events?.find((e) => e.id === f.event_id);
    if (ev && !f.title) setF((s) => ({ ...s, title: `Servicios para ${ev.name}`, currency_code: ev.currency_code }));
  }, [f.event_id, events]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.customer_id) return setError("Elige el cliente.");
    if (f.title.trim().length < 2) return setError("Escribe un título.");
    setBusy(true);
    const valid = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    const { data, error: err } = await supabase.from("quotes").insert({
      workspace_id: ws.id, customer_id: f.customer_id, event_id: f.event_id || null, title: f.title.trim(), currency_code: f.currency_code,
      tax_rate: region.tax_rate, valid_until: valid, deposit_pct: 50, template: f.template, intro: DEFAULT_QUOTE_INTRO, terms: DEFAULT_QUOTE_TERMS,
    }).select("id").single();
    setBusy(false);
    if (err) return setError(err.message);
    await qc.invalidateQueries({ queryKey: ["quotes", ws.id] });
    navigate(workspacePath(ws.kind, ws.id, `m/quotes/${(data as { id: string }).id}`), { replace: true });
  }

  return (
    <div className="animate-rise mx-auto max-w-xl">
      <PageHeader title="Nueva cotización" />
      <Card className="p-5">
        {loadingCustomers ? <Spinner /> : !customers?.length ? (
          <Alert tone="info">Primero registra un cliente en <Link to={workspacePath(ws.kind, ws.id, "m/customers")} className="font-semibold underline">Clientes</Link>.</Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Cliente">{(id) => <Select id={id} value={f.customer_id} onChange={(e) => setF((s) => ({ ...s, customer_id: e.target.value, event_id: "" }))}><option value="">Elegir…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            <Field label="Evento" optional>{(id) => <Select id={id} value={f.event_id} onChange={(e) => setF((s) => ({ ...s, event_id: e.target.value }))}><option value="">Sin evento</option>{evs.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}</Select>}</Field>
            <Field label="Título">{(id) => <Input id={id} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} placeholder="Ej. Coordinación integral de boda" />}</Field>
            <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => setF((s) => ({ ...s, currency_code: e.target.value }))}><option>NIO</option><option>USD</option></Select>}</Field>
            <div>
              <div className="mb-1.5 text-sm font-medium">Diseño</div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(QUOTE_TEMPLATES) as QuoteTemplate[]).map((t) => (
                  <button key={t} type="button" onClick={() => setF((s) => ({ ...s, template: t }))}
                    className={cx("rounded-xl border p-2 text-left", f.template === t ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-line")}>
                    <TemplateThumb t={t} /><div className="mt-1.5 text-xs font-semibold">{QUOTE_TEMPLATES[t].name}</div>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{QUOTE_TEMPLATES[f.template].description}</p>
            </div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" variant="accent" className="w-full" loading={busy}>Crear y agregar servicios</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

function QuoteEditor({ id }: { id: string }) {
  const { ws, region, readOnly, modules } = useWorkspace();
  const hasInventory = modules.some((m) => m.module_key === "inventory");
  const hasRentals = modules.some((m) => m.module_key === "reservations");
  const { data: resources } = useResources(ws.id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: customers } = useCustomers(ws.id);
  const { data: events } = useEvents(ws.id);
  const quote = useQuery({ queryKey: ["quote", id], queryFn: async () => unwrap<Quote>(await supabase.from("quotes").select("*").eq("id", id).single()) });
  const items = useQuery({ queryKey: ["quote-items", id], queryFn: async () => unwrap<QuoteItem[]>(await supabase.from("quote_items").select("*").eq("quote_id", id).order("sort").order("id")) });
  const [f, setF] = useState<Partial<Quote>>({});
  const [line, setLine] = useState({ description: "", quantity: "1", unit_price: "", discount_pct: "0", resource_id: "", details: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "danger" | "info"; text: string } | null>(null);
  const [paying, setPaying] = useState(false);
  useEffect(() => { if (quote.data) setF(quote.data); }, [quote.data]);
  if (quote.isLoading) return <Spinner />;
  const q = quote.data;
  if (!q) return <Card><EmptyState title="Cotización no encontrada" /></Card>;
  const locked = readOnly || q.status === "accepted";
  const money = (n: number) => formatMoney(n, q.currency_code, region.locale);
  const customer = customers?.find((c) => c.id === q.customer_id);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["quote", id] }), qc.invalidateQueries({ queryKey: ["quote-items", id] }), qc.invalidateQueries({ queryKey: ["quotes", ws.id] })]);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const url = quoteUrl(q.public_token);
  const deposit = Math.round(Number(q.total) * Number(q.deposit_pct)) / 100;

  async function saveHeader(patch?: Partial<Quote>) {
    const v = { ...f, ...patch };
    const { error } = await supabase.from("quotes").update({
      title: v.title, event_id: v.event_id || null, issue_date: v.issue_date, valid_until: v.valid_until || null, currency_code: v.currency_code,
      discount_amount: Number(v.discount_amount) || 0, tax_rate: Number(v.tax_rate) || 0, deposit_pct: Number(v.deposit_pct) || 0,
      terms: v.terms || null, notes: v.notes || null, status: v.status, template: v.template, intro: v.intro || null,
    }).eq("id", id);
    if (error) { setMsg({ tone: "danger", text: error.message }); return false; }
    await refresh();
    return true;
  }
  async function addLine(e: FormEvent) {
    e.preventDefault();
    if (!line.description.trim()) return;
    const { data: last } = await supabase.from("quote_items").select("sort").eq("quote_id", id).order("sort", { ascending: false }).limit(1);
    const nextSort = ((last?.[0] as { sort: number } | undefined)?.sort ?? 0) + 1;
    const { error } = await supabase.from("quote_items").insert({
      workspace_id: ws.id, quote_id: id, description: line.description.trim(), quantity: Number(line.quantity) || 1,
      unit_price: Number(line.unit_price) || 0, discount_pct: Number(line.discount_pct) || 0, sort: nextSort,
      resource_id: line.resource_id || null, details: line.details || null,
    });
    if (error) return setMsg({ tone: "danger", text: error.message });
    setLine({ description: "", quantity: "1", unit_price: "", discount_pct: "0", resource_id: "", details: "" });
    await refresh();
  }
  async function updateLine(it: QuoteItem, patch: Partial<QuoteItem>) {
    const { error } = await supabase.from("quote_items").update(patch).eq("id", it.id);
    if (error) setMsg({ tone: "danger", text: error.message });
    await refresh();
  }
  async function setLineImage(it: QuoteItem, file: File | null) {
    try {
      let path: string | null = null;
      if (file) path = await uploadImage("event-media", `${ws.id}/cotizaciones/${id}/${crypto.randomUUID()}.webp`, file, 1400);
      const { error } = await supabase.from("quote_items").update({ image_path: path }).eq("id", it.id);
      if (error) throw new Error(error.message);
      if (it.image_path) await supabase.storage.from("event-media").remove([it.image_path]);
      await refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: (err as Error).message });
    }
  }
  async function removeLine(it: QuoteItem) {
    if (it.image_path) await supabase.storage.from("event-media").remove([it.image_path]);
    await supabase.from("quote_items").delete().eq("id", it.id);
    await refresh();
  }
  async function send() {
    if (!items.data?.length) return setMsg({ tone: "danger", text: "Agrega al menos un servicio antes de enviar." });
    if (await saveHeader({ status: "sent" })) setMsg({ tone: "ok", text: "Cotización lista para enviar. Comparte el enlace con tu cliente: podrá verla y aceptarla desde su celular." });
  }
  async function markAccepted() {
    if (!confirm("¿Registrar que el cliente aceptó esta cotización (por ejemplo, en persona)?")) return;
    await saveHeader({ status: "accepted" });
  }
  async function remove() {
    if (!confirm(`¿Eliminar ${docNumber("COT", q!.number)}?`)) return;
    const { error } = await supabase.from("quotes").delete().eq("id", id);
    if (error) return setMsg({ tone: "danger", text: error.message });
    await qc.invalidateQueries({ queryKey: ["quotes", ws.id] });
    navigate(base("m/quotes"));
  }
  const share = `Hola ${customer?.name ?? ""}, te comparto la cotización ${docNumber("COT", q.number)} – ${q.title}: ${url}`;
  const set = (k: keyof Quote, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="animate-rise">
      <Link to={base("m/quotes")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Cotizaciones</Link>
      <PageHeader eyebrow={<span className="inline-flex items-center gap-2">{docNumber("COT", q.number)} <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge></span>}
        title={q.title} description={customer ? <Link to={base(`m/customers/${customer.id}`)} className="hover:underline">{customer.name}</Link> : undefined}
        actions={<>
          <Link to={base(`imprimir/cotizacion?id=${id}`)}><Button variant="secondary" icon={<Printer className="size-4" />}>PDF</Button></Link>
          {!readOnly && q.status === "draft" && <Button variant="accent" icon={<Send className="size-4" />} onClick={() => void send()}>Marcar como enviada</Button>}
          {!readOnly && q.status === "sent" && <Button variant="secondary" icon={<Check className="size-4" />} onClick={() => void markAccepted()}>Registrar aceptación</Button>}
          {!readOnly && q.status === "accepted" && <>
            {hasRentals && <Link to={base(`m/reservations/nueva?cotizacion=${id}`)}><Button variant="secondary" icon={<CalendarCheck className="size-4" />}>Crear reservación</Button></Link>}
            <Link to={base(`m/contracts/nuevo?cotizacion=${id}`)}><Button variant="secondary" icon={<FileSignature className="size-4" />}>Crear contrato</Button></Link>
            <Button variant="accent" icon={<Wallet className="size-4" />} onClick={() => setPaying(true)}>Registrar pago</Button>
          </>}
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert></div>}
      {q.status === "accepted" && <div className="mb-4"><Alert tone="ok" title="Cotización aceptada">{q.accepted_name ? `Aceptada por ${q.accepted_name}` : "Aceptada"}{q.accepted_at ? ` el ${formatDate(q.accepted_at, { timeZone: region.timezone, withTime: true })}` : ""}. Ya no se puede modificar.</Alert></div>}

      {q.status !== "draft" && (
        <Card className="mb-6 p-4">
          <div className="text-sm font-semibold">Enlace para tu cliente</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} className="h-10 min-w-0 flex-1 text-xs" aria-label="Enlace de la cotización" />
            <Button size="md" variant="secondary" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(url).then(() => setMsg({ tone: "ok", text: "Enlace copiado." }))}>Copiar</Button>
            <a href={`https://wa.me/${waNumber(customer?.phone)}?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer"><Button variant="secondary" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>WhatsApp</Button></a>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Diseño del documento" description="Cambia el estilo cuando quieras; el contenido se conserva." />
            <div className="grid gap-2 p-4 sm:grid-cols-3">
              {(Object.keys(QUOTE_TEMPLATES) as QuoteTemplate[]).map((t) => (
                <button key={t} type="button" disabled={locked} onClick={() => { set("template", t); void saveHeader({ template: t }); }}
                  className={cx("rounded-xl border p-3 text-left transition disabled:opacity-60", (f.template ?? q.template) === t ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-line hover:border-line-strong")}>
                  <TemplateThumb t={t} />
                  <div className="mt-2 text-sm font-semibold">{QUOTE_TEMPLATES[t].name}</div>
                  <div className="text-xs leading-snug text-muted">{QUOTE_TEMPLATES[t].description}</div>
                </button>
              ))}
            </div>
            <div className="border-t border-line p-4">
              <Field label="Mensaje de introducción" optional hint="Aparece debajo del título.">{(i2, d) => <Textarea id={i2} aria-describedby={d} disabled={locked} value={f.intro ?? ""} onChange={(e) => set("intro", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Servicios, productos u opciones" description="Agrega fotos para presentar cada opción (por ejemplo, cada decoración con su precio)." />
            <ul className="divide-y divide-line">
              {(items.data ?? []).map((it, n) => (
                <LineEditor key={it.id} it={it} n={n + 1} locked={locked} money={money}
                  onUpdate={(patch) => updateLine(it, patch)} onRemove={() => removeLine(it)} onImage={(file) => setLineImage(it, file)} />
              ))}
            </ul>
            {!locked && (
              <form onSubmit={addLine} className="grid gap-2 border-t border-line bg-paper/50 p-4 sm:grid-cols-[1fr_80px_120px_80px_auto]">
                {hasInventory && !!resources?.length && (
                  <Select className="sm:col-span-5" value={line.resource_id} aria-label="Agregar del inventario" onChange={(e) => {
                    const r = resources.find((x) => x.id === e.target.value);
                    setLine((s) => r ? { ...s, resource_id: r.id, description: r.name, unit_price: String(r.rent_price), details: r.description ?? "" } : { ...s, resource_id: "", details: "" });
                  }}>
                    <option value="">Del inventario (opcional)…</option>
                    {resources.map((r) => <option key={r.id} value={r.id}>{r.name} · {formatMoney(Number(r.rent_price), r.currency_code, region.locale)}</option>)}
                  </Select>
                )}
                <Input value={line.description} onChange={(e) => setLine((s) => ({ ...s, description: e.target.value }))} placeholder="Nuevo servicio, producto u opción" aria-label="Nueva descripción" />
                <Input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setLine((s) => ({ ...s, quantity: e.target.value }))} aria-label="Cantidad" className="text-right" />
                <Input type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => setLine((s) => ({ ...s, unit_price: e.target.value }))} placeholder="Precio" aria-label="Precio unitario" className="text-right" />
                <Input type="number" min="0" max="100" value={line.discount_pct} onChange={(e) => setLine((s) => ({ ...s, discount_pct: e.target.value }))} aria-label="Descuento %" className="text-right" />
                <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} disabled={!line.description.trim()}>Agregar</Button>
              </form>
            )}
            {!items.data?.length && <p className="px-4 pb-4 text-sm text-muted">Agrega cada servicio con su cantidad y precio. Luego puedes añadirle foto y descripción.</p>}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{money(Number(q.subtotal))}</dd></div>
              {Number(q.discount_amount) > 0 && <div className="flex justify-between"><dt className="text-muted">Descuento</dt><dd className="tabular-nums">−{money(Math.min(Number(q.discount_amount), Number(q.subtotal)))}</dd></div>}
              {Number(q.tax_rate) > 0 && <div className="flex justify-between"><dt className="text-muted">IVA ({Number(q.tax_rate)}%)</dt><dd className="tabular-nums">{money(Number(q.tax_amount))}</dd></div>}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="font-display text-2xl tabular-nums">{money(Number(q.total))}</dd></div>
              {Number(q.deposit_pct) > 0 && <div className="flex justify-between text-[var(--accent)]"><dt>Anticipo ({Number(q.deposit_pct)}%)</dt><dd className="font-semibold tabular-nums">{money(deposit)}</dd></div>}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Condiciones" />
            <fieldset disabled={locked} className="space-y-3 p-4">
              <Field label="Título">{(i) => <Input id={i} value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
              <Field label="Evento" optional>{(i) => <Select id={i} value={f.event_id ?? ""} onChange={(e) => { set("event_id", e.target.value); void saveHeader({ event_id: e.target.value || null }); }}><option value="">Sin evento</option>{(events ?? []).filter((e) => e.customer_id === q.customer_id || e.id === q.event_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>}</Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Fecha">{(i) => <Input id={i} type="date" value={f.issue_date ?? ""} onChange={(e) => set("issue_date", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
                <Field label="Válida hasta">{(i) => <Input id={i} type="date" value={f.valid_until ?? ""} onChange={(e) => set("valid_until", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
                <Field label="Descuento global">{(i) => <Input id={i} type="number" min={0} step="0.01" value={f.discount_amount ?? 0} onChange={(e) => set("discount_amount", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
                <Field label="IVA %">{(i) => <Input id={i} type="number" min={0} max={100} step="0.01" value={f.tax_rate ?? 0} onChange={(e) => set("tax_rate", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
                <Field label="Anticipo %">{(i) => <Input id={i} type="number" min={0} max={100} value={f.deposit_pct ?? 0} onChange={(e) => set("deposit_pct", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
                <Field label="Moneda">{(i) => <Select id={i} value={f.currency_code ?? "NIO"} onChange={(e) => { set("currency_code", e.target.value); void saveHeader({ currency_code: e.target.value }); }}><option>NIO</option><option>USD</option></Select>}</Field>
              </div>
              <Field label="Términos y condiciones" optional>{(i) => <Textarea id={i} value={f.terms ?? ""} onChange={(e) => set("terms", e.target.value)} onBlur={() => void saveHeader()} placeholder="Forma de pago, qué incluye, política de cancelación…" className="min-h-28" />}</Field>
              <Field label="Notas internas" optional hint="No aparecen en el documento.">{(i, d) => <Textarea id={i} aria-describedby={d} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} onBlur={() => void saveHeader()} />}</Field>
            </fieldset>
          </Card>
          {!readOnly && q.status !== "accepted" && (
            <div className="flex flex-wrap gap-3 text-xs">
              {q.status !== "draft" && <button className="text-muted hover:text-ink" onClick={() => void saveHeader({ status: "draft" })}>Volver a borrador</button>}
              <button className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => void remove()}><Trash2 className="size-3.5" />Eliminar</button>
            </div>
          )}
        </div>
      </div>
      {paying && <PaymentDialog defaults={{ customer_id: q.customer_id, event_id: q.event_id, quote_id: q.id, currency_code: q.currency_code, amount: deposit || undefined }}
        onClose={() => setPaying(false)} onSaved={() => { setPaying(false); setMsg({ tone: "ok", text: "Pago registrado." }); }} />}
    </div>
  );
}

/** Miniatura ilustrativa de cada diseño. */
function TemplateThumb({ t }: { t: QuoteTemplate }) {
  const bar = <div className="h-1 rounded bg-[var(--accent)]/70" />;
  return (
    <div className="aspect-[4/3] overflow-hidden rounded-lg border border-line bg-white p-2">
      {t === "clasica" && <div className="space-y-1.5">{bar}<div className="h-2 w-1/2 rounded bg-ink/20" /><div className="h-2.5 rounded bg-[var(--accent)]/60" />{[0, 1, 2].map((i) => <div key={i} className="h-1.5 rounded bg-ink/10" />)}</div>}
      {t === "catalogo" && <div className="space-y-1.5"><div className="h-3 rounded bg-[var(--accent)]/70" />{[0, 1].map((i) => <div key={i} className="flex gap-1.5"><div className="size-6 rounded bg-champagne/60" /><div className="flex-1 space-y-1"><div className="h-1.5 rounded bg-ink/25" /><div className="h-1.5 w-2/3 rounded bg-ink/10" /></div></div>)}</div>}
      {t === "elegante" && <div className="flex flex-col items-center space-y-1.5"><div className="size-4 rounded-full bg-ink/20" /><div className="h-1.5 w-2/3 rounded bg-ink/25" /><div className="h-px w-full bg-[var(--accent)]/60" />{[0, 1, 2].map((i) => <div key={i} className="h-1.5 w-full rounded bg-ink/10" />)}</div>}
    </div>
  );
}

/** Una línea de la cotización: foto, nombre, descripción, cantidad, precio y descuento. */
function LineEditor({ it, n, locked, money, onUpdate, onRemove, onImage }: {
  it: QuoteItem; n: number; locked: boolean; money: (v: number) => string;
  onUpdate: (patch: Partial<QuoteItem>) => Promise<void>; onRemove: () => Promise<void>; onImage: (file: File | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const img = publicMediaUrl(it.image_path);
  const num = (v: string) => Number(v);
  return (
    <li className="flex gap-3 p-4">
      <div className="shrink-0">
        <label className={cx("relative grid size-20 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-line-strong bg-paper text-muted sm:size-24", !locked && "cursor-pointer hover:border-[var(--accent)]")}>
          {img ? <img src={img} alt="" className="absolute inset-0 size-full object-cover" /> : busy ? <span className="text-xs">Subiendo…</span> : <><ImagePlus className="size-5" /><span className="sr-only">Agregar foto</span></>}
          {!locked && <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label={`Foto de la línea ${n}`}
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setBusy(true); await onImage(f); setBusy(false); }} />}
        </label>
        {img && !locked && <button type="button" onClick={() => void onImage(null)} className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-muted hover:text-danger"><X className="size-3" />Quitar foto</button>}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {locked ? <div className="font-semibold">{it.description}</div> : (
          <Input defaultValue={it.description} className="h-9 font-semibold" aria-label="Descripción"
            onBlur={(e) => e.target.value.trim() && e.target.value !== it.description && void onUpdate({ description: e.target.value.trim() })} />
        )}
        {locked ? (it.details && <p className="whitespace-pre-line text-sm text-ink-soft">{it.details}</p>) : (
          <Textarea defaultValue={it.details ?? ""} placeholder="Descripción detallada (qué incluye, medidas, colores…)" className="min-h-14 text-sm" aria-label="Detalle"
            onBlur={(e) => e.target.value !== (it.details ?? "") && void onUpdate({ details: e.target.value.trim() || null })} />
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {locked ? <span className="text-muted">{Number(it.quantity)} × {money(Number(it.unit_price))}{Number(it.discount_pct) ? ` · −${Number(it.discount_pct)}%` : ""}</span> : <>
            <label className="flex items-center gap-1 text-xs text-muted">Cant.<Input type="number" min="0.01" step="0.01" defaultValue={it.quantity} className="h-8 w-20 text-right" aria-label="Cantidad de la línea"
              onBlur={(e) => num(e.target.value) > 0 && num(e.target.value) !== Number(it.quantity) && void onUpdate({ quantity: num(e.target.value) })} /></label>
            <label className="flex items-center gap-1 text-xs text-muted">Precio<Input type="number" min="0" step="0.01" defaultValue={it.unit_price} className="h-8 w-28 text-right" aria-label="Precio"
              onBlur={(e) => num(e.target.value) !== Number(it.unit_price) && void onUpdate({ unit_price: num(e.target.value) || 0 })} /></label>
            <label className="flex items-center gap-1 text-xs text-muted">Desc. %<Input type="number" min="0" max="100" defaultValue={it.discount_pct} className="h-8 w-16 text-right" aria-label="Descuento"
              onBlur={(e) => num(e.target.value) !== Number(it.discount_pct) && void onUpdate({ discount_pct: Math.min(100, num(e.target.value) || 0) })} /></label>
          </>}
          <span className="ml-auto font-semibold tabular-nums">{money(Number(it.line_total))}</span>
          {!locked && <button onClick={() => void onRemove()} className="rounded-lg p-1.5 text-muted hover:text-danger" aria-label="Quitar línea"><Trash2 className="size-4" /></button>}
        </div>
      </div>
    </li>
  );
}
