import { useState, type FormEvent } from "react";
import { Calculator, Plus, Receipt, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fromLocalInput, toLocalInput } from "@/lib/events";
import { WEEKDAYS, WEEKDAY_NAMES, usePriceSuggestion, useInvalidateVenues, useVenueRates, useVenues, type VenueRate } from "@/lib/venues";
import { formatMoney } from "@/lib/format";
import { useWorkspace } from "@/layouts/WorkspaceShell";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from "@/components/ui";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const md = (s: string) => `${Number(s.slice(3))} ${MONTHS[Number(s.slice(0, 2)) - 1]}`;
const daysText = (w: number[]) => {
  if (!w.length || w.length === 7) return "Todos los días";
  const sorted = [...w].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (sorted.join() === "1,2,3,4") return "Lunes a jueves";
  if (sorted.join() === "1,2,3,4,5") return "Lunes a viernes";
  if (sorted.join() === "5,6") return "Viernes y sábado";
  if (sorted.join() === "5,6,0") return "Viernes a domingo";
  if (sorted.join() === "6,0") return "Fines de semana";
  return sorted.map((d) => WEEKDAY_NAMES[d]).join(", ");
};

/** Tarifas por espacio: precio por bloque de horas, hora extra, garantía, días y temporadas. */
export default function RatesPage() {
  const { ws, region, readOnly } = useWorkspace();
  const { data: venues, isLoading } = useVenues(ws.id);
  const { data: rates } = useVenueRates(ws.id);
  const [editing, setEditing] = useState<VenueRate | { venue_id: string } | null>(null);

  if (isLoading) return <Spinner />;
  return (
    <div className="animate-rise">
      <PageHeader title="Tarifas" description="Cuánto cobras por cada espacio según el día y la temporada. Al crear una reserva, el sistema propone el precio automáticamente." />
      {!venues?.length ? (
        <Card><EmptyState icon={<Receipt className="size-6" />} title="Primero registra tus espacios">Las tarifas se definen para cada espacio.</EmptyState></Card>
      ) : (
        <div className="space-y-6">
          <Simulator />
          {venues.map((v) => {
            const list = (rates ?? []).filter((r) => r.venue_id === v.id);
            return (
              <Card key={v.id}>
                <CardHeader title={<span className="inline-flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: v.color }} />{v.name}</span>}
                  action={!readOnly && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing({ venue_id: v.id })}>Agregar tarifa</Button>} />
                {!list.length ? <p className="px-5 py-4 text-sm text-muted">Sin tarifas. Agrega al menos una general (todos los días).</p> : (
                  <ul className="divide-y divide-line">
                    {list.map((r) => (
                      <li key={r.id}>
                        <button disabled={readOnly} onClick={() => setEditing(r)} className={cx("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper", !r.is_active && "opacity-50")}>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{r.name}{!r.is_active && <Badge className="ml-2">Inactiva</Badge>}</span>
                            <span className="block text-xs text-muted">{daysText(r.weekdays)}{r.season_from && r.season_to ? ` · del ${md(r.season_from)} al ${md(r.season_to)}` : ""}</span>
                          </span>
                          <span className="text-right text-sm">
                            <span className="block font-semibold tabular-nums">{formatMoney(Number(r.base_price), r.currency_code, region.locale)} <span className="font-normal text-muted">por {Number(r.base_hours)} h</span></span>
                            <span className="block text-xs text-muted">Hora extra {formatMoney(Number(r.extra_hour_price), r.currency_code, region.locale)}{Number(r.deposit_amount) ? ` · garantía ${formatMoney(Number(r.deposit_amount), r.currency_code, region.locale)}` : ""}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
          <Alert tone="info" title="¿Cuál tarifa se aplica?">Si una fecha coincide con varias, gana la de temporada; luego la de días específicos (por ejemplo, fin de semana); y por último la general. Siempre puedes ajustar el precio en cada reserva.</Alert>
        </div>
      )}
      {editing && <RateDialog rate={"id" in editing ? editing : null} venueId={editing.venue_id} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** "¿Cuánto cobro?": elige espacio y horario y muestra la tarifa que aplica. */
function Simulator() {
  const { ws, region } = useWorkspace();
  const { data: venues } = useVenues(ws.id);
  const today = toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString(), region.timezone).slice(0, 10);
  const [f, setF] = useState({ venue_id: venues?.[0]?.id ?? "", date: today, from: "18:00", to: "23:00" });
  const start = fromLocalInput(`${f.date}T${f.from}`, region.timezone);
  let end = fromLocalInput(`${f.date}T${f.to}`, region.timezone);
  if (start && end && new Date(end) <= new Date(start)) end = new Date(new Date(end).getTime() + 86_400_000).toISOString();
  const { data: p, isFetching } = usePriceSuggestion(ws.id, f.venue_id, start, end);
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Calculator className="size-4" />¿Cuánto cobro?</span>} description="Prueba un espacio, una fecha y un horario." />
      <div className="grid gap-3 p-4 sm:grid-cols-4">
        <Field label="Espacio">{(id) => <Select id={id} value={f.venue_id} onChange={(e) => setF((s) => ({ ...s, venue_id: e.target.value }))}>{(venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>}</Field>
        <Field label="Fecha">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />}</Field>
        <Field label="Desde">{(id) => <Input id={id} type="time" value={f.from} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} />}</Field>
        <Field label="Hasta">{(id) => <Input id={id} type="time" value={f.to} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} />}</Field>
      </div>
      <div className="border-t border-line px-5 py-4 text-sm">
        {isFetching ? <span className="text-muted">Calculando…</span> : !p ? <span className="text-warn">Ninguna tarifa aplica a esa fecha. Agrega una tarifa general para este espacio.</span> : (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span>Tarifa <b>{p.rate_name}</b>: {formatMoney(Number(p.base_price), p.currency_code, region.locale)} por {Number(p.base_hours)} h{p.extra_hours > 0 ? ` + ${p.extra_hours} h extra × ${formatMoney(Number(p.extra_hour_price), p.currency_code, region.locale)}` : ""}{Number(p.deposit_amount) ? ` · garantía ${formatMoney(Number(p.deposit_amount), p.currency_code, region.locale)}` : ""}</span>
            <span className="font-display text-2xl font-semibold tabular-nums">{formatMoney(Number(p.total), p.currency_code, region.locale)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function RateDialog({ rate, venueId, onClose }: { rate: VenueRate | null; venueId: string; onClose: () => void }) {
  const { ws, region } = useWorkspace();
  const invalidate = useInvalidateVenues();
  const { data: venues } = useVenues(ws.id);
  const [f, setF] = useState({
    venue_id: rate?.venue_id ?? venueId, name: rate?.name ?? "General", base_hours: String(rate?.base_hours ?? 5), base_price: String(rate?.base_price ?? ""),
    extra_hour_price: String(rate?.extra_hour_price ?? ""), deposit_amount: String(rate?.deposit_amount ?? ""), currency_code: rate?.currency_code ?? region.currency_code,
    season: !!rate?.season_from, from_d: rate?.season_from ? String(Number(rate.season_from.slice(3))) : "1", from_m: rate?.season_from ? String(Number(rate.season_from.slice(0, 2))) : "12",
    to_d: rate?.season_to ? String(Number(rate.season_to.slice(3))) : "31", to_m: rate?.season_to ? String(Number(rate.season_to.slice(0, 2))) : "12", is_active: rate?.is_active ?? true,
  });
  const [days, setDays] = useState<number[]>(rate?.weekdays ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const pad = (n: string) => String(Number(n)).padStart(2, "0");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Ponle un nombre a la tarifa (ej. Fin de semana).");
    if (!(Number(f.base_price) >= 0) || f.base_price === "") return setError("Indica el precio.");
    if (!(Number(f.base_hours) > 0)) return setError("Indica cuántas horas incluye el precio.");
    setBusy(true);
    const row = {
      venue_id: f.venue_id, name: f.name.trim(), weekdays: days.length === 7 ? [] : days, base_hours: Number(f.base_hours), base_price: Number(f.base_price),
      extra_hour_price: Number(f.extra_hour_price) || 0, deposit_amount: Number(f.deposit_amount) || 0, currency_code: f.currency_code, is_active: f.is_active,
      season_from: f.season ? `${pad(f.from_m)}-${pad(f.from_d)}` : null, season_to: f.season ? `${pad(f.to_m)}-${pad(f.to_d)}` : null,
    };
    const res = rate ? await supabase.from("venue_rates").update(row).eq("id", rate.id) : await supabase.from("venue_rates").insert({ ...row, workspace_id: ws.id });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await invalidate();
    onClose();
  }
  async function remove() {
    if (!rate || !confirm(`¿Eliminar la tarifa "${rate.name}"?`)) return;
    await supabase.from("venue_rates").delete().eq("id", rate.id);
    await invalidate();
    onClose();
  }
  const dm = (d: "from" | "to") => (
    <div className="grid grid-cols-[70px_1fr] gap-2">
      <Input type="number" min={1} max={31} value={f[`${d}_d`]} onChange={(e) => set(`${d}_d`, e.target.value)} aria-label={d === "from" ? "Día de inicio" : "Día de fin"} />
      <Select value={f[`${d}_m`]} onChange={(e) => set(`${d}_m`, e.target.value)} aria-label={d === "from" ? "Mes de inicio" : "Mes de fin"}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
    </div>
  );

  return (
    <Dialog open onClose={onClose} title={rate ? "Editar tarifa" : "Nueva tarifa"}
      footer={<>
        {rate && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>Eliminar</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="rate-form" variant="accent" loading={busy}>Guardar</Button>
      </>}>
      <form id="rate-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Espacio">{(id) => <Select id={id} value={f.venue_id} onChange={(e) => set("venue_id", e.target.value)}>{(venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>}</Field>
          <Field label="Nombre de la tarifa">{(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="General, Fin de semana, Diciembre…" />}</Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">¿Qué días aplica? <span className="font-normal text-muted">(ninguno marcado = todos)</span></div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = days.includes(d);
              return <button key={d} type="button" title={WEEKDAY_NAMES[d]} onClick={() => setDays((s) => (on ? s.filter((x) => x !== d) : [...s, d]))}
                className={cx("size-10 rounded-full border text-sm font-semibold", on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-line text-ink-soft")}>{WEEKDAYS[d]}</button>;
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.season} onChange={(e) => set("season", e.target.checked)} className="size-4 accent-ink" />Solo en una temporada (se repite cada año)</label>
        {f.season && <div className="grid gap-3 sm:grid-cols-2"><Field label="Desde">{() => dm("from")}</Field><Field label="Hasta">{() => dm("to")}</Field></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Precio">{(id) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={f.base_price} onChange={(e) => set("base_price", e.target.value)} />}</Field>
          <Field label="Incluye (horas)" hint="Ej. 5 horas de evento.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0.5} step="0.5" value={f.base_hours} onChange={(e) => set("base_hours", e.target.value)} />}</Field>
          <Field label="Precio por hora adicional" optional>{(id) => <Input id={id} type="number" min={0} step="0.01" value={f.extra_hour_price} onChange={(e) => set("extra_hour_price", e.target.value)} />}</Field>
          <Field label="Garantía (depósito reembolsable)" optional hint="Se devuelve si no hay daños.">{(id, d) => <Input id={id} aria-describedby={d} type="number" min={0} step="0.01" value={f.deposit_amount} onChange={(e) => set("deposit_amount", e.target.value)} />}</Field>
          <Field label="Moneda">{(id) => <Select id={id} value={f.currency_code} onChange={(e) => set("currency_code", e.target.value)}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select>}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="size-4 accent-ink" />Activa</label>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
