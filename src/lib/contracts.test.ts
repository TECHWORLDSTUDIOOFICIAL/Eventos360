import { describe, expect, it } from "vitest";
import { CONTRACT_TEMPLATES, TEMPLATE_VARS, fillTemplate } from "./pro";
import { CLAUSE_RE } from "@/pages/pro/print/documents";

describe("plantillas de contrato", () => {
  it("hay 3 plantillas y todas sus variables son conocidas", () => {
    expect(CONTRACT_TEMPLATES).toHaveLength(3);
    const known = new Set(TEMPLATE_VARS.map(([k]) => k));
    for (const t of CONTRACT_TEMPLATES) {
      const used = [...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!);
      expect(used.length).toBeGreaterThan(5);
      for (const u of used) expect(known.has(u), `${t.key}: {{${u}}}`).toBe(true);
    }
  });
  it("al completar no quedan marcadores", () => {
    const vars = Object.fromEntries(TEMPLATE_VARS.map(([k]) => [k, "X"]));
    for (const t of CONTRACT_TEMPLATES) expect(fillTemplate(t.body, vars)).not.toMatch(/\{\{/);
  });
  it("detecta los encabezados de cláusula en las 3 plantillas", () => {
    for (const t of CONTRACT_TEMPLATES) {
      const paras = t.body.split(/\n\s*\n/).map((p) => p.trim());
      const clauses = paras.filter((p) => /^(PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|SÉPTIMA|OCTAVA|NOVENA|DÉCIMA)\./.test(p));
      expect(clauses.length).toBeGreaterThanOrEqual(8);
      for (const c of clauses) expect(CLAUSE_RE.test(c), c.slice(0, 50)).toBe(true);
    }
    expect("PRIMERA. OBJETO. EL PRESTADOR se compromete".match(CLAUSE_RE)?.[1]).toBe("PRIMERA. OBJETO.");
  });
});
