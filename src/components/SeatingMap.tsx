import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { EventTable } from "@/lib/events";

/** Plano en unidades virtuales: 1000 × 700. Las posiciones se guardan en % (0–100). */
export const MAP_W = 1000;
export const MAP_H = 700;

export interface MapItem {
  id: string; kind: string; label: string | null; pos_x: number; pos_y: number; width: number; height: number;
}

export const MAP_ITEM_KINDS: Record<string, { label: string; fill: string; stroke: string }> = {
  stage: { label: "Tarima / Escenario", fill: "#efe9f7", stroke: "#4a2c7a" },
  dance: { label: "Pista de baile", fill: "#fdf0dc", stroke: "#b9802a" },
  head: { label: "Mesa principal", fill: "#fbe9ef", stroke: "#c2416b" },
  entrance: { label: "Entrada", fill: "#e3f4ea", stroke: "#177a4b" },
  buffet: { label: "Buffet", fill: "#e1f3f0", stroke: "#0f7468" },
  bar: { label: "Bar", fill: "#e9ecfb", stroke: "#3d4fc4" },
  dj: { label: "DJ / Música", fill: "#efe9f7", stroke: "#4a2c7a" },
  cake: { label: "Pastel", fill: "#fbe9ef", stroke: "#c2416b" },
  photo: { label: "Área de fotos", fill: "#fdf0dc", stroke: "#b9802a" },
  other: { label: "Otro", fill: "#f1eee9", stroke: "#6f6680" },
};

export interface TableLayout { table: EventTable; x: number; y: number; used: number }

/** Posición en % de cada mesa; las que no se han ubicado se reparten en cuadrícula. */
export function layoutTables(tables: EventTable[], used: (id: string) => number): TableLayout[] {
  const free = tables.filter((t) => t.pos_x == null || t.pos_y == null);
  const cols = Math.max(1, Math.ceil(Math.sqrt(free.length * 1.4)));
  const rows = Math.max(1, Math.ceil(free.length / cols));
  return tables.map((t) => {
    if (t.pos_x != null && t.pos_y != null) return { table: t, x: Number(t.pos_x), y: Number(t.pos_y), used: used(t.id) };
    const i = free.indexOf(t);
    const c = i % cols, r = Math.floor(i / cols);
    return { table: t, x: 12 + ((c + 0.5) * 76) / cols, y: 30 + ((r + 0.5) * 62) / rows, used: used(t.id) };
  });
}

const tableRadius = (capacity: number) => Math.min(62, 26 + capacity * 2.6);

interface Props {
  tables: TableLayout[];
  items: MapItem[];
  editable?: boolean;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onMoveTable?: (id: string, x: number, y: number) => void;
  onMoveItem?: (id: string, x: number, y: number) => void;
  /** Etiqueta adicional por mesa (p. ej. número para la leyenda impresa). */
  accent?: string;
}

