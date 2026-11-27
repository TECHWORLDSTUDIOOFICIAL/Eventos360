import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Copy, ExternalLink, ImagePlus, Link2, MessageCircle, Plus, Star, Trash2, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { publicMediaUrl, uploadImage } from "@/lib/events";
import { AMENITIES, SETUPS, VENUE_KINDS, maxCapacity, minutesText, useInvalidateVenues, useVenueParts, useVenues, venuePublicUrl, type SetupKey, type Venue } from "@/lib/venues";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from "@/components/ui";

const COLORS = ["#0f7468", "#3d4fc4", "#c2416b", "#b9802a", "#4a2c7a", "#2f6f3e", "#9a3b2f", "#1d1530"];

/** Espacios del local: capacidad por montaje, comodidades, qué incluye, reglas y fotos. */
export default function VenuesPage() {
  const { ws, readOnly } = useWorkspace();
  const { data, isLoading } = useVenues(ws.id, { includeInactive: true });
  const { data: parts } = useVenueParts(ws.id);
  const [editing, setEditing] = useState<Venue | "new" | null>(null);
  const partNames = (v: Venue) => (parts ?? []).filter((p) => p.venue_id === v.id).map((p) => data?.find((x) => x.id === p.part_id)?.name).filter(Boolean);

  return (
    <div className="animate-rise">
      <PageHeader title="Espacios" description="Tus salones, jardines y áreas: capacidad según el montaje, qué incluye, reglas y fotos."
        actions={!readOnly && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo espacio</Button>} />
      {isLoading ? <Spinner /> : !data?.length ? (
        <Card>
          <EmptyState icon={<Building2 className="size-6" />} title="Registra tu primer espacio"
            action={!readOnly && <Button variant="accent" onClick={() => setEditing("new")}>Agregar espacio</Button>}>
            Por ejemplo "Salón principal" o "Jardín". Indica cuántas personas caben según el montaje (banquete, auditorio, cóctel…). Si tienes salones que se pueden unir, también puedes crear el espacio combinado.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((v) => {
            const cover = publicMediaUrl(v.photos[0]);
            const combo = partNames(v);
            return (
              <button key={v.id} onClick={() => !readOnly && setEditing(v)} disabled={readOnly}
                className={cx("overflow-hidden rounded-2xl border border-line bg-card text-left shadow-[var(--shadow-card)] transition hover:border-line-strong", !v.is_active && "opacity-60")}>
                <div className="relative aspect-[16/9] bg-paper">
                  {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-faint"><Building2 className="size-10" /></div>}
                  <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ background: v.color }}>{VENUE_KINDS[v.kind] ?? v.kind}</span>
                  {v.photos.length > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] text-white">{v.photos.length} fotos</span>}
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2"><span className="font-semibold">{v.name}</span>{!v.is_active && <Badge>Inactivo</Badge>}</div>
                  {combo.length > 0 && <div className="text-xs text-muted">Une: {combo.join(" + ")}</div>}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                    {(Object.keys(SETUPS) as SetupKey[]).filter((k) => SETUPS[k].cap && v[SETUPS[k].cap!]).map((k) => (
                      <span key={k} className="inline-flex items-center gap-1"><Users className="size-3.5 text-faint" />{SETUPS[k].label}: <b>{v[SETUPS[k].cap!] as number}</b></span>
                    ))}
                    {!maxCapacity(v) && <span className="text-warn">Falta la capacidad</span>}
                  </div>
                  <div className="mt-2 text-xs text-muted">Montaje {minutesText(v.setup_minutes)} antes · desmontaje {minutesText(v.teardown_minutes)} después{v.amenities.length ? ` · ${v.amenities.length} comodidades` : ""}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {!!data?.length && <PublicLinkCard />}
      {editing && <VenueDialog venue={editing === "new" ? null : editing} all={data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Enlace público para que los clientes vean los espacios y envíen consultas (llegan a Reservas como "Consulta"). */
function PublicLinkCard() {
  const { ws, canManage, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const { data: token } = useQuery({ queryKey: ["booking-token", ws.id], queryFn: async () => unwrap<{ booking_token: string | null }>(await supabase.from("workspaces").select("booking_token").eq("id", ws.id).single()).booking_token });
  const [msg, setMsg] = useState<string | null>(null);
  async function set(enable: boolean) {
    if (!enable && !confirm("¿Desactivar el enlace? Quien lo tenga ya no podrá ver tus espacios ni enviar consultas.")) return;
    const { error } = await supabase.rpc("venue_public_link", { p_ws: ws.id, p_enable: enable });
    if (error) return setMsg(error.message);
    await qc.invalidateQueries({ queryKey: ["booking-token", ws.id] });
  }
  const url = token ? venuePublicUrl(token) : null;
  return (
    <Card className="mt-8">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Link2 className="size-4" />Página de consultas para tus clientes</span>}
        description="Compártela en WhatsApp, Instagram o Facebook: tus clientes ven los espacios, fotos, capacidad y fechas ocupadas, y te envían su consulta. Nunca se muestran datos de otros clientes." />
      <div className="p-4">
        {url ? (
          <div className="flex flex-wrap gap-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} className="h-10 min-w-0 flex-1 text-xs" aria-label="Enlace público" />
            <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(url).then(() => setMsg("Enlace copiado."))}>Copiar</Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Conoce nuestros espacios y consulta tu fecha aquí: ${url}`)}`} target="_blank" rel="noreferrer"><Button variant="secondary" icon={<MessageCircle className="size-4 text-[#1f8b4c]" />}>WhatsApp</Button></a>
            <a href={url} target="_blank" rel="noreferrer"><Button variant="secondary" icon={<ExternalLink className="size-4" />}>Ver</Button></a>
            {canManage && !readOnly && <Button variant="ghost" onClick={() => void set(false)}>Desactivar</Button>}
          </div>
        ) : canManage && !readOnly ? (
          <Button variant="accent" icon={<Link2 className="size-4" />} onClick={() => void set(true)}>Activar mi página de consultas</Button>
        ) : <p className="text-sm text-muted">El propietario o un administrador puede activarla.</p>}
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </div>
    </Card>
  );
}

function VenueDialog({ venue, all, onClose }: { venue: Venue | null; all: Venue[]; onClose: () => void }) {
  const { ws } = useWorkspace();
  const invalidate = useInvalidateVenues();
  const { data: parts } = useVenueParts(ws.id);
  const num = (n: number | null | undefined) => (n == null ? "" : String(n));
  const [f, setF] = useState({
    name: venue?.name ?? "", kind: venue?.kind ?? "salon", description: venue?.description ?? "", indoor: venue?.indoor ?? true, area_m2: num(venue?.area_m2),
    cap_banquet: num(venue?.cap_banquet), cap_theater: num(venue?.cap_theater), cap_cocktail: num(venue?.cap_cocktail), cap_classroom: num(venue?.cap_classroom), cap_u: num(venue?.cap_u),
    includes: venue?.includes ?? "", rules: venue?.rules ?? "", setup_h: String((venue?.setup_minutes ?? 120) / 60), teardown_h: String((venue?.teardown_minutes ?? 60) / 60),
    color: venue?.color ?? COLORS[all.length % COLORS.length]!, is_active: venue?.is_active ?? true,
  });
  const [amen, setAmen] = useState<string[]>(venue?.amenities ?? []);
  const [photos, setPhotos] = useState<string[]>(venue?.photos ?? []);
  const myParts = (parts ?? []).filter((p) => p.venue_id === venue?.id).map((p) => p.part_id);
  const [combo, setCombo] = useState<string[] | null>(null);
  const selectedParts = combo ?? myParts;
  const isPart = !!venue && (parts ?? []).some((p) => p.part_id === venue.id);
  const simple = all.filter((v) => v.id !== venue?.id && !(parts ?? []).some((p) => p.venue_id === v.id));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const intOrNull = (s: string) => (s.trim() === "" ? null : Math.round(Number(s)));

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const out: string[] = [];
      for (const file of [...files].slice(0, 12 - photos.length)) out.push(await uploadImage("event-media", `${ws.id}/espacios/${crypto.randomUUID()}.webp`, file, 1600));
      setPhotos((p) => [...p, ...out]);
    } catch (e) { setError((e as Error).message); } finally { setUploading(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Escribe el nombre del espacio.");
    const caps = [f.cap_banquet, f.cap_theater, f.cap_cocktail, f.cap_classroom, f.cap_u];
    if (caps.every((c) => c.trim() === "")) return setError("Indica la capacidad en al menos un tipo de montaje.");
    if (caps.some((c) => c.trim() !== "" && !(Number(c) >= 1))) return setError("Las capacidades deben ser números mayores que 0.");
    if (combo !== null && combo.length === 1) return setError("Para un espacio combinado elige al menos dos espacios (o ninguno).");
    setBusy(true); setError(null);
    const row = {
      name: f.name.trim(), kind: f.kind, description: f.description.trim() || null, indoor: f.indoor, area_m2: f.area_m2.trim() ? Number(f.area_m2) : null,
      cap_banquet: intOrNull(f.cap_banquet), cap_theater: intOrNull(f.cap_theater), cap_cocktail: intOrNull(f.cap_cocktail), cap_classroom: intOrNull(f.cap_classroom), cap_u: intOrNull(f.cap_u),
      amenities: amen, includes: f.includes.trim() || null, rules: f.rules.trim() || null, photos, color: f.color, is_active: f.is_active,
      setup_minutes: Math.round(Number(f.setup_h || 0) * 60), teardown_minutes: Math.round(Number(f.teardown_h || 0) * 60),
    };
    const res = venue ? await supabase.from("venues").update(row).eq("id", venue.id).select("id").single()
      : await supabase.from("venues").insert({ ...row, workspace_id: ws.id, sort: all.length }).select("id").single();
    if (res.error) { setBusy(false); return setError(res.error.message); }
    const id = (res.data as { id: string }).id;
    if (combo !== null) {
      await supabase.from("venue_parts").delete().eq("venue_id", id);
      if (combo.length) {
        const { error: e2 } = await supabase.from("venue_parts").insert(combo.map((p) => ({ workspace_id: ws.id, venue_id: id, part_id: p })));
        if (e2) { setBusy(false); return setError(e2.message); }
      }
    }
    // Fotos que se quitaron
    const removed = (venue?.photos ?? []).filter((p) => !photos.includes(p));
    if (removed.length) await supabase.storage.from("event-media").remove(removed);
    setBusy(false);
    await invalidate();
    onClose();
  }
  async function remove() {
    if (!venue || !confirm(`¿Eliminar "${venue.name}"?`)) return;
    const { error: err } = await supabase.from("venues").delete().eq("id", venue.id);
    if (err) return setError(err.code === "23503" ? "Este espacio tiene reservas. Desactívalo en lugar de eliminarlo para conservar el historial." : err.message);
    if (venue.photos.length) await supabase.storage.from("event-media").remove(venue.photos);
    await invalidate();
    onClose();
  }

  const capField = (k: "cap_banquet" | "cap_theater" | "cap_cocktail" | "cap_classroom" | "cap_u", s: SetupKey) => (
    <Field label={SETUPS[s].label} optional hint={SETUPS[s].hint}>{(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} inputMode="numeric" value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder="Personas" />}</Field>
  );

  return (
    <Dialog open onClose={onClose} title={venue ? `Editar: ${venue.name}` : "Nuevo espacio"} wide
      footer={<>
        {venue && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="venue-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="venue-form" onSubmit={submit} className="space-y-6">
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Nombre">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. Salón Los Robles" autoFocus />}</Field></div>
          <Field label="Tipo">{(id) => <Select id={id} value={f.kind} onChange={(e) => set("kind", e.target.value)}>{Object.entries(VENUE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Ubicación">{(id) => <Select id={id} value={f.indoor ? "1" : "0"} onChange={(e) => set("indoor", e.target.value === "1")}><option value="1">Bajo techo</option><option value="0">Al aire libre</option></Select>}</Field>
          <Field label="Área (m²)" optional>{(id) => <Input id={id} type="number" min={1} value={f.area_m2} onChange={(e) => set("area_m2", e.target.value)} />}</Field>
          <Field label="Color en el calendario">{() => (
            <div className="flex flex-wrap gap-1.5 pt-1.5">{COLORS.map((c) => <button key={c} type="button" onClick={() => set("color", c)} aria-label={`Color ${c}`} className={cx("size-7 rounded-full ring-offset-2", f.color === c && "ring-2 ring-ink")} style={{ background: c }} />)}</div>
          )}</Field>
          <div className="sm:col-span-2"><Field label="Descripción" optional hint="Aparece en tu página de consultas.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field></div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold">¿Cuántas personas caben?</h3>
          <p className="mb-3 text-xs text-muted">Llena solo los montajes que ofreces. Al reservar, el sistema te avisa si los invitados superan la capacidad.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {capField("cap_banquet", "banquet")}{capField("cap_theater", "theater")}{capField("cap_cocktail", "cocktail")}{capField("cap_classroom", "classroom")}{capField("cap_u", "u")}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Horas de montaje antes del evento" hint="El espacio queda ocupado desde antes para decorar y preparar.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.5" value={f.setup_h} onChange={(e) => set("setup_h", e.target.value)} />}</Field>
          <Field label="Horas de desmontaje después" hint="Tiempo para recoger y limpiar.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.5" value={f.teardown_h} onChange={(e) => set("teardown_h", e.target.value)} />}</Field>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Comodidades</h3>
          <div className="flex flex-wrap gap-2">
            {AMENITIES.map((a) => {
              const on = amen.includes(a);
              return <button key={a} type="button" onClick={() => setAmen((s) => (on ? s.filter((x) => x !== a) : [...s, a]))}
                className={cx("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-line text-ink-soft hover:border-line-strong")}>{on ? "✓ " : ""}{a}</button>;
            })}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Qué incluye el alquiler" optional hint="Ej. 20 mesas redondas, 200 sillas, limpieza, seguridad.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.includes} onChange={(e) => set("includes", e.target.value)} />}</Field>
          <Field label="Reglas de uso" optional hint="Ej. Música hasta la 1:00 a. m., no se permite pirotecnia.">{(id, d) => <Textarea id={id} aria-describedby={d} value={f.rules} onChange={(e) => set("rules", e.target.value)} />}</Field>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Fotos <span className="font-normal text-muted">(la primera es la portada)</span></h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p, i) => (
              <div key={p} className="group relative aspect-square overflow-hidden rounded-xl border border-line">
                <img src={publicMediaUrl(p)!} alt="" className="size-full object-cover" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-ink/75 px-1.5 text-[10px] text-white">Portada</span>}
                <div className="absolute inset-x-1 bottom-1 flex justify-between">
                  {i > 0 ? <button type="button" title="Usar como portada" onClick={() => setPhotos((s) => [p, ...s.filter((x) => x !== p)])} className="rounded-lg bg-white/90 p-1 text-ink"><Star className="size-3.5" /></button> : <span />}
                  <button type="button" title="Quitar" aria-label="Quitar foto" onClick={() => setPhotos((s) => s.filter((x) => x !== p))} className="rounded-lg bg-white/90 p-1 text-danger"><X className="size-3.5" /></button>
                </div>
              </div>
            ))}
            {photos.length < 12 && (
              <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line-strong bg-paper text-xs text-muted hover:border-[var(--accent)]">
                {uploading ? "Subiendo…" : <span className="flex flex-col items-center gap-1"><ImagePlus className="size-5" />Agregar</span>}
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </section>

        {!isPart && simple.length >= 2 && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">¿Este espacio se forma uniendo otros?</h3>
            <p className="mb-2 text-xs text-muted">Ej. "Gran salón" = Salón A + Salón B. Al reservar uno, el sistema bloquea automáticamente los que lo forman (y al revés).</p>
            <div className="flex flex-wrap gap-2">
              {simple.map((v) => {
                const on = selectedParts.includes(v.id);
                return <button key={v.id} type="button" onClick={() => setCombo((on ? selectedParts.filter((x) => x !== v.id) : [...selectedParts, v.id]))}
                  className={cx("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-line text-ink-soft")}>{on ? "✓ " : ""}{v.name}</button>;
              })}
            </div>
            {selectedParts.length === 1 && <p className="mt-1 text-xs text-warn">Elige al menos dos espacios, o ninguno.</p>}
          </section>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" />Activo (se puede reservar)</label>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
