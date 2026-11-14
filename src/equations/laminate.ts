/**
 * Classical lamination theory (CLT) for a part's ply stack.
 *
 * Internal units: moduli in GPa, thickness in mm. So A is in GPa·mm (= kN/mm),
 * B in GPa·mm² (= kN) and D in GPa·mm³ (= kN·mm). Results handed to the equation
 * engine carry real units via mathjs.
 */
import { math } from "./engine";

export type MaterialForm = "ud" | "fabric" | "core" | "isotropic";

export interface MaterialProps {
  id: string;
  slug: string;
  name: string;
  form: MaterialForm;
  e1_gpa: number | null;
  e2_gpa: number | null;
  g12_gpa: number | null;
  nu12: number | null;
  density_g_cc: number | null;
  t_ply_mm: number | null;
  xt_mpa: number | null;
  xc_mpa: number | null;
  yt_mpa: number | null;
  yc_mpa: number | null;
  s12_mpa: number | null;
  cost_per_kg: number | null;
}

export interface PlyInput {
  materialId: string;
  angleDeg: number;
  count: number;
}

export interface ExpandedPly {
  material: MaterialProps;
  angleDeg: number;
  t: number;
  zBottom: number;
  zTop: number;
  /** true for plies added by mirroring a symmetric layup */
  mirrored: boolean;
}

type M3 = [[number, number, number], [number, number, number], [number, number, number]];

export interface LaminateResult {
  plies: ExpandedPly[];
  /** total thickness, mm */
  h: number;
  A: M3;
  B: M3;
  D: M3;
  /** effective in-plane (membrane) engineering constants, GPa */
  Ex: number;
  Ey: number;
  Gxy: number;
  nuxy: number;
  /** effective flexural moduli, GPa (B coupling ignored) */
  Efx: number;
  Efy: number;
  /** kg/m², or null if a ply material has no density */
  arealMass: number | null;
  /** currency per m², or null if any material lacks density or cost */
  arealCost: number | null;
  warnings: string[];
}

const zero = (): M3 => [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

/** In-plane stiffness Q of a ply in its material axes (GPa). Throws if properties are missing. */
export function plyQ(m: MaterialProps): { Q11: number; Q22: number; Q12: number; Q66: number } {
  const E1 = m.e1_gpa;
  const nu12 = m.nu12 ?? (m.form === "isotropic" || m.form === "core" ? 0.3 : null);
  if (!E1 || E1 <= 0) throw new Error(`${m.name}: E1 is missing`);
  if (nu12 === null) throw new Error(`${m.name}: ν12 is missing`);
  const iso = m.form === "isotropic";
  const E2 = m.e2_gpa ?? (iso || m.form === "core" ? E1 : null);
  const G12 = m.g12_gpa ?? (iso ? E1 / (2 * (1 + nu12)) : null);
  if (!E2 || E2 <= 0) throw new Error(`${m.name}: E2 is missing`);
  if (!G12 || G12 <= 0) throw new Error(`${m.name}: G12 is missing`);
  const nu21 = (nu12 * E2) / E1;
  const d = 1 - nu12 * nu21;
  if (d <= 0) throw new Error(`${m.name}: ν12 is too large for these moduli`);
  return { Q11: E1 / d, Q22: E2 / d, Q12: (nu12 * E2) / d, Q66: G12 };
}

/** Ply stiffness rotated to laminate axes (Q-bar), GPa. */
export function qBar(m: MaterialProps, angleDeg: number): M3 {
  const { Q11, Q22, Q12, Q66 } = plyQ(m);
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const c2 = c * c,
    s2 = s * s,
    c4 = c2 * c2,
    s4 = s2 * s2,
    cs = c2 * s2;
  const q11 = Q11 * c4 + 2 * (Q12 + 2 * Q66) * cs + Q22 * s4;
  const q22 = Q11 * s4 + 2 * (Q12 + 2 * Q66) * cs + Q22 * c4;
  const q12 = (Q11 + Q22 - 4 * Q66) * cs + Q12 * (c4 + s4);
  const q66 = (Q11 + Q22 - 2 * Q12 - 2 * Q66) * cs + Q66 * (c4 + s4);
  const q16 = (Q11 - Q12 - 2 * Q66) * c2 * c * s + (Q12 - Q22 + 2 * Q66) * c * s2 * s;
  const q26 = (Q11 - Q12 - 2 * Q66) * c * s2 * s + (Q12 - Q22 + 2 * Q66) * c2 * c * s;
  return [
    [q11, q12, q16],
    [q12, q22, q26],
    [q16, q26, q66],
  ];
}

export function invert3(m: M3): M3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) throw new Error("Stiffness matrix is singular");
  const k = 1 / det;
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k],
  ];
}

