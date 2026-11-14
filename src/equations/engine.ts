/**
 * Parametric equation engine.
 *
 * Variables live either at project level (globals) or on a part. Each one has an
 * `expression` which may be a plain value ("135 GPa"), or a formula referencing other variables:
 *
 *   - bare name `t_ply`        → variable on the same part, else a project global
 *   - qualified `spar_cap.t_ply` → variable `t_ply` on the part whose slug is `spar_cap`
 *   - qualified `T700.E1`      → property of the material whose slug is `T700`
 *   - bare `layup_t` inside a part → a value computed from that part's ply layup
 *
 * Units are handled by mathjs, so `E1 * t_ply` yields `GPa mm`, and a display unit
 * like `kN/mm` converts the result. Results are recomputed for the whole project in
 * dependency order whenever anything changes; cycles and missing references become errors.
 */
import { create, all, type MathNode, type EvalFunction } from "mathjs";

export const math = create(all, { number: "number", precision: 64 });

export interface VarInput {
  id: string;
  partId: string | null;
  name: string;
  expression: string;
  displayUnit: string;
}

export interface PartRef {
  id: string;
  slug: string;
  name?: string;
}

export interface VarResult {
  id: string;
  value: unknown;
  /** formatted value (in display unit if given) */
  text: string;
  error?: string;
  warnings: string[];
  /** ids of variables this one references directly */
  deps: string[];
  /** ids of variables that reference this one directly */
  dependents: string[];
}

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
export const isValidIdentifier = (s: string) => IDENT.test(s);

/** Names that mathjs already knows (functions, constants, units) — usable without a variable. */
function isBuiltin(name: string): boolean {
  if (name in math) return true;
  try {
    return math.Unit.isValuelessUnit(name);
  } catch {
    return false;
  }
}

/** Warn when a variable name hides a unit/constant (e.g. naming a variable `m` hides meters). */
export function shadowWarning(name: string): string | null {
  try {
    if (math.Unit.isValuelessUnit(name)) return `“${name}” is also a unit; inside formulas it now means this variable`;
  } catch {
    /* ignore */
  }
  if (name in math) return `“${name}” is also a built-in math name; inside formulas it now means this variable`;
  return null;
}

type Ref = { kind: "bare"; name: string } | { kind: "qualified"; slug: string; name: string };

/** Find every variable reference in an expression tree. */
function collectRefs(root: MathNode): Ref[] {
  const refs: Ref[] = [];
  const fnSymbols = new Set<MathNode>();
  const accessorObjects = new Set<MathNode>();

  root.traverse((node) => {
    const n = node as any;
    if (n.isAssignmentNode || n.isFunctionAssignmentNode) {
      throw new Error("Assignments aren't allowed — just write the expression");
    }
    if (n.isFunctionNode && n.fn?.isSymbolNode) fnSymbols.add(n.fn);
    if (n.isAccessorNode && n.object?.isSymbolNode && n.index?.isObjectProperty?.()) {
      accessorObjects.add(n.object);
      refs.push({ kind: "qualified", slug: n.object.name, name: n.index.getObjectProperty() });
    }
  });
  root.traverse((node) => {
    const n = node as any;
    if (n.isSymbolNode && !fnSymbols.has(node) && !accessorObjects.has(node)) {
      refs.push({ kind: "bare", name: n.name });
    }
  });
  return refs;
}

interface Compiled {
  v: VarInput;
  code?: EvalFunction;
  error?: string;
  deps: string[];
}

/** Values computed outside the sheet (materials library, layup analysis). */
export interface EvalExtras {
  /** material slug → properties with units, referenced as slug.prop */
  materials?: Map<string, Record<string, unknown>>;
  /** part id → computed values (e.g. layup_t), usable by bare name on that part or as slug.name */
  partValues?: Map<string, Record<string, unknown>>;
}

