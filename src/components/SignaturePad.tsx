import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { cx } from "./ui";

/**
 * Recuadro para firmar con el dedo o el mouse. Entrega la firma como PNG (data URL) recortada
 * a su contenido, o null si está vacío.
 */
export function SignaturePad({ onChange, height = 180, className }: { onChange: (dataUrl: string | null) => void; height?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvasRef.current!;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const w = c.offsetWidth;
      c.width = w * ratio;
      c.height = height * ratio;
      const ctx = c.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1d1530";
      ctx.lineWidth = 2.4;
      setEmpty(true);
      onChange(null);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [height]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function exportTrimmed() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const { width, height: h } = c;
    const data = ctx.getImageData(0, 0, width, h).data;
    let minX = width, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < width; x += 2) {
      if (data[(y * width + x) * 4 + 3]! > 0) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    }
    if (maxX <= minX || maxY <= minY) return null;
    const pad = 8;
    const out = document.createElement("canvas");
    const w = Math.min(width, maxX - minX + pad * 2), hh = Math.min(h, maxY - minY + pad * 2);
    // Se reduce a un tamaño razonable para guardar (máx. 600 px de ancho).
    const scale = Math.min(1, 600 / w);
    out.width = Math.round(w * scale); out.height = Math.round(hh * scale);
    out.getContext("2d")!.drawImage(c, Math.max(0, minX - pad), Math.max(0, minY - pad), w, hh, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  return (
    <div className={className}>
      <div className="relative rounded-xl border-2 border-dashed border-line-strong bg-white">
        <canvas ref={canvasRef} style={{ height, touchAction: "none" }} className="block w-full cursor-crosshair rounded-xl" aria-label="Recuadro para firmar"
          onPointerDown={(e) => { drawing.current = true; last.current = pos(e); (e.target as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const p = pos(e);
            const ctx = canvasRef.current!.getContext("2d")!;
            ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
            last.current = p;
            if (empty) setEmpty(false);
          }}
          onPointerUp={() => { drawing.current = false; last.current = null; onChange(exportTrimmed()); }}
          onPointerCancel={() => { drawing.current = false; last.current = null; }} />
        {empty && <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-faint">Firma aquí con el dedo o el mouse</div>}
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-line-strong" />
      </div>
      <button type="button" onClick={() => {
        const c = canvasRef.current!;
        c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
        setEmpty(true); onChange(null);
      }} className={cx("mt-1.5 inline-flex items-center gap-1 text-xs text-muted hover:text-ink", empty && "invisible")}>
        <Eraser className="size-3.5" /> Borrar y volver a firmar
      </button>
    </div>
  );
}
