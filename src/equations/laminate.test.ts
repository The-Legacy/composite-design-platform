import { describe, expect, it } from "vitest";
import { analyzeLaminate, invert3, laminateScope, materialScope, type MaterialProps } from "./laminate";
import { evaluateProject, math } from "./engine";

const mat = (over: Partial<MaterialProps>): MaterialProps => ({
  id: "m1",
  slug: "T700",
  name: "T700/epoxy",
  form: "ud",
  e1_gpa: 135,
  e2_gpa: 10,
  g12_gpa: 5,
  nu12: 0.3,
  density_g_cc: 1.6,
  t_ply_mm: 0.125,
  xt_mpa: 2000,
  xc_mpa: 1200,
  yt_mpa: 50,
  yc_mpa: 200,
  s12_mpa: 70,
  cost_per_kg: 40,
  ...over,
});

const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe("analyzeLaminate", () => {
  const ud = mat({});
  const mats = new Map([[ud.id, ud]]);

  it("a single 0° ply has Ex ≈ E1, Ey ≈ E2, Gxy = G12, nuxy = ν12", () => {
    const r = analyzeLaminate([{ materialId: "m1", angleDeg: 0, count: 1 }], mats, false);
    close(r.Ex, 135);
    close(r.Ey, 10);
    close(r.Gxy, 5);
    close(r.nuxy, 0.3);
    close(r.h, 0.125);
    close(r.arealMass!, 1.6 * 0.125);
    close(r.arealCost!, 1.6 * 0.125 * 40);
  });

  it("a 90° ply swaps the moduli", () => {
    const r = analyzeLaminate([{ materialId: "m1", angleDeg: 90, count: 1 }], mats, false);
    close(r.Ex, 10);
    close(r.Ey, 135);
  });

  it("[0/45/-45/90]s is quasi-isotropic, symmetric and balanced", () => {
    const plies = [0, 45, -45, 90].map((a) => ({ materialId: "m1", angleDeg: a, count: 1 }));
    const r = analyzeLaminate(plies, mats, true);
    expect(r.plies).toHaveLength(8);
    close(r.h, 1.0);
    close(r.Ex, r.Ey, 1e-9);
    close(r.Gxy, r.Ex / (2 * (1 + r.nuxy)), 1e-9);
    expect(Math.max(...r.B.flat().map(Math.abs))).toBeLessThan(1e-9);
    expect(r.warnings).toEqual([]);
  });

  it("warns about unsymmetric and unbalanced layups", () => {
    const r = analyzeLaminate(
      [
        { materialId: "m1", angleDeg: 0, count: 1 },
        { materialId: "m1", angleDeg: 30, count: 1 },
      ],
      mats,
      false,
    );
    expect(r.warnings.join(" ")).toMatch(/B ≠ 0/);
    expect(r.warnings.join(" ")).toMatch(/balanced/);
  });

  it("isotropic material fills in E2 and G12", () => {
    const al = mat({ id: "al", slug: "Al6061", form: "isotropic", e1_gpa: 69, e2_gpa: null, g12_gpa: null, nu12: 0.33, t_ply_mm: 2 });
    const r = analyzeLaminate([{ materialId: "al", angleDeg: 0, count: 1 }], new Map([["al", al]]), false);
    close(r.Ex, 69);
    close(r.Gxy, 69 / 2.66);
    // plate bending: D11 = E h³ / (12 (1-ν²))
    close(r.D[0][0], (69 * 8) / (12 * (1 - 0.33 ** 2)));
  });

  it("reports missing properties", () => {
    const bad = mat({ id: "b", e2_gpa: null });
    expect(() => analyzeLaminate([{ materialId: "b", angleDeg: 0, count: 1 }], new Map([["b", bad]]), false)).toThrow(/E2 is missing/);
  });

  it("invert3 inverts", () => {
    const m = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ] as Parameters<typeof invert3>[0];
    const inv = invert3(m);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) close(m[i].reduce((s, _, k) => s + m[i][k] * inv[k][j], 0), i === j ? 1 : 0, 1e-12);
  });
});

describe("engine extras", () => {
  const parts = [{ id: "p1", slug: "spar_cap" }];
  const T700 = materialScope(mat({}));
  const lam = laminateScope(analyzeLaminate([{ materialId: "m1", angleDeg: 0, count: 8 }], new Map([["m1", mat({})]]), false));

  it("references material properties as slug.prop", () => {
    const vars = [{ id: "a", partId: "p1", name: "t", expression: "8 * T700.t_ply", displayUnit: "mm" }];
    const r = evaluateProject(vars, parts, { materials: new Map([["T700", T700]]) });
    expect(r.get("a")!.text).toBe("1 mm");
  });

  it("errors on an unknown material property", () => {
    const vars = [{ id: "a", partId: null, name: "x", expression: "T700.E9", displayUnit: "" }];
    const r = evaluateProject(vars, parts, { materials: new Map([["T700", T700]]) });
    expect(r.get("a")!.error).toMatch(/no value for “E9”/);
  });

  it("uses layup values by bare name on the part and as slug.name elsewhere", () => {
    const vars = [
      { id: "a", partId: "p1", name: "mass", expression: "layup_areal_mass * 0.5 m^2", displayUnit: "g" },
      { id: "b", partId: null, name: "t_spar", expression: "spar_cap.layup_t", displayUnit: "mm" },
    ];
    const r = evaluateProject(vars, parts, { partValues: new Map([["p1", lam]]) });
    expect(r.get("a")!.error).toBeUndefined();
    expect(r.get("a")!.text).toBe("800 g");
    expect(r.get("b")!.text).toBe("1 mm");
  });

  it("a real variable overrides a computed layup value", () => {
    const vars = [
      { id: "a", partId: "p1", name: "layup_t", expression: "2 mm", displayUnit: "" },
      { id: "b", partId: "p1", name: "t2", expression: "layup_t * 2", displayUnit: "mm" },
    ];
    const r = evaluateProject(vars, parts, { partValues: new Map([["p1", lam]]) });
    expect(r.get("b")!.text).toBe("4 mm");
    expect(r.get("b")!.deps).toEqual(["a"]);
  });

  it("units come through: A11 in N/mm", () => {
    expect(math.format((lam.layup_A11 as any).to("N/mm"), { precision: 4 })).toMatch(/N \/ mm/);
  });
});

describe("parseLayup", () => {
  it("parses ±, counts and symmetry", async () => {
    const { parseLayup, formatLayup } = await import("./laminate");
    expect(parseLayup("[0/±45/90]s")).toEqual({
      symmetric: true,
      plies: [
        { angleDeg: 0, count: 1 },
        { angleDeg: 45, count: 1 },
        { angleDeg: -45, count: 1 },
        { angleDeg: 90, count: 1 },
      ],
    });
    expect(parseLayup("0_2 / 90x3")).toEqual({
      symmetric: false,
      plies: [
        { angleDeg: 0, count: 2 },
        { angleDeg: 90, count: 3 },
      ],
    });
    expect(() => parseLayup("[0/100]")).toThrow(/outside/);
    expect(() => parseLayup("[0/abc]")).toThrow(/Can't read/);
    expect(formatLayup([{ angleDeg: 0, count: 2 }, { angleDeg: 45, count: 1 }], true)).toBe("[0_2/45]s");
  });
});
