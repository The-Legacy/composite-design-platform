import { describe, expect, it } from "vitest";
import { evaluateProject, toTex, type VarInput } from "./engine";

const parts = [
  { id: "p1", slug: "spar_cap" },
  { id: "p2", slug: "skin" },
];
let n = 0;
const v = (partId: string | null, name: string, expression: string, displayUnit = ""): VarInput => ({
  id: `v${++n}`,
  partId,
  name,
  expression,
  displayUnit,
});

describe("evaluateProject", () => {
  it("evaluates values with units and converts to the display unit", () => {
    const a = v(null, "n_plies", "8");
    const b = v("p1", "t_ply", "0.25 mm");
    const c = v("p1", "thickness", "n_plies * t_ply", "in");
    const r = evaluateProject([c, b, a], parts);
    expect(r.get(c.id)!.error).toBeUndefined();
    expect(r.get(c.id)!.text).toBe("0.0787402 in");
    expect(r.get(c.id)!.deps.sort()).toEqual([a.id, b.id].sort());
    expect(r.get(a.id)!.dependents).toEqual([c.id]);
  });

  it("resolves cross-part references with slug.name", () => {
    const t = v("p1", "t_ply", "0.2 mm");
    const s = v("p2", "skin_t", "4 * spar_cap.t_ply", "mm");
    const r = evaluateProject([t, s], parts);
    expect(r.get(s.id)!.text).toBe("0.8 mm");
  });

  it("prefers the part's own variable over a global with the same name", () => {
    const g = v(null, "E", "70 GPa");
    const own = v("p1", "E", "135 GPa");
    const use = v("p1", "stiff", "E * 2", "GPa");
    const r = evaluateProject([g, own, use], parts);
    expect(r.get(use.id)!.text).toBe("270 GPa");
  });

  it("lets a part variable override a global by referencing it", () => {
    const g = v(null, "E", "70 GPa");
    const own = v("p1", "E", "1.1 * E", "GPa");
    const r = evaluateProject([own, g], parts);
    expect(r.get(own.id)!.error).toBeUndefined();
    expect(r.get(own.id)!.text).toBe("77 GPa");
  });

  it("detects cycles and propagates errors downstream", () => {
    const a = v(null, "a", "b + 1");
    const b = v(null, "b", "a + 1");
    const c = v(null, "c", "a * 2");
    const r = evaluateProject([a, b, c], parts);
    expect(r.get(a.id)!.error).toMatch(/Circular/);
    expect(r.get(b.id)!.error).toMatch(/Circular/);
    expect(r.get(c.id)!.error).toMatch(/Depends on a/);
  });

  it("reports unknown names and parts", () => {
    const a = v(null, "a", "foo * 2");
    const b = v(null, "b", "wing.x");
    const c = v(null, "c", "spar_cap.nope");
    const r = evaluateProject([a, b, c], parts);
    expect(r.get(a.id)!.error).toMatch(/Unknown variable or unit “foo”/);
    expect(r.get(b.id)!.error).toMatch(/Unknown part or material “wing”/);
    expect(r.get(c.id)!.error).toMatch(/no variable “nope”/);
  });

  it("supports math functions and constants", () => {
    const d = v(null, "d", "10 mm");
    const area = v(null, "area", "pi * (d/2)^2", "mm^2");
    const s = v(null, "s", "sqrt(16) + max(1, 3)");
    const r = evaluateProject([d, area, s], parts);
    expect(r.get(area.id)!.text).toBe("78.5398 mm^2");
    expect(r.get(s.id)!.text).toBe("7");
  });

  it("warns on incompatible display units and rejects assignments", () => {
    const a = v(null, "a", "5 mm", "kg");
    const b = v(null, "b", "x = 3");
    const r = evaluateProject([a, b], parts);
    expect(r.get(a.id)!.warnings[0]).toMatch(/incompatible/);
    expect(r.get(b.id)!.error).toMatch(/Assignments/);
  });

  it("rejects self reference", () => {
    const a = v(null, "a", "a + 1");
    expect(evaluateProject([a], parts).get(a.id)!.error).toMatch(/itself/);
  });
});

describe("toTex", () => {
  it("renders LaTeX", () => {
    expect(toTex("sqrt(x)/2")).toContain("\\sqrt");
    expect(toTex("(((")).toBeNull();
  });
});
