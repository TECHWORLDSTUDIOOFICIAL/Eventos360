import { useMemo, useRef, useState, type FormEvent } from "react";
import { Download, FileSpreadsheet, Link2, MessageCircle, Pencil, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { GUEST_STATUS, guestName, invitationUrl, useEventTables, useGuestGroups, useGuests, useInvalidateEvent, type EventRow, type GuestRow } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

export default function GuestsPage() {
  return <EventGate>{(ctx) => <Guests {...ctx} />}</EventGate>;
}

function Guests({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { readOnly } = useWorkspace();
  const { data: guests, isLoading } = useGuests(event.id);
  const { data: groups } = useGuestGroups(event.id);
  const { data: tables } = useEventTables(event.id);
  const invalidate = useInvalidateEvent();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [group, setGroup] = useState("");
  const [editing, setEditing] = useState<GuestRow | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useMemo(() => (guests ?? []).filter((g) => {
    if (status && g.status !== status) return false;
    if (group && (group === "none" ? g.group_id : g.group_id !== group)) return false;
    if (q) {
      const t = `${guestName(g)} ${g.phone ?? ""} ${g.email ?? ""}`.toLowerCase();
      if (!t.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [guests, status, group, q]);

  const all = guests ?? [];
  const confirmed = all.filter((g) => g.status === "confirmed");
  const stats = {
    total: all.length,
    invitedPeople: all.filter((g) => g.status !== "declined").reduce((s, g) => s + g.max_companions + 1, 0),
    confirmedPeople: confirmed.reduce((s, g) => s + g.adults + g.children, 0),
    adults: confirmed.reduce((s, g) => s + g.adults, 0),
    children: confirmed.reduce((s, g) => s + g.children, 0),
    pending: all.filter((g) => g.status === "pending" || g.status === "invited").length,
    declined: all.filter((g) => g.status === "declined").length,
  };
  const groupName = (id: string | null) => groups?.find((g) => g.id === id)?.name;
  const tableName = (id: string | null) => tables?.find((t) => t.id === id)?.name;

  async function exportExcel() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const header = ["Nombre", "Apellido", "Teléfono", "Correo", "Grupo", "Acompañantes permitidos", "Estado", "Adultos", "Niños", "Mesa", "Notas", "Mensaje del invitado", "Enlace de invitación"]
      .map((value) => ({ value, fontWeight: "bold" as const }));
    const rows = all.map((g) => [
      g.first_name, g.last_name ?? "", g.phone ?? "", g.email ?? "", groupName(g.group_id) ?? "", g.max_companions,
      GUEST_STATUS[g.status].label, g.status === "confirmed" ? g.adults : "", g.status === "confirmed" ? g.children : "",
      tableName(g.table_id) ?? "", g.notes ?? "", g.rsvp_message ?? "", invitationUrl(g.invite_token),
    ].map((value) => ({ value: value as string | number })));
    await writeXlsxFile([header, ...rows], { columns: [{ width: 16 }, { width: 16 }, { width: 14 }, { width: 22 }, { width: 16 }, { width: 12 }, { width: 14 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 24 }, { width: 24 }, { width: 50 }] })
      .toFile(`Invitados - ${event.name}.xlsx`);
  }

  async function markInvited(g: GuestRow) {
    if (g.status === "pending") {
      await supabase.from("guests").update({ status: "invited" }).eq("id", g.id);
      await invalidate(event.id, "guests");
    }
  }

  async function copyLink(g: GuestRow) {
    try {
      await navigator.clipboard.writeText(invitationUrl(g.invite_token));
      setNotice(`Enlace de ${guestName(g)} copiado.`);
      await markInvited(g);
    } catch { setNotice("No se pudo copiar automáticamente."); }
  }

  function whatsapp(g: GuestRow) {
    const text = `¡Hola ${g.first_name}! Te invitamos a ${event.name}. Mira tu invitación y confirma tu asistencia aquí: ${invitationUrl(g.invite_token)}`;
    const phone = (g.phone ?? "").replace(/\D/g, "");
    const num = phone.length === 8 ? `505${phone}` : phone;   // números locales de Nicaragua
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    void markInvited(g);
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Invitados" description={event.name}
        actions={<>
          <EventSwitcher events={events} current={event} onSelect={select} />
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportExcel()} disabled={!all.length}>Exportar</Button>
          {!readOnly && <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>Importar</Button>}
          {!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agregar invitado</Button>}
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Invitaciones", v: stats.total, h: `${stats.invitedPeople} personas invitadas` },
          { l: "Confirmados", v: stats.confirmedPeople, h: `${stats.adults} adultos · ${stats.children} niños` },
          { l: "Pendientes", v: stats.pending, h: "Sin responder" },
          { l: "No asistirán", v: stats.declined, h: "Invitaciones declinadas" },
        ].map((s) => (
          <Card key={s.l} className="p-4">
            <div className="text-xs font-medium text-muted">{s.l}</div>
            <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{s.v}</div>
            <div className="text-xs text-muted">{s.h}</div>
          </Card>
        ))}
      </div>

      {notice && <div className="mb-4"><Alert tone="ok" onClose={() => setNotice(null)}>{notice}</Alert></div>}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar invitado" className="h-10 pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-auto" aria-label="Estado">
            <option value="">Todos los estados</option>
            {Object.entries(GUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select value={group} onChange={(e) => setGroup(e.target.value)} className="h-10 w-auto" aria-label="Grupo">
            <option value="">Todos los grupos</option>
            <option value="none">Sin grupo</option>
            {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </div>
        {isLoading ? <Spinner /> : !all.length ? (
          <EmptyState icon={<Users className="size-6" />} title="Tu lista de invitados está vacía"
            action={!readOnly && <div className="flex flex-wrap justify-center gap-2">
              <Button variant="accent" onClick={() => setEditing("new")}>Agregar invitado</Button>
              <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => setImportOpen(true)}>Importar desde Excel</Button>
            </div>}>
            Agrega a cada invitado (o a cada familia) con el número de acompañantes que le permites llevar.
          </EmptyState>
        ) : !list.length ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Ningún invitado coincide con los filtros.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{guestName(g)}</span>
                    <Badge tone={GUEST_STATUS[g.status].tone}>{GUEST_STATUS[g.status].label}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {[groupName(g.group_id), g.max_companions ? `+${g.max_companions} acompañante(s)` : "Sin acompañantes",
                      g.status === "confirmed" ? `${g.adults} adulto(s)${g.children ? ` · ${g.children} niño(s)` : ""}` : null,
                      tableName(g.table_id), g.phone].filter(Boolean).join(" · ")}
                  </div>
                  {g.rsvp_message && <div className="mt-1 text-xs italic text-ink-soft">“{g.rsvp_message}”</div>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => whatsapp(g)} className="rounded-lg p-2 text-[#1f8b4c] hover:bg-[#1f8b4c]/10" title="Enviar invitación por WhatsApp" aria-label={`Enviar invitación a ${guestName(g)} por WhatsApp`}><MessageCircle className="size-4" /></button>
                  <button onClick={() => void copyLink(g)} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" title="Copiar enlace de invitación" aria-label={`Copiar enlace de ${guestName(g)}`}><Link2 className="size-4" /></button>
                  {!readOnly && <button onClick={() => setEditing(g)} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" title="Editar" aria-label={`Editar ${guestName(g)}`}><Pencil className="size-4" /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">Los enlaces de invitación funcionan cuando publiques tu invitación en el módulo Invitaciones.</p>

      {editing && <GuestDialog event={event} guest={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {importOpen && <ImportDialog event={event} onClose={() => setImportOpen(false)} onDone={(n) => { setImportOpen(false); setNotice(`Se importaron ${n} invitado(s).`); }} />}
    </div>
  );
}

function GuestDialog({ event, guest, onClose }: { event: EventRow; guest: GuestRow | null; onClose: () => void }) {
  const { ws } = useWorkspace();
  const { data: groups } = useGuestGroups(event.id);
  const invalidate = useInvalidateEvent();
  const [f, setF] = useState({
    first_name: guest?.first_name ?? "", last_name: guest?.last_name ?? "", phone: guest?.phone ?? "", email: guest?.email ?? "",
    group_id: guest?.group_id ?? "", new_group: "", max_companions: String(guest?.max_companions ?? 0),
    status: guest?.status ?? "pending", adults: String(guest?.adults ?? 1), children: String(guest?.children ?? 0), notes: guest?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.first_name.trim()) return setError("Escribe el nombre del invitado.");
    const maxC = Number(f.max_companions) || 0;
    const adults = f.status === "confirmed" ? Math.max(1, Number(f.adults) || 1) : 1;
    const children = f.status === "confirmed" ? Number(f.children) || 0 : 0;
    if (adults + children > maxC + 1) return setError(`Con ${maxC} acompañante(s) el máximo es ${maxC + 1} persona(s).`);
    setBusy(true);
    let groupId = f.group_id || null;
    if (f.group_id === "__new") {
      const name = f.new_group.trim();
      if (!name) { setBusy(false); return setError("Escribe el nombre del nuevo grupo."); }
      const r = await supabase.from("guest_groups").insert({ workspace_id: ws.id, event_id: event.id, name }).select("id").single();
      if (r.error) { setBusy(false); return setError(r.error.code === "23505" ? "Ya existe un grupo con ese nombre." : r.error.message); }
      groupId = (r.data as { id: string }).id;
    }
    const row = {
      first_name: f.first_name.trim(), last_name: f.last_name.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null,
      group_id: groupId, max_companions: maxC, status: f.status, adults, children, notes: f.notes.trim() || null,
    };
    const res = guest
      ? await supabase.from("guests").update(row).eq("id", guest.id)
      : await supabase.from("guests").insert({ ...row, workspace_id: ws.id, event_id: event.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate(event.id, "guests", "guest-groups");
    onClose();
  }

  async function remove() {
    if (!guest || !confirm(`¿Eliminar a ${guestName(guest)} de la lista?`)) return;
    const { error: err } = await supabase.from("guests").delete().eq("id", guest.id);
    if (err) return setError(err.message);
    await invalidate(event.id, "guests");
    onClose();
  }

  async function newLink() {
    if (!guest || !confirm("Se generará un enlace nuevo y el anterior dejará de funcionar. ¿Continuar?")) return;
    const { error: err } = await supabase.rpc("regenerate_invite_token", { p_guest_id: guest.id });
    if (err) return setError(err.message);
    await invalidate(event.id, "guests");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={guest ? "Editar invitado" : "Agregar invitado"} wide
      footer={<>
        {guest && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="guest-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="guest-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">{(id) => <Input id={id} value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus />}</Field>
        <Field label="Apellidos" optional>{(id) => <Input id={id} value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />}</Field>
        <Field label="Teléfono / WhatsApp" optional>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="8888 8888" />}</Field>
        <Field label="Correo" optional>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />}</Field>
        <Field label="Grupo familiar" optional>
          {(id) => (
            <Select id={id} value={f.group_id} onChange={(e) => set("group_id", e.target.value)}>
              <option value="">Sin grupo</option>
              {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="__new">+ Nuevo grupo…</option>
            </Select>
          )}
        </Field>
        {f.group_id === "__new" ? (
          <Field label="Nombre del nuevo grupo">{(id) => <Input id={id} value={f.new_group} onChange={(e) => set("new_group", e.target.value)} placeholder="Ej. Familia del novio" />}</Field>
        ) : (
          <Field label="Acompañantes permitidos" hint="Personas adicionales que puede llevar.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} max={20} value={f.max_companions} onChange={(e) => set("max_companions", e.target.value)} />}</Field>
        )}
        {f.group_id === "__new" && (
          <Field label="Acompañantes permitidos">{(id) => <Input id={id} type="number" min={0} max={20} value={f.max_companions} onChange={(e) => set("max_companions", e.target.value)} />}</Field>
        )}
        <Field label="Estado">{(id) => <Select id={id} value={f.status} onChange={(e) => set("status", e.target.value as GuestRow["status"])}>{Object.entries(GUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
        {f.status === "confirmed" && (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:max-w-sm">
            <Field label="Adultos">{(id) => <Input id={id} type="number" min={1} value={f.adults} onChange={(e) => set("adults", e.target.value)} />}</Field>
            <Field label="Niños">{(id) => <Input id={id} type="number" min={0} value={f.children} onChange={(e) => set("children", e.target.value)} />}</Field>
          </div>
        )}
        <div className="sm:col-span-2"><Field label="Observaciones" optional>{(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Alergias, mesa preferida, etc." />}</Field></div>
        {guest?.rsvp_message && <div className="sm:col-span-2"><Alert tone="info" title="Mensaje del invitado">{guest.rsvp_message}</Alert></div>}
        {guest && <button type="button" onClick={() => void newLink()} className="text-left text-xs text-muted underline hover:text-ink sm:col-span-2">Generar un enlace de invitación nuevo</button>}
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
      </form>
    </Dialog>
  );
}

const TEMPLATE_COLUMNS = ["Nombre", "Apellido", "Teléfono", "Correo", "Grupo", "Acompañantes", "Notas"];

function ImportDialog({ event, onClose, onDone }: { event: EventRow; onClose: () => void; onDone: (n: number) => void }) {
  const { ws } = useWorkspace();
  const invalidate = useInvalidateEvent();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<{ first_name: string; last_name: string | null; phone: string | null; email: string | null; group: string | null; max_companions: number; notes: string | null }[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function downloadTemplate() {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    await writeXlsxFile([
      TEMPLATE_COLUMNS.map((value) => ({ value, fontWeight: "bold" as const })),
      ["Ana", "Pérez", "88887777", "", "Familia de la novia", 2, ""].map((value) => ({ value: value as string | number })),
    ], { columns: TEMPLATE_COLUMNS.map(() => ({ width: 18 })) }).toFile("Plantilla de invitados.xlsx");
  }

  async function readFile(file: File) {
    setError(null);
    try {
      const { readSheet } = await import("read-excel-file/browser");
      const data = await readSheet(file);
      if (!data.length) throw new Error("El archivo está vacío.");
      const header = (data[0] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
      const col = { first: idx(["nombre"]), last: idx(["apellido"]), phone: idx(["teléfono", "telefono", "celular", "whatsapp"]),
        email: idx(["correo", "email"]), group: idx(["grupo", "familia"]), comp: idx(["acompañante", "acompanante"]), notes: idx(["nota", "observ"]) };
      if (col.first < 0) throw new Error("No encontramos la columna “Nombre”. Usa la plantilla.");
      const cell = (r: unknown[], i: number) => (i < 0 || r[i] == null ? "" : String(r[i]).trim());
      const warn: string[] = [];
      const parsed = data.slice(1).map((r, n) => {
        const first = cell(r, col.first);
        if (!first) return null;
        const comp = Number(cell(r, col.comp) || 0);
        if (Number.isNaN(comp) || comp < 0 || comp > 20) warn.push(`Fila ${n + 2}: acompañantes no válido, se usará 0.`);
        return {
          first_name: first.slice(0, 80), last_name: cell(r, col.last).slice(0, 80) || null, phone: cell(r, col.phone).slice(0, 30) || null,
          email: cell(r, col.email).slice(0, 160) || null, group: cell(r, col.group).slice(0, 80) || null,
          max_companions: Number.isNaN(comp) || comp < 0 || comp > 20 ? 0 : Math.floor(comp), notes: cell(r, col.notes).slice(0, 1000) || null,
        };
      }).filter((x): x is NonNullable<typeof x> => !!x);
      if (!parsed.length) throw new Error("No hay invitados en el archivo.");
      setRows(parsed);
      setWarnings(warn.slice(0, 5));
    } catch (e) {
      setRows([]);
      setError((e as Error).message || "No se pudo leer el archivo. Debe ser .xlsx");
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError(null);
    try {
      const { data: existing } = await supabase.from("guest_groups").select("id, name").eq("event_id", event.id);
      const map = new Map((existing ?? []).map((g) => [g.name.toLowerCase(), g.id as string]));
      const missing = [...new Set(rows.map((r) => r.group).filter((g): g is string => !!g && !map.has(g.toLowerCase())))];
      if (missing.length) {
        const r = await supabase.from("guest_groups").insert(missing.map((name) => ({ workspace_id: ws.id, event_id: event.id, name }))).select("id, name");
        if (r.error) throw new Error(r.error.message);
        for (const g of r.data ?? []) map.set(g.name.toLowerCase(), g.id);
      }
      const payload = rows.map(({ group, ...g }) => ({ ...g, workspace_id: ws.id, event_id: event.id, group_id: group ? map.get(group.toLowerCase()) ?? null : null }));
      const { error: err } = await supabase.from("guests").insert(payload);
      if (err) throw new Error(err.message);
      await invalidate(event.id, "guests", "guest-groups");
      onDone(payload.length);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Importar invitados desde Excel" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="accent" loading={busy} disabled={!rows.length} onClick={() => void confirmImport()}>Importar {rows.length || ""} invitado(s)</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Columnas reconocidas: {TEMPLATE_COLUMNS.join(", ")}. Solo “Nombre” es obligatoria. Los grupos nuevos se crean automáticamente.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void downloadTemplate()}>Descargar plantilla</Button>
          <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Elegir archivo .xlsx</Button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ""; }} />
        </div>
        {warnings.map((w) => <p key={w} className="text-xs text-warn">{w}</p>)}
        {rows.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper text-left text-xs text-muted"><tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Grupo</th><th className="px-3 py-2">Acomp.</th><th className="px-3 py-2">Teléfono</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className={cx(i % 2 === 1 && "bg-paper/40")}><td className="px-3 py-1.5">{r.first_name} {r.last_name}</td><td className="px-3 py-1.5">{r.group}</td><td className="px-3 py-1.5">{r.max_companions}</td><td className="px-3 py-1.5">{r.phone}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
