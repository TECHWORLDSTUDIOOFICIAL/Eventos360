import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Copy, FileSignature, MessageCircle, Plus, Printer, Save, Search, Send, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { useEvents } from "@/lib/events";
import { CONTRACT_STATUS, CONTRACT_STYLES, CONTRACT_TEMPLATES, DEFAULT_CONTRACT, TEMPLATE_VARS, contractUrl, docNumber, fillTemplate, useContracts, useCustomers, useQuotes, waNumber, type Contract, type ContractStyle } from "@/lib/pro";
import { formatDate, formatMoney } from "@/lib/format";
import { workspacePath } from "@/lib/modalities";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

interface Template { id: string; name: string; body: string }

export default function ContractsPage() {
  const { itemId } = useParams();
  if (itemId === "nuevo") return <NewContract />;
  return itemId ? <ContractEditor id={itemId} /> : <ContractList />;
}

const useTemplates = (wsId: string) =>
  useQuery({ queryKey: ["contract-templates", wsId], queryFn: async () => unwrap<Template[]>(await supabase.from("contract_templates").select("id, name, body").eq("workspace_id", wsId).order("name")) });

function ContractList() {
  const { ws, region, readOnly } = useWorkspace();
  const { data, isLoading } = useContracts(ws.id);
  const { data: customers } = useCustomers(ws.id);
  const [q, setQ] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const cust = (id: string) => customers?.find((c) => c.id === id)?.name ?? "";
  const list = useMemo(() => (data ?? []).filter((k) => !q || `${docNumber("CON", k.number)} ${k.title} ${cust(k.customer_id)}`.toLowerCase().includes(q.toLowerCase())), [data, q, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="animate-rise">
      <PageHeader title="Contratos" description="Genera contratos desde tus plantillas, envíalos por enlace y registra la aceptación del cliente con evidencia."
        actions={<>
          {!readOnly && <Button variant="secondary" onClick={() => setTplOpen(true)}>Plantillas</Button>}
          {!readOnly && <Link to={workspacePath(ws.kind, ws.id, "m/contracts/nuevo")}><Button variant="accent" icon={<Plus className="size-4" />}>Nuevo contrato</Button></Link>}
        </>} />
      <Card>
        <div className="border-b border-line p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato" className="h-10 pl-9" />
          </div>
        </div>
        {isLoading ? <Spinner /> : !data?.length ? (
          <EmptyState icon={<FileSignature className="size-6" />} title="Aún no tienes contratos"
            action={!readOnly && <Link to={workspacePath(ws.kind, ws.id, "m/contracts/nuevo")}><Button variant="accent">Crear contrato</Button></Link>}>
            Lo más práctico: acepta una cotización y desde ahí pulsa "Crear contrato"; los datos se llenan solos.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((k) => (
              <li key={k.id}><Link to={workspacePath(ws.kind, ws.id, `m/contracts/${k.id}`)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper sm:px-5">
                <span className="w-20 font-mono text-xs text-muted">{docNumber("CON", k.number)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{k.title}</span><span className="block truncate text-xs text-muted">{cust(k.customer_id)}{k.accepted_at ? ` · firmado ${formatDate(k.accepted_at, { timeZone: region.timezone })}` : ""}</span></span>
                {k.amount != null && <span className="tabular-nums">{formatMoney(Number(k.amount), k.currency_code, region.locale)}</span>}
                <Badge tone={CONTRACT_STATUS[k.status].tone}>{CONTRACT_STATUS[k.status].label}</Badge>
              </Link></li>
            ))}
          </ul>
        )}
      </Card>
      {tplOpen && <TemplatesDialog onClose={() => setTplOpen(false)} />}
    </div>
  );
}

function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const { ws } = useWorkspace();
  const qc = useQueryClient();
  const { data } = useTemplates(ws.id);
  const [sel, setSel] = useState<Template | "new" | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (sel === "new") { setName("Contrato estándar"); setBody(DEFAULT_CONTRACT); }
    else if (sel) { setName(sel.name); setBody(sel.body); }
  }, [sel]);
  async function save() {
    if (name.trim().length < 2 || body.trim().length < 10) return setError("Escribe un nombre y el texto de la plantilla.");
    const res = sel === "new" ? await supabase.from("contract_templates").insert({ workspace_id: ws.id, name: name.trim(), body })
      : await supabase.from("contract_templates").update({ name: name.trim(), body }).eq("id", (sel as Template).id);
    if (res.error) return setError(res.error.message);
    await qc.invalidateQueries({ queryKey: ["contract-templates", ws.id] });
    setSel(null);
  }
  async function remove(t: Template) {
    if (!confirm(`¿Eliminar la plantilla "${t.name}"?`)) return;
    await supabase.from("contract_templates").delete().eq("id", t.id);
    await qc.invalidateQueries({ queryKey: ["contract-templates", ws.id] });
  }
  return (
    <Dialog open onClose={onClose} title="Plantillas de contrato" wide
      footer={sel ? <><Button variant="secondary" onClick={() => setSel(null)}>Volver</Button><Button variant="accent" icon={<Save className="size-4" />} onClick={() => void save()}>Guardar plantilla</Button></> : <Button onClick={onClose}>Listo</Button>}>
      {sel ? (
        <div className="space-y-3">
          <Field label="Nombre">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Texto">{(id) => <Textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-80 font-mono text-[13px]" />}</Field>
          <VarsHelp />
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-line rounded-xl border border-line">
            {(data ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <button className="font-medium hover:underline" onClick={() => setSel(t)}>{t.name}</button>
                <button onClick={() => void remove(t)} className="text-muted hover:text-danger" aria-label={`Eliminar ${t.name}`}><Trash2 className="size-4" /></button>
              </li>
            ))}
            {!data?.length && <li className="px-4 py-4 text-sm text-muted">Sin plantillas propias. Se usará el contrato estándar de Eventos360.</li>}
          </ul>
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setSel("new")}>Nueva plantilla</Button>
        </div>
      )}
    </Dialog>
  );
}

