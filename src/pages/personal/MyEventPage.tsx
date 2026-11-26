import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ImagePlus, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EVENT_CATEGORIES, fromLocalInput, publicMediaUrl, toLocalInput, uploadImage, useCurrentEvent, type EventRow } from "@/lib/events";
import { formatDate, formatMoney } from "@/lib/format";
import { useWorkspaceEntitlements } from "@/lib/queries";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

const STATUS: Record<EventRow["status"], { label: string; tone: "info" | "ok" | "neutral" | "danger" }> = {
  planning: { label: "En organización", tone: "info" }, confirmed: { label: "Confirmado", tone: "ok" },
  done: { label: "Realizado", tone: "neutral" }, canceled: { label: "Cancelado", tone: "danger" },
};

export default function MyEventPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { events, event: current, isLoading, select } = useCurrentEvent(ws.id);
  const { data: ent } = useWorkspaceEntitlements(ws.id);
  const [editing, setEditing] = useState<EventRow | "new" | null>(null);
  const max = ent?.find((e) => e.feature_key === "events.max")?.limit_value ?? null;
  const canAdd = !readOnly && (max === null || events.length < max);

  if (isLoading) return <Spinner />;
  return (
    <div className="animate-rise">
      <PageHeader title={events.length > 1 ? "Mis eventos" : "Mi evento"}
        description="Los datos principales de tu celebración. Aparecen en tu invitación digital."
        actions={events.length > 0 && canAdd && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo evento</Button>} />
      {events.length > 0 && !canAdd && !readOnly && max !== null && (
        <div className="mb-4"><Alert tone="info">Tu plan permite {max} evento(s). Para organizar más, solicita un cambio de plan.</Alert></div>
      )}
      {events.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarDays className="size-6" />} title="Aún no has creado tu evento"
            action={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Crear mi evento</Button>}>
            Empieza con el nombre, la fecha y el lugar. Podrás completar el resto cuando quieras.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {events.map((e) => {
            const cover = publicMediaUrl(e.cover_path);
            return (
              <Card key={e.id} className={cx("overflow-hidden", current?.id === e.id && events.length > 1 && "ring-2 ring-[var(--accent)]")}>
                <div className="relative aspect-[16/7] bg-[var(--accent-soft)]">
                  {cover ? <img src={cover} alt="" className="size-full object-cover" /> : (
                    <div className="grid size-full place-items-center font-display text-5xl text-[var(--accent)]/40">{e.name.charAt(0)}</div>
                  )}
                  <Badge tone={STATUS[e.status].tone} className="absolute left-4 top-4 shadow-sm">{STATUS[e.status].label}</Badge>
                </div>
                <div className="p-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">{EVENT_CATEGORIES[e.category]}</div>
                  <h2 className="mt-1 font-display text-2xl font-semibold">{e.name}</h2>
                  {e.honorees && <p className="text-sm text-muted">{e.honorees}</p>}
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex gap-2"><CalendarDays className="mt-0.5 size-4 shrink-0 text-faint" />
                      <span>{e.starts_at ? formatDate(e.starts_at, { timeZone: region.timezone, locale: region.locale, withTime: true }) : "Fecha por definir"}</span></div>
                    <div className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-faint" />
                      <span>{e.venue_name ?? "Lugar por definir"}{e.venue_address ? ` · ${e.venue_address}` : ""}</span></div>
                  </dl>
                  <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                    <span className="text-sm text-muted">Presupuesto <strong className="text-ink tabular-nums">{formatMoney(e.budget, e.currency_code, region.locale)}</strong></span>
                    <div className="flex gap-2">
                      {events.length > 1 && current?.id !== e.id && <Button size="sm" variant="ghost" onClick={() => select(e.id)}>Trabajar en este</Button>}
                      {!readOnly && <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(e)}>Editar</Button>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <EventDialog event={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { select(id); setEditing(null); }} />}
    </div>
  );
}

function EventDialog({ event, onClose, onSaved }: { event: EventRow | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { ws, region } = useWorkspace();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    name: event?.name ?? "", category: event?.category ?? "boda", honorees: event?.honorees ?? "",
    starts_at: toLocalInput(event?.starts_at ?? null, region.timezone), ends_at: toLocalInput(event?.ends_at ?? null, region.timezone),
    venue_name: event?.venue_name ?? "", venue_address: event?.venue_address ?? "", venue_map_url: event?.venue_map_url ?? "",
    budget: String(event?.budget ?? ""), currency_code: event?.currency_code ?? region.currency_code,
    description: event?.description ?? "", status: event?.status ?? "planning",
  });
  const [cover, setCover] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const preview = cover ? URL.createObjectURL(cover) : publicMediaUrl(event?.cover_path);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 2) return setError("Escribe el nombre del evento.");
    if (f.venue_map_url && !/^https:\/\//i.test(f.venue_map_url)) return setError("El enlace del mapa debe empezar con https://");
    setBusy(true);
    try {
      const row = {
        name: f.name.trim(), category: f.category, honorees: f.honorees.trim() || null,
        starts_at: fromLocalInput(f.starts_at, region.timezone), ends_at: fromLocalInput(f.ends_at, region.timezone),
        venue_name: f.venue_name.trim() || null, venue_address: f.venue_address.trim() || null, venue_map_url: f.venue_map_url.trim() || null,
        budget: Number(f.budget) || 0, currency_code: f.currency_code, description: f.description.trim() || null, status: f.status,
      };
      const res = event
        ? await supabase.from("events").update(row).eq("id", event.id).select("id").single()
        : await supabase.from("events").insert({ ...row, workspace_id: ws.id }).select("id").single();
      if (res.error) throw new Error(res.error.message);
      const id = (res.data as { id: string }).id;
      if (cover) {
        const path = await uploadImage("event-media", `${ws.id}/events/${id}/portada-${Date.now()}.webp`, cover, 1800);
        const { error: upErr } = await supabase.from("events").update({ cover_path: path }).eq("id", id);
        if (upErr) throw new Error(upErr.message);
        if (event?.cover_path) await supabase.storage.from("event-media").remove([event.cover_path]);
      }
      await qc.invalidateQueries({ queryKey: ["events", ws.id] });
      onSaved(id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!event || !confirm(`¿Eliminar "${event.name}" con todos sus invitados, presupuesto y tareas? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    const { error: err } = await supabase.from("events").delete().eq("id", event.id);
    if (err) { setBusy(false); return setError(err.message); }
    if (event.cover_path) await supabase.storage.from("event-media").remove([event.cover_path]);
    await qc.invalidateQueries({ queryKey: ["events", ws.id] });
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={event ? "Editar evento" : "Nuevo evento"} wide
      footer={<>
        {event && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()} disabled={busy}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="event-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="event-form" onSubmit={submit} className="space-y-5">
        <button type="button" onClick={() => fileRef.current?.click()}
          className="relative grid aspect-[16/6] w-full place-items-center overflow-hidden rounded-xl border-2 border-dashed border-line-strong bg-paper text-sm text-muted hover:border-[var(--accent)]">
          {preview ? <img src={preview} alt="" className="absolute inset-0 size-full object-cover" /> : null}
          <span className={cx("relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5", preview && "bg-black/55 text-white")}>
            <ImagePlus className="size-4" /> {preview ? "Cambiar foto de portada" : "Agregar foto de portada"}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Nombre del evento">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Boda de María y José" />}</Field></div>
          <Field label="Tipo de evento">{(id) => <Select id={id} value={f.category} onChange={(e) => set("category", e.target.value)}>{Object.entries(EVENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Festejado(s)" optional>{(id) => <Input id={id} value={f.honorees} onChange={(e) => set("honorees", e.target.value)} placeholder="Ej. Sofía Martínez" />}</Field>
          <Field label="Inicio">{(id) => <Input id={id} type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} />}</Field>
          <Field label="Fin" optional>{(id) => <Input id={id} type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} />}</Field>
          <Field label="Lugar" optional>{(id) => <Input id={id} value={f.venue_name} onChange={(e) => set("venue_name", e.target.value)} placeholder="Ej. Salón Las Palmas" />}</Field>
          <Field label="Dirección" optional>{(id) => <Input id={id} value={f.venue_address} onChange={(e) => set("venue_address", e.target.value)} />}</Field>
          <div className="sm:col-span-2"><Field label="Enlace de Google Maps" optional hint="Aparece como botón “Cómo llegar” en la invitación.">{(id, d) => <Input id={id} aria-describedby={d} value={f.venue_map_url} onChange={(e) => set("venue_map_url", e.target.value)} placeholder="https://maps.app.goo.gl/…" />}</Field></div>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <Field label="Presupuesto estimado">{(id) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} />}</Field>
            <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option>NIO</option><option>USD</option></Select>}</Field>
          </div>
          <Field label="Estado">{(id) => <Select id={id} value={f.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
          <div className="sm:col-span-2"><Field label="Descripción" optional>{(id) => <Textarea id={id} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field></div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