/** Expand counts and symmetry into the full stack, bottom (tool side) to top. */
export function expandStack(plies: PlyInput[], materials: Map<string, MaterialProps>, symmetric: boolean) {
  const half: { material: MaterialProps; angleDeg: number }[] = [];
  for (const p of plies) {
    const m = materials.get(p.materialId);
    if (!m) throw new Error("A ply uses a material that no longer exists");
    for (let i = 0; i < p.count; i++) half.push({ material: m, angleDeg: p.angleDeg });
  }
  const full = symmetric ? [...half.map((x) => ({ ...x, mirrored: false })), ...[...half].reverse().map((x) => ({ ...x, mirrored: true }))] : half.map((x) => ({ ...x, mirrored: false }));
  for (const p of full) {
    if (!p.material.t_ply_mm || p.material.t_ply_mm <= 0) throw new Error(`${p.material.name}: ply thickness is missing`);
  }
  const h = full.reduce((s, p) => s + p.material.t_ply_mm!, 0);
  let z = -h / 2;
  const out: ExpandedPly[] = full.map((p) => {
    const t = p.material.t_ply_mm!;
    const ply = { material: p.material, angleDeg: p.angleDeg, t, zBottom: z, zTop: z + t, mirrored: p.mirrored };
    z += t;
    return ply;
  });
  return { plies: out, h };
}

export function analyzeLaminate(plies: PlyInput[], materials: Map<string, MaterialProps>, symmetric: boolean): LaminateResult {
  if (!plies.length) throw new Error("No plies");
  const { plies: stack, h } = expandStack(plies, materials, symmetric);
  const A = zero(),
    B = zero(),
    D = zero();
  let arealMass: number | null = 0;
  let arealCost: number | null = 0;

  for (const p of stack) {
    const q = qBar(p.material, p.angleDeg);
    const z0 = p.zBottom,
      z1 = p.zTop;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        A[i][j] += q[i][j] * (z1 - z0);
        B[i][j] += (q[i][j] * (z1 * z1 - z0 * z0)) / 2;
        D[i][j] += (q[i][j] * (z1 ** 3 - z0 ** 3)) / 3;
      }
    // g/cm³ × mm = kg/m²
    const rho = p.material.density_g_cc;
    const pm = rho != null ? rho * p.t : null;
    arealMass = arealMass !== null && pm !== null ? arealMass + pm : null;
    arealCost = arealCost !== null && pm !== null && p.material.cost_per_kg != null ? arealCost + pm * p.material.cost_per_kg : null;
  }

  const a = invert3(A);
  const d = invert3(D);
  const warnings: string[] = [];
  const maxA = Math.max(...A.flat().map(Math.abs));
  const maxB = Math.max(...B.flat().map(Math.abs));
  if (maxB > 1e-6 * maxA * h) warnings.push("Not symmetric: the layup has bending–extension coupling (B ≠ 0) and may warp on cure");
  if (Math.abs(A[0][2]) + Math.abs(A[1][2]) > 1e-6 * maxA) warnings.push("Not balanced: shear–extension coupling (A16/A26 ≠ 0)");

  return {
    plies: stack,
    h,
    A,
    B,
    D,
    Ex: 1 / (h * a[0][0]),
    Ey: 1 / (h * a[1][1]),
    Gxy: 1 / (h * a[2][2]),
    nuxy: -a[0][1] / a[0][0],
    Efx: 12 / (h ** 3 * d[0][0]),
    Efy: 12 / (h ** 3 * d[1][1]),
    arealMass,
    arealCost,
    warnings,
  };
}

/** Values a part's equations can use, e.g. `layup_t`, `layup_Ex`, `layup_areal_mass`. */
export function laminateScope(r: LaminateResult): Record<string, unknown> {
  const u = (v: number, unit: string) => math.unit(v, unit);
  const s: Record<string, unknown> = {
    layup_t: u(r.h, "mm"),
    layup_n: r.plies.length,
    layup_Ex: u(r.Ex, "GPa"),
    layup_Ey: u(r.Ey, "GPa"),
    layup_Gxy: u(r.Gxy, "GPa"),
    layup_nuxy: r.nuxy,
    layup_Efx: u(r.Efx, "GPa"),
    layup_Efy: u(r.Efy, "GPa"),
    // GPa·mm = 1000 N/mm² · mm = 1000 N/mm;  GPa·mm³ = 1000 N·mm
    layup_A11: u(r.A[0][0] * 1000, "N/mm"),
    layup_A22: u(r.A[1][1] * 1000, "N/mm"),
    layup_A66: u(r.A[2][2] * 1000, "N/mm"),
    layup_D11: u(r.D[0][0] * 1000, "N mm"),
    layup_D22: u(r.D[1][1] * 1000, "N mm"),
    layup_D66: u(r.D[2][2] * 1000, "N mm"),
  };
  if (r.arealMass !== null) s.layup_areal_mass = u(r.arealMass, "kg/m^2");
  if (r.arealCost !== null) s.layup_areal_cost = math.evaluate(`${r.arealCost} / m^2`);
  return s;
}

