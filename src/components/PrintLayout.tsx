import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "./ui";

export type Paper = "letter" | "half" | "letter-landscape";

export const PAPERS: Record<Paper, { label: string; size: string; w: string; h: string; margin: string }> = {
  letter: { label: "Carta (vertical)", size: "letter portrait", w: "8.5in", h: "11in", margin: "0.5in" },
  "letter-landscape": { label: "Carta (horizontal)", size: "letter landscape", w: "11in", h: "8.5in", margin: "0.4in" },
  half: { label: "Media carta", size: "5.5in 8.5in", w: "5.5in", h: "8.5in", margin: "0" },
};

/**
 * Documento imprimible: la barra superior no se imprime; cada <Sheet> es una página.
 * "Imprimir" abre el diálogo del navegador, desde donde también se puede guardar como PDF.
 */
export function PrintLayout({ title, backTo, paper, controls, children }: {
  title: string; backTo: string; paper: Paper; controls?: ReactNode; children: ReactNode;
}) {
  const p = PAPERS[paper];
  const navigate = useNavigate();
  return (
    <div className="-mx-4 -my-8 min-h-dvh bg-[#e9e4db] sm:-mx-8 print:m-0 print:min-h-0 print:bg-white">
      <style>{`@page { size: ${p.size}; margin: ${p.margin}; }`}</style>
      <div className="sticky top-0 z-20 border-b border-line bg-card/95 px-4 py-3 backdrop-blur print:hidden sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(backTo))} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink">
            <ArrowLeft className="size-4" /> Volver
          </button>
          <h1 className="mr-auto font-semibold">{title}</h1>
          {controls}
          <Button variant="accent" icon={<Printer className="size-4" />} onClick={() => window.print()}>Imprimir / PDF</Button>
        </div>
        <p className="mx-auto mt-1 max-w-5xl text-xs text-muted">Para obtener un PDF, elige “Guardar como PDF” como impresora. Activa “Gráficos de fondo” si los colores no aparecen.</p>
      </div>
      <div className="overflow-x-auto px-3 py-6 print:overflow-visible print:p-0">{children}</div>
    </div>
  );
}

/** Una página del documento. En pantalla se muestra como hoja; al imprimir ocupa la página. */
export function Sheet({ paper, children, className, style }: { paper: Paper; children: ReactNode; className?: string; style?: CSSProperties }) {
  const p = PAPERS[paper];
  return (
    <section className={`print-sheet ${className ?? ""}`}
      style={{ width: `min(100%, ${p.w})`, minHeight: paper === "half" ? p.h : undefined, ...style }}>
      {children}
    </section>
  );
}