export function evaluateProject(vars: VarInput[], parts: PartRef[], extras: EvalExtras = {}): Map<string, VarResult> {
  const materials = extras.materials ?? new Map<string, Record<string, unknown>>();
  const partValues = extras.partValues ?? new Map<string, Record<string, unknown>>();
  const has = (o: Record<string, unknown> | undefined, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const partBySlug = new Map(parts.map((p) => [p.slug, p]));
  const key = (partId: string | null, name: string) => `${partId ?? "$global"}::${name}`;
  const byKey = new Map(vars.map((v) => [key(v.partId, v.name), v]));
  const byId = new Map(vars.map((v) => [v.id, v]));

  // 1. Parse + resolve references
  const compiled = new Map<string, Compiled>();
  for (const v of vars) {
    const c: Compiled = { v, deps: [] };
    compiled.set(v.id, c);
    try {
      if (!v.expression.trim()) throw new Error("Empty expression");
      const node = math.parse(v.expression);
      const deps = new Set<string>();
      for (const r of collectRefs(node)) {
        if (r.kind === "qualified") {
          const part = partBySlug.get(r.slug);
          if (!part) {
            const mat = materials.get(r.slug);
            if (mat) {
              if (!has(mat, r.name))
                throw new Error(`Material “${r.slug}” has no value for “${r.name}” (has: ${Object.keys(mat).join(", ") || "nothing yet"})`);
              continue;
            }
            throw new Error(`Unknown part or material “${r.slug}” (e.g. spar_cap.t_ply or T700.E1)`);
          }
          const target = byKey.get(key(part.id, r.name));
          if (target) deps.add(target.id);
          else if (!has(partValues.get(part.id), r.name)) throw new Error(`Part “${r.slug}” has no variable “${r.name}”`);
        } else {
          // A part variable named like a global may reference that global, e.g. part `E = 1.1 * E`.
          let own = v.partId ? byKey.get(key(v.partId, r.name)) : undefined;
          if (own?.id === v.id) own = undefined;
          const target = own ?? byKey.get(key(null, r.name));
          if (target?.id === v.id) throw new Error("A variable can't reference itself");
          if (!own && v.partId && has(partValues.get(v.partId), r.name)) {
            // computed part value (e.g. layup_t); takes precedence over a global of the same name
          } else if (target) {
            deps.add(target.id);
          } else if (partBySlug.has(r.name)) {
            throw new Error(`“${r.name}” is a part — reference one of its variables, e.g. ${r.name}.x`);
          } else if (materials.has(r.name)) {
            throw new Error(`“${r.name}” is a material — reference one of its properties, e.g. ${r.name}.E1`);
          } else if (!isBuiltin(r.name)) {
            throw new Error(`Unknown variable or unit “${r.name}”`);
          }
        }
      }
      if (deps.has(v.id)) throw new Error("A variable can't reference itself");
      c.deps = [...deps];
      c.code = node.compile();
    } catch (e) {
      c.error = (e as Error).message;
    }
  }

  // 2. Topological order with cycle detection
  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0/undefined = new, 1 = visiting, 2 = done
  const cycleErr = new Map<string, string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      const cyc = stack.slice(stack.indexOf(id)).concat(id);
      const msg = "Circular reference: " + cyc.map((x) => label(byId.get(x)!, partById)).join(" → ");
      for (const x of cyc) if (!cycleErr.has(x)) cycleErr.set(x, msg);
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const d of compiled.get(id)!.deps) visit(d);
    stack.pop();
    state.set(id, 2);
    order.push(id);
  };
  for (const v of vars) visit(v.id);

  // 3. Evaluate in order
  const values = new Map<string, unknown>();
  const globalScope: Record<string, unknown> = {};
  const partScopes = new Map<string, Record<string, unknown>>(parts.map((p) => [p.id, { ...partValues.get(p.id) }]));
  const slugScope: Record<string, unknown> = {};
  for (const [slug, props] of materials) slugScope[slug] = props;
  for (const p of parts) slugScope[p.slug] = partScopes.get(p.id); // parts win over a material with the same slug

  const results = new Map<string, VarResult>();
  for (const id of order) {
    const c = compiled.get(id)!;
    const v = c.v;
    const res: VarResult = { id, value: undefined, text: "", warnings: [], deps: c.deps, dependents: [] };
    results.set(id, res);

    let error = c.error ?? cycleErr.get(id);
    if (!error) {
      const bad = c.deps.find((d) => results.get(d)?.error);
      if (bad) error = `Depends on ${label(byId.get(bad)!, partById)}, which has an error`;
    }
    if (!error && c.code) {
      try {
        const own = v.partId ? partScopes.get(v.partId) ?? {} : {};
        const scope = Object.assign({}, slugScope, globalScope, own);
        let value = c.code.evaluate(scope);
        if (typeof value === "function" || value === undefined) throw new Error("Expression doesn't produce a value");
        if (math.isResultSet?.(value)) value = (value as any).entries.at(-1);
        values.set(id, value);
        res.value = value;
        if (v.partId) {
          const ps = partScopes.get(v.partId);
          if (ps) ps[v.name] = value;
        } else {
          globalScope[v.name] = value;
        }
      } catch (e) {
        error = (e as Error).message;
      }
    }

    if (error) {
      res.error = error;
      res.text = "—";
    } else {
      const f = formatValue(res.value, v.displayUnit);
      res.text = f.text;
      if (f.warning) res.warnings.push(f.warning);
    }
    const sh = shadowWarning(v.name);
    if (sh) res.warnings.push(sh);
  }

  for (const r of results.values()) for (const d of r.deps) results.get(d)?.dependents.push(r.id);
  return results;
}

function label(v: VarInput, partById: Map<string, PartRef>) {
  if (!v.partId) return v.name;
  const p = partById.get(v.partId);
  return p ? `${p.slug}.${v.name}` : v.name;
}

export function formatValue(value: unknown, displayUnit: string, precision = 6): { text: string; warning?: string } {
  const unit = displayUnit.trim();
  try {
    if (math.isUnit(value)) {
      if (unit) {
        try {
          return { text: math.format((value as any).to(unit), { precision }) };
        } catch {
          return { text: math.format(value, { precision }), warning: `Can't convert to “${unit}” (incompatible units)` };
        }
      }
      return { text: math.format(value, { precision }) };
    }
    if (typeof value === "number" && unit) {
      // A unitless number with a display unit: allow dimensionless units like "%", else warn.
      return { text: `${math.format(value, { precision })}`, warning: `Result is unitless; display unit “${unit}” ignored` };
    }
    return { text: math.format(value, { precision }) };
  } catch {
    return { text: String(value) };
  }
}

/** LaTeX for a pretty preview of an expression (null if it doesn't parse). */
export function toTex(expression: string): string | null {
  try {
    return math.parse(expression).toTex({ parenthesis: "keep", implicit: "hide" });
  } catch {
    return null;
  }
}