export const LAYUP_VARIABLES: { name: string; desc: string }[] = [
  { name: "layup_t", desc: "total laminate thickness" },
  { name: "layup_n", desc: "number of plies (after symmetry)" },
  { name: "layup_areal_mass", desc: "mass per area" },
  { name: "layup_areal_cost", desc: "material cost per area" },
  { name: "layup_Ex / layup_Ey", desc: "effective in-plane moduli" },
  { name: "layup_Gxy, layup_nuxy", desc: "effective shear modulus, Poisson's ratio" },
  { name: "layup_Efx / layup_Efy", desc: "effective flexural moduli" },
  { name: "layup_A11 … layup_A66", desc: "in-plane stiffness (N/mm)" },
  { name: "layup_D11 … layup_D66", desc: "bending stiffness (N·mm)" },
];

/** Values a material exposes to equations as <slug>.<name>. */
export function materialScope(m: MaterialProps): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const put = (name: string, v: number | null, unit?: string) => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return;
    s[name] = unit ? math.unit(Number(v), unit) : Number(v);
  };
  put("E1", m.e1_gpa, "GPa");
  put("E2", m.e2_gpa, "GPa");
  put("G12", m.g12_gpa, "GPa");
  put("nu12", m.nu12);
  put("rho", m.density_g_cc, "g/cm^3");
  put("t_ply", m.t_ply_mm, "mm");
  put("Xt", m.xt_mpa, "MPa");
  put("Xc", m.xc_mpa, "MPa");
  put("Yt", m.yt_mpa, "MPa");
  put("Yc", m.yc_mpa, "MPa");
  put("S12", m.s12_mpa, "MPa");
  if (m.cost_per_kg != null) s.cost_kg = math.evaluate(`${Number(m.cost_per_kg)} / kg`);
  return s;
}

export const MATERIAL_FIELDS: { key: keyof MaterialProps; label: string; unit: string; ref: string }[] = [
  { key: "e1_gpa", label: "E1", unit: "GPa", ref: "E1" },
  { key: "e2_gpa", label: "E2", unit: "GPa", ref: "E2" },
  { key: "g12_gpa", label: "G12", unit: "GPa", ref: "G12" },
  { key: "nu12", label: "ν12", unit: "", ref: "nu12" },
  { key: "density_g_cc", label: "ρ", unit: "g/cm³", ref: "rho" },
  { key: "t_ply_mm", label: "t ply", unit: "mm", ref: "t_ply" },
  { key: "xt_mpa", label: "Xt", unit: "MPa", ref: "Xt" },
  { key: "xc_mpa", label: "Xc", unit: "MPa", ref: "Xc" },
  { key: "yt_mpa", label: "Yt", unit: "MPa", ref: "Yt" },
  { key: "yc_mpa", label: "Yc", unit: "MPa", ref: "Yc" },
  { key: "s12_mpa", label: "S12", unit: "MPa", ref: "S12" },
  { key: "cost_per_kg", label: "Cost", unit: "/kg", ref: "cost_kg" },
];

/**
 * Parse stacking-sequence notation into plies, e.g.
 *   "[0/±45/90]s"  → 0, +45, -45, 90, symmetric
 *   "[0_2/90]"     → 0 ×2, 90           ("0x2" also works)
 *   "0/45/-45/90"  → brackets optional
 */
export function parseLayup(text: string): { plies: { angleDeg: number; count: number }[]; symmetric: boolean } {
  let s = text.trim().replace(/\s+/g, "");
  if (!s) throw new Error("Enter a stacking sequence, e.g. [0/±45/90]s");
  let symmetric = false;
  const sym = s.match(/^(.*\])[sS]$/);
  if (sym) {
    symmetric = true;
    s = sym[1];
  }
  s = s.replace(/^\[/, "").replace(/\]$/, "");
  const plies: { angleDeg: number; count: number }[] = [];
  for (const tok of s.split("/")) {
    const m = tok.match(/^(±|\+-|\+\/-|-\+|∓)?([+-]?\d+(?:\.\d+)?)(?:[_xX](\d+))?$/);
    if (!m) throw new Error(`Can't read “${tok}” — use angles like 0, -45, ±45, 0_2`);
    const angle = Number(m[2]);
    const count = m[3] ? Number(m[3]) : 1;
    if (Math.abs(angle) > 90) throw new Error(`Angle ${angle}° is outside -90…90`);
    if (count < 1 || count > 200) throw new Error(`Count ${count} is out of range`);
    if (m[1]) {
      const sign = m[1] === "-+" || m[1] === "∓" ? -1 : 1;
      for (let i = 0; i < count; i++) plies.push({ angleDeg: sign * Math.abs(angle), count: 1 }, { angleDeg: -sign * Math.abs(angle), count: 1 });
    } else {
      plies.push({ angleDeg: angle, count });
    }
  }
  return { plies, symmetric };
}

/** Compact stacking-sequence text for a ply list, e.g. "[0/45/-45/90]s". */
export function formatLayup(plies: { angleDeg: number; count: number }[], symmetric: boolean) {
  const body = plies.map((p) => `${p.angleDeg}${p.count > 1 ? `_${p.count}` : ""}`).join("/");
  return `[${body}]${symmetric ? "s" : ""}`;
}