function VarsHelp() {
  return (
    <details className="rounded-xl bg-paper px-4 py-3 text-xs text-muted">
      <summary className="cursor-pointer font-semibold text-ink">Datos automáticos disponibles</summary>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">{TEMPLATE_VARS.map(([k, l]) => <li key={k}><code className="text-ink">{`{{${k}}}`}</code> {l}</li>)}</ul>
    </details>
  );
}

function NewContract() {
  const { ws, region } = useWorkspace();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: customers } = useCustomers(ws.id);
  const { data: events } = useEvents(ws.id);
  const { data: quotes } = useQuotes(ws.id);
  const { data: templates } = useTemplates(ws.id);
  const biz = useQuery({ queryKey: ["ws-biz", ws.id], queryFn: async () => unwrap<{ name: string; legal_name: string | null; tax_id: string | null }>(await supabase.from("workspaces").select("name, legal_name, tax_id").eq("id", ws.id).single()) });
  const fromQuote = quotes?.find((q) => q.id === params.get("cotizacion"));
  const [f, setF] = useState({ customer_id: params.get("cliente") ?? "", event_id: params.get("evento") ?? "", quote_id: params.get("cotizacion") ?? "", template: CONTRACT_TEMPLATES[0]!.key, style: "clasica" as ContractStyle, title: "Contrato de prestación de servicios" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (fromQuote) setF((s) => ({ ...s, customer_id: fromQuote.customer_id, event_id: fromQuote.event_id ?? "", quote_id: fromQuote.id })); }, [fromQuote]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = customers?.find((x) => x.id === f.customer_id);
    if (!c) return setError("Elige el cliente.");
    const ev = events?.find((x) => x.id === f.event_id);
    const q = quotes?.find((x) => x.id === f.quote_id);
    const tpl = CONTRACT_TEMPLATES.find((t) => t.key === f.template)?.body ?? templates?.find((t) => t.id === f.template)?.body ?? DEFAULT_CONTRACT;
    const cur = q?.currency_code ?? ev?.currency_code ?? region.currency_code;
    const m = (n: number) => formatMoney(n, cur, region.locale);
    const body = fillTemplate(tpl, {
      cliente: c.name, cliente_identificacion: c.tax_id ?? "__________", cliente_direccion: c.address ?? "__________",
      evento: ev?.name ?? "__________", fecha_evento: ev?.starts_at ? formatDate(ev.starts_at, { timeZone: region.timezone, locale: region.locale, withTime: true }) : "__________",
      lugar: [ev?.venue_name, ev?.venue_address].filter(Boolean).join(", ") || "__________", invitados: ev?.guests_estimate ? String(ev.guests_estimate) : "__________",
      monto: q ? m(Number(q.total)) : "__________", anticipo: q ? m(Math.round(Number(q.total) * Number(q.deposit_pct)) / 100) : "__________",
      organizador: biz.data?.legal_name || biz.data?.name || ws.name, organizador_identificacion: biz.data?.tax_id ?? "__________",
      fecha_hoy: formatDate(new Date(), { timeZone: region.timezone, locale: region.locale }),
    });
    setBusy(true);
    const { data, error: err } = await supabase.from("contracts").insert({
      workspace_id: ws.id, customer_id: c.id, event_id: f.event_id || null, quote_id: f.quote_id || null, title: f.title.trim() || "Contrato",
      body, amount: q ? Number(q.total) : null, currency_code: cur, template: f.style,
    }).select("id").single();
    setBusy(false);
    if (err) return setError(err.message);
    await qc.invalidateQueries({ queryKey: ["contracts", ws.id] });
    navigate(workspacePath(ws.kind, ws.id, `m/contracts/${(data as { id: string }).id}`), { replace: true });
  }

  return (
    <div className="animate-rise mx-auto max-w-xl">
      <PageHeader title="Nuevo contrato" description="Se llena automáticamente con los datos del cliente, el evento y la cotización. Luego puedes editar el texto." />
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Cliente">{(id) => <Select id={id} value={f.customer_id} onChange={(e) => setF((s) => ({ ...s, customer_id: e.target.value, event_id: "", quote_id: "" }))}><option value="">Elegir…</option>{(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Evento" optional>{(id) => <Select id={id} value={f.event_id} onChange={(e) => setF((s) => ({ ...s, event_id: e.target.value }))}><option value="">Sin evento</option>{(events ?? []).filter((e) => e.customer_id === f.customer_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>}</Field>
          <Field label="Cotización" optional hint="Toma el monto y el anticipo de aquí.">{(id, d) => <Select id={id} aria-describedby={d} value={f.quote_id} onChange={(e) => setF((s) => ({ ...s, quote_id: e.target.value }))}><option value="">Ninguna</option>{(quotes ?? []).filter((q) => q.customer_id === f.customer_id).map((q) => <option key={q.id} value={q.id}>{docNumber("COT", q.number)} · {q.title}</option>)}</Select>}</Field>
          <div>
            <div className="mb-1.5 text-sm font-medium">Tipo de contrato</div>
            <div className="space-y-2">
              {[...CONTRACT_TEMPLATES.map((t) => ({ id: t.key, name: t.name, description: t.description })), ...(templates ?? []).map((t) => ({ id: t.id, name: t.name, description: "Tu plantilla" }))].map((t) => (
                <label key={t.id} className={cx("flex cursor-pointer gap-3 rounded-xl border p-3", f.template === t.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-line")}>
                  <input type="radio" name="tpl" checked={f.template === t.id} onChange={() => setF((s) => ({ ...s, template: t.id, title: CONTRACT_TEMPLATES.find((x) => x.key === t.id)?.name ?? s.title }))} className="mt-1 accent-ink" />
                  <span><span className="block text-sm font-semibold">{t.name}</span><span className="block text-xs text-muted">{t.description}</span></span>
                </label>
              ))}
            </div>
          </div>
          <Field label="Diseño">{(id) => <Select id={id} value={f.style} onChange={(e) => setF((s) => ({ ...s, style: e.target.value as ContractStyle }))}>{(Object.keys(CONTRACT_STYLES) as ContractStyle[]).map((k) => <option key={k} value={k}>{CONTRACT_STYLES[k].name} — {CONTRACT_STYLES[k].description}</option>)}</Select>}</Field>
          <Field label="Título">{(id) => <Input id={id} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} />}</Field>
          <Alert tone="info">El contrato estándar es un modelo general. Revísalo y adáptalo a tu negocio; para casos importantes consulta con un abogado.</Alert>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="accent" className="w-full" loading={busy || biz.isLoading} disabled={!f.customer_id || !biz.data || !quotes || !events}>Generar contrato</Button>
        </form>
      </Card>
    </div>
  );
}

function ContractEditor({ id }: { id: string }) {
  const { ws, region, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: customers } = useCustomers(ws.id);
  const k = useQuery({ queryKey: ["contract", id], queryFn: async () => unwrap<Contract>(await supabase.from("contracts").select("*").eq("id", id).single()) });
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  useEffect(() => { if (k.data) { setBody(k.data.body); setTitle(k.data.title); } }, [k.data]);
  if (k.isLoading) return <Spinner />;
  const c = k.data;
  if (!c) return <Card><EmptyState title="Contrato no encontrado" /></Card>;
  const customer = customers?.find((x) => x.id === c.customer_id);
  const editable = !readOnly && c.status === "draft";
  const dirty = body !== c.body || title !== c.title;
  const url = contractUrl(c.public_token);
  const base = (p: string) => workspacePath(ws.kind, ws.id, p);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["contract", id] }), qc.invalidateQueries({ queryKey: ["contracts", ws.id] })]);

  async function update(patch: Partial<Contract>, ok?: string) {
    const { error } = await supabase.from("contracts").update(patch).eq("id", id);
    if (error) return setMsg({ tone: "danger", text: error.message });
    await refresh();
    if (ok) setMsg({ tone: "ok", text: ok });
  }
  async function remove() {
    if (!confirm(`¿Eliminar ${docNumber("CON", c!.number)}?`)) return;
    const { error } = await supabase.from("contracts").delete().eq("id", id);
    if (error) return setMsg({ tone: "danger", text: error.message });
    await qc.invalidateQueries({ queryKey: ["contracts", ws.id] });
    navigate(base("m/contracts"));
  }
  const share = `Hola ${customer?.name ?? ""}, te comparto el contrato ${docNumber("CON", c.number)} para tu revisión y aceptación: ${url}`;

  return (
    <div className="animate-rise">
      <Link to={base("m/contracts")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Contratos</Link>
      <PageHeader eyebrow={<span className="inline-flex items-center gap-2">{docNumber("CON", c.number)} <Badge tone={CONTRACT_STATUS[c.status].tone}>{CONTRACT_STATUS[c.status].label}</Badge></span>}
        title={c.title} description={customer ? <Link to={base(`m/customers/${customer.id}`)} className="hover:underline">{customer.name}</Link> : undefined}
        actions={<>
          <Link to={base(`imprimir/contrato?id=${id}`)}><Button variant="secondary" icon={<Printer className="size-4" />}>PDF</Button></Link>
          {editable && dirty && <Button variant="secondary" icon={<Save className="size-4" />} onClick={() => void update({ body, title: title.trim() || c.title }, "Cambios guardados.")}>Guardar</Button>}
          {editable && <Button variant="accent" icon={<Send className="size-4" />} onClick={() => void update({ body, title: title.trim() || c.title, status: "sent" }, "Contrato listo: comparte el enlace para que tu cliente lo firme, o imprímelo para firmarlo en papel.")}>Enviar al cliente</Button>}
          {!readOnly && c.status === "sent" && <Button variant="ghost" onClick={() => void update({ status: "draft" })}>Volver a borrador</Button>}
          {!readOnly && c.status === "accepted" && <Button variant="ghost" className="text-danger" icon={<Ban className="size-4" />} onClick={() => confirm("¿Cancelar este contrato firmado? Quedará registrado como cancelado.") && void update({ status: "canceled" })}>Cancelar contrato</Button>}
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert></div>}

      {c.status === "accepted" && (
        <Card className="mb-6 border-ok/30 bg-ok-soft/40 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" />
            <div className="text-sm">
              <div className="font-semibold">Firmado por {c.accepted_name}{c.accepted_id_doc ? ` (identificación ${c.accepted_id_doc})` : ""}</div>
              <div className="text-ink-soft">{formatDate(c.accepted_at, { timeZone: region.timezone, withTime: true })}{c.accepted_ip ? ` · IP ${c.accepted_ip}` : ""}</div>
              <div className="mt-1 break-all font-mono text-[11px] text-muted">Huella del texto aceptado (SHA-256): {c.accepted_hash}</div>
            </div>
          </div>
        </Card>
      )}
      {c.status === "sent" && (
        <Card className="mb-6 p-4">
          <div className="text-sm font-semibold">Enlace para tu cliente</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} className="h-10 min-w-0 flex-1 text-xs" aria-label="Enlace del contrato" />
            <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(url).then(() => setMsg({ tone: "ok", text: "Enlace copiado." }))}>Copiar</Button>
            <a href={`https://wa.me/${waNumber(customer?.phone)}?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer"><Button variant="secondary" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>WhatsApp</Button></a>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Texto del contrato" description={editable ? "Puedes editarlo mientras esté en borrador." : "El texto ya no se puede modificar."}
          action={!readOnly && c.status !== "canceled" && (
            <div className="flex flex-wrap items-center gap-3">
              <Select value={c.template} onChange={(e) => void update({ template: e.target.value as ContractStyle })} className="h-9 w-auto text-sm" aria-label="Diseño del contrato">
                {(Object.keys(CONTRACT_STYLES) as ContractStyle[]).map((k) => <option key={k} value={k}>Diseño: {CONTRACT_STYLES[k].name}</option>)}
              </Select>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={c.include_provider_signature} onChange={(e) => void update({ include_provider_signature: e.target.checked })} className="size-4 accent-ink" />Incluir mi firma</label>
            </div>
          )} />
        <div className="space-y-3 p-4">
          {editable && <Field label="Título">{(i) => <Input id={i} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>}
          {editable ? <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[28rem] font-[inherit] text-[14px] leading-relaxed" aria-label="Texto del contrato" />
            : <div className="whitespace-pre-line rounded-xl bg-paper p-5 text-[14px] leading-relaxed">{c.body}</div>}
          {editable && body.includes("__________") && <Alert tone="info">Hay datos por completar (marcados con ____). Complétalos aquí o en la ficha del cliente/evento antes de enviar.</Alert>}
        </div>
      </Card>
      {!readOnly && c.status !== "accepted" && <button className="mt-4 inline-flex items-center gap-1 text-xs text-muted hover:text-danger" onClick={() => void remove()}><Trash2 className="size-3.5" />Eliminar contrato</button>}
    </div>
  );
}
