import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, ImagePlus, Palette, StickyNote, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/queries";
import { uploadImage, useInvalidateEvent, type EventRow } from "@/lib/events";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { EventGate, EventSwitcher } from "@/components/EventGate";
import { Alert, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Textarea } from "@/components/ui";

interface Item { id: string; kind: "image" | "palette" | "note"; title: string | null; image_path: string | null; colors: string[]; note: string | null; created_at: string }

export default function InspirationPage() {
  return <EventGate>{(ctx) => <Inspiration {...ctx} />}</EventGate>;
}

function Inspiration({ event, events, select }: { event: EventRow; events: EventRow[]; select: (id: string) => void }) {
  const { ws, readOnly } = useWorkspace();
  const invalidate = useInvalidateEvent();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<"palette" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["inspiration", event.id],
    queryFn: async () => {
      const items = unwrap<Item[]>(await supabase.from("inspiration_items").select("*").eq("event_id", event.id).order("created_at", { ascending: false }));
      const paths = items.filter((i) => i.image_path).map((i) => i.image_path!);
      const urls = new Map<string, string>();
      if (paths.length) {
        const { data: signed } = await supabase.storage.from("workspace-files").createSignedUrls(paths, 3600);
        for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      }
      return items.map((i) => ({ ...i, url: i.image_path ? urls.get(i.image_path) ?? null : null }));
    },
  });

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const path = await uploadImage("workspace-files", `${ws.id}/inspiracion/${event.id}/${crypto.randomUUID()}.webp`, file, 1400);
        const { error: err } = await supabase.from("inspiration_items").insert({ workspace_id: ws.id, event_id: event.id, kind: "image", image_path: path, title: file.name.replace(/\.[^.]+$/, "").slice(0, 120) });
        if (err) { await supabase.storage.from("workspace-files").remove([path]); throw new Error(err.message); }
      }
      await invalidate(event.id, "inspiration");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(item: Item) {
    if (!confirm("¿Eliminar este elemento?")) return;
    const { error: err } = await supabase.from("inspiration_items").delete().eq("id", item.id);
    if (err) return setError(err.message);
    if (item.image_path) await supabase.storage.from("workspace-files").remove([item.image_path]);
    await invalidate(event.id, "inspiration");
  }

  return (
    <div className="animate-rise">
      <PageHeader title="Inspiración" description="Ideas de decoración, paletas de colores y notas para tu evento. Solo tú y tu equipo las ven."
        actions={<>
          <EventSwitcher events={events} current={event} onSelect={select} />
          {!readOnly && <>
            <Button variant="secondary" icon={<StickyNote className="size-4" />} onClick={() => setDialog("note")}>Nota</Button>
            <Button variant="secondary" icon={<Palette className="size-4" />} onClick={() => setDialog("palette")}>Paleta</Button>
            <Button variant="accent" icon={<ImagePlus className="size-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>Subir fotos</Button>
          </>}
        </>} />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      {error && <div className="mb-4"><Alert tone="danger" onClose={() => setError(null)}>{error}</Alert></div>}
      {isLoading ? <Spinner /> : !data?.length ? (
        <Card><EmptyState icon={<Heart className="size-6" />} title="Tu tablero de ideas está vacío">
          Sube fotos de referencia, crea la paleta de colores de tu evento o guarda notas sueltas.
        </EmptyState></Card>
      ) : (
        <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
          {data.map((i) => (
            <Card key={i.id} className="group relative mb-4 break-inside-avoid overflow-hidden">
              {i.kind === "image" && (i.url ? <img src={i.url} alt={i.title ?? ""} className="w-full" loading="lazy" /> : <div className="aspect-square bg-paper" />)}
              {i.kind === "palette" && (
                <div>
                  <div className="flex h-24">{i.colors.map((c) => <div key={c} className="flex-1" style={{ background: c }} title={c} />)}</div>
                  <div className="flex flex-wrap gap-1 p-3 text-[11px] text-muted">{i.colors.map((c) => <span key={c} className="font-mono">{c}</span>)}</div>
                </div>
              )}
              {i.kind === "note" && <p className="whitespace-pre-line bg-champagne/15 p-4 text-sm">{i.note}</p>}
              {i.title && i.kind !== "image" && <div className="border-t border-line px-3 py-2 text-sm font-medium">{i.title}</div>}
              {!readOnly && (
                <button onClick={() => void remove(i)} className="absolute right-2 top-2 rounded-lg bg-card/90 p-1.5 text-danger opacity-0 shadow-sm transition group-hover:opacity-100 focus:opacity-100" aria-label="Eliminar">
                  <Trash2 className="size-4" />
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
      {dialog && <ItemDialog kind={dialog} event={event} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ItemDialog({ kind, event, onClose }: { kind: "palette" | "note"; event: EventRow; onClose: () => void }) {
  const { ws } = useWorkspace();
  const invalidate = useInvalidateEvent();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [colors, setColors] = useState(["#e9b65c", "#f4eee4", "#4a2c7a", "#c2416b"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (kind === "note" && !note.trim()) return setError("Escribe la nota.");
    setBusy(true);
    const { error: err } = await supabase.from("inspiration_items").insert({
      workspace_id: ws.id, event_id: event.id, kind, title: title.trim() || null,
      note: kind === "note" ? note.trim() : null, colors: kind === "palette" ? colors : [],
    });
    setBusy(false);
    if (err) return setError(err.message);
    await invalidate(event.id, "inspiration");
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={kind === "palette" ? "Nueva paleta de colores" : "Nueva nota"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="insp-form" variant="accent" loading={busy}>Guardar</Button></>}>
      <form id="insp-form" onSubmit={submit} className="space-y-4">
        <Field label="Título" optional>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        {kind === "note" ? (
          <Field label="Nota">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-32" autoFocus />}</Field>
        ) : (
          <div>
            <div className="mb-2 text-sm font-medium">Colores</div>
            <div className="flex flex-wrap items-center gap-3">
              {colors.map((c, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <input type="color" value={c} onChange={(e) => setColors((s) => s.map((x, j) => (j === i ? e.target.value : x)))} className="size-12 cursor-pointer rounded-lg border border-line bg-card" aria-label={`Color ${i + 1}`} />
                  {colors.length > 2 && <button type="button" onClick={() => setColors((s) => s.filter((_, j) => j !== i))} className="text-[11px] text-muted hover:text-danger">Quitar</button>}
                </div>
              ))}
              {colors.length < 8 && <Button type="button" size="sm" variant="secondary" onClick={() => setColors((s) => [...s, "#ffffff"])}>+ Color</Button>}
            </div>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