export function SeatingMap({ tables, items, editable, selected, onSelect, onMoveTable, onMoveItem, accent = "#4a2c7a" }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; type: "table" | "item"; dx: number; dy: number; x: number; y: number } | null>(null);

  function toMap(e: ReactPointerEvent) {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }
  const clamp = (v: number) => Math.max(1, Math.min(99, v));

  function start(e: ReactPointerEvent, id: string, type: "table" | "item", x: number, y: number) {
    onSelect?.(id);
    if (!editable) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toMap(e);
    setDrag({ id, type, dx: p.x - (x / 100) * MAP_W, dy: p.y - (y / 100) * MAP_H, x, y });
  }
  function move(e: ReactPointerEvent) {
    if (!drag) return;
    const p = toMap(e);
    setDrag({ ...drag, x: clamp(((p.x - drag.dx) / MAP_W) * 100), y: clamp(((p.y - drag.dy) / MAP_H) * 100) });
  }
  function end() {
    if (!drag) return;
    const x = Math.round(drag.x * 100) / 100, y = Math.round(drag.y * 100) / 100;
    if (drag.type === "table") onMoveTable?.(drag.id, x, y); else onMoveItem?.(drag.id, x, y);
    setDrag(null);
  }
  const pos = (id: string, x: number, y: number) => (drag?.id === id ? { x: drag.x, y: drag.y } : { x, y });

  return (
    <svg ref={svgRef} viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="block h-auto w-full select-none" role="img" aria-label="Mapa de mesas"
      onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerDown={(e) => e.target === svgRef.current && onSelect?.(null)}
      style={{ touchAction: editable ? "none" : "auto" }}>
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#ece6dc" strokeWidth="1" /></pattern>
      </defs>
      <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="#fffdf9" />
      <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#grid)" />
      <rect x="4" y="4" width={MAP_W - 8} height={MAP_H - 8} fill="none" stroke="#d6cec2" strokeWidth="3" rx="10" />

      {items.map((it) => {
        const k = MAP_ITEM_KINDS[it.kind] ?? MAP_ITEM_KINDS.other!;
        const p = pos(it.id, Number(it.pos_x), Number(it.pos_y));
        const w = (Number(it.width) / 100) * MAP_W, h = (Number(it.height) / 100) * MAP_H;
        const cx = (p.x / 100) * MAP_W, cy = (p.y / 100) * MAP_H;
        return (
          <g key={it.id} onPointerDown={(e) => start(e, it.id, "item", Number(it.pos_x), Number(it.pos_y))} style={{ cursor: editable ? "grab" : "default" }}>
            <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx="10" fill={k.fill} stroke={selected === it.id ? "#1d1530" : k.stroke}
              strokeWidth={selected === it.id ? 4 : 2} strokeDasharray={it.kind === "dance" ? "10 6" : undefined} />
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(22, Math.max(13, h / 3))} fontWeight="600" fill={k.stroke} style={{ pointerEvents: "none" }}>
              {it.label || k.label}
            </text>
          </g>
        );
      })}

      {tables.map(({ table: t, x, y, used }) => {
        const p = pos(t.id, x, y);
        const cx = (p.x / 100) * MAP_W, cy = (p.y / 100) * MAP_H;
        const r = tableRadius(t.capacity);
        const full = used >= t.capacity;
        const isSel = selected === t.id;
        const fill = full ? "#e3f4ea" : used > 0 ? "#ffffff" : "#faf8f4";
        const stroke = isSel ? "#1d1530" : full ? "#177a4b" : accent;
        // Asientos alrededor
        const seats = Array.from({ length: t.capacity }, (_, i) => {
          const a = (i / t.capacity) * Math.PI * 2 - Math.PI / 2;
          if (t.shape === "round") return { sx: cx + Math.cos(a) * (r + 10), sy: cy + Math.sin(a) * (r + 10) };
          const w = r * 1.9, h = r * 1.1;
          const per = Math.ceil(t.capacity / 2);
          const side = i < per ? -1 : 1;
          const idx = i < per ? i : i - per;
          const n = i < per ? per : t.capacity - per;
          return { sx: cx - w / 2 + ((idx + 0.5) * w) / n, sy: cy + side * (h / 2 + 10) };
        });
        return (
          <g key={t.id} onPointerDown={(e) => start(e, t.id, "table", x, y)} style={{ cursor: editable ? "grab" : "pointer" }}>
            {seats.map((s, i) => <circle key={i} cx={s.sx} cy={s.sy} r="7" fill={i < used ? stroke : "#fff"} stroke={stroke} strokeWidth="1.5" />)}
            {t.shape === "round"
              ? <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={isSel ? 4 : 2.5} />
              : <rect x={cx - r * 0.95} y={cy - r * 0.55} width={r * 1.9} height={r * 1.1} rx="8" fill={fill} stroke={stroke} strokeWidth={isSel ? 4 : 2.5} />}
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="#1d1530" style={{ pointerEvents: "none" }}>{t.name.length > 12 ? `${t.name.slice(0, 11)}…` : t.name}</text>
            <text x={cx} y={cy + 15} textAnchor="middle" fontSize="14" fill="#6f6680" style={{ pointerEvents: "none" }}>{used}/{t.capacity}</text>
          </g>
        );
      })}
    </svg>
  );
}
