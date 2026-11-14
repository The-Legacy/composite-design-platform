import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useEvaluation } from "../components/EquationSheet";
import { groupRevisions } from "../components/FilePanel";
import { useFiles } from "../data/queries";
import { useComposites } from "../data/composites";
import { math } from "../equations/engine";
import { formatLayup } from "../equations/laminate";
import { Button, Card, EmptyState, Select } from "../components/ui";
import { useProjectCtx } from "./projectContext";

const MASS_UNITS = ["kg", "g", "lb", "oz"] as const;
type MassUnit = (typeof MASS_UNITS)[number];

interface Row {
  partId: string;
  subsystem: string;
  name: string;
  slug: string;
  partNumber: string;
  status: string;
  qty: number;
  /** each, in the chosen unit (null = no `mass` variable) */
  mass: number | null;
  cost: number | null;
  layup: string;
  files: number;
  problems: string[];
}

/** Read a value as a number in `unit`; returns a problem message if it can't. */
function asNumber(value: unknown, unit: string | null): { n: number | null; problem?: string } {
  if (value === undefined) return { n: null };
  try {
    if (math.isUnit(value)) {
      if (!unit) return { n: null, problem: "has units but should be a plain number" };
      return { n: (value as any).toNumber(unit) };
    }
    if (typeof value === "number") return unit ? { n: null, problem: `is unitless — give it a mass unit, e.g. 120 g` } : { n: value };
  } catch {
    return { n: null, problem: unit ? `isn't a mass` : "isn't a number" };
  }
  return { n: null, problem: "isn't a number" };
}

export default function RollupPage() {
  const { project, subsystems, parts } = useProjectCtx();
  const { vars, results } = useEvaluation(project.id);
  const { laminates, plies, materials } = useComposites(project.id);
  const files = useFiles(project.id).data ?? [];
  const [unit, setUnit] = useState<MassUnit>("kg");

  const rows = useMemo<Row[]>(() => {
    const subName = new Map(subsystems.map((s) => [s.id, s.name]));
    const subOrder = new Map(subsystems.map((s, i) => [s.id, i]));
    const matById = new Map(materials.map((m) => [m.id, m]));
    const currentFiles = groupRevisions(files).map((g) => g.current);
    return [...parts]
      .sort((a, b) => (subOrder.get(a.subsystem_id) ?? 0) - (subOrder.get(b.subsystem_id) ?? 0) || a.name.localeCompare(b.name))
      .map((p) => {
        const pv = (vars.data ?? []).filter((v) => v.part_id === p.id);
        const get = (name: string) => {
          const v = pv.find((x) => x.name === name);
          if (!v) return { value: undefined, error: undefined };
          const r = results.get(v.id);
          return { value: r?.error ? undefined : r?.value, error: r?.error };
        };
        const problems: string[] = [];
        const m = get("mass"),
          c = get("cost"),
          q = get("qty");
        if (m.error) problems.push(`mass: ${m.error}`);
        if (c.error) problems.push(`cost: ${c.error}`);
        if (q.error) problems.push(`qty: ${q.error}`);
        const mass = asNumber(m.value, unit);
        const cost = asNumber(c.value, null);
        const qty = asNumber(q.value, null);
        if (mass.problem) problems.push(`mass ${mass.problem}`);
        if (cost.problem) problems.push(`cost ${cost.problem}`);
        if (qty.problem) problems.push(`qty ${qty.problem}`);

        const pp = plies.filter((x) => x.part_id === p.id).sort((a, b) => a.position - b.position);
        const lam = laminates.get(p.id);
        const mats = [...new Set(pp.map((x) => matById.get(x.material_id)?.slug).filter(Boolean))].join(", ");
        const layup = pp.length
          ? `${formatLayup(pp.map((x) => ({ angleDeg: Number(x.angle_deg), count: x.count })), p.layup_symmetric)} ${mats}${lam?.ok ? ` · ${lam.result.h.toFixed(2)} mm` : ""}`
          : "";
        return {
          partId: p.id,
          subsystem: subName.get(p.subsystem_id) ?? "",
          name: p.name,
          slug: p.slug,
          partNumber: p.part_number,
          status: p.status,
          qty: qty.n ?? 1,
          mass: mass.n,
          cost: cost.n,
          layup,
          files: currentFiles.filter((f) => f.part_id === p.id).length,
          problems,
        };
      });
  }, [parts, subsystems, vars.data, results, unit, plies, laminates, materials, files]);

  const bySub = new Map<string, Row[]>();
  for (const r of rows) bySub.set(r.subsystem, [...(bySub.get(r.subsystem) ?? []), r]);
  const total = (list: Row[], k: "mass" | "cost") => list.reduce((s, r) => s + (r[k] ?? 0) * r.qty, 0);
  const missingMass = rows.filter((r) => r.mass === null).length;
  const fmt = (n: number | null, d = 3) => (n === null ? "—" : Number(n.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: d }));

  const exportCsv = () => {
    const header = ["Subsystem", "Part", "Part number", "Equation ID", "Status", "Qty", `Mass each (${unit})`, `Mass total (${unit})`, "Cost each", "Cost total", "Layup", "Files"];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header, ...rows.map((r) => [r.subsystem, r.name, r.partNumber, r.slug, r.status, r.qty, r.mass, r.mass === null ? null : r.mass * r.qty, r.cost, r.cost === null ? null : r.cost * r.qty, r.layup, r.files])];
    lines.push(["TOTAL", "", "", "", "", "", "", total(rows, "mass"), "", total(rows, "cost"), "", ""]);
    const blob = new Blob([lines.map((l) => l.map(esc).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^\w-]+/g, "_")}_BOM.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Mass &amp; BOM</h1>
          <p className="mt-1 text-sm text-slate-600">
            Sums each part's <code className="font-mono">mass</code> and <code className="font-mono">cost</code> variables, times{" "}
            <code className="font-mono">qty</code> (default 1). Add those names to a part's equation sheet, e.g.{" "}
            <code className="font-mono">mass = layup_areal_mass * 0.12 m^2</code>.
          </p>
        </div>
        <Select value={unit} onChange={(e) => setUnit(e.target.value as MassUnit)} className="py-1.5">
          {MASS_UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </Select>
        <Button onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </Button>
      </div>

      {rows.length ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <div className="text-xs text-slate-500">Total mass</div>
              <div className="mt-1 font-mono text-2xl font-semibold">
                {fmt(total(rows, "mass"))} {unit}
              </div>
              {missingMass > 0 && <div className="mt-1 text-xs text-amber-700">{missingMass} parts have no mass yet</div>}
            </Card>
            <Card className="p-4">
              <div className="text-xs text-slate-500">Total cost</div>
              <div className="mt-1 font-mono text-2xl font-semibold">{fmt(total(rows, "cost"), 2)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-slate-500">By subsystem</div>
              <div className="mt-2 space-y-1">
                {[...bySub].map(([s, list]) => {
                  const t = total(list, "mass");
                  const all = total(rows, "mass") || 1;
                  return (
                    <div key={s} className="text-xs">
                      <div className="flex justify-between">
                        <span>{s}</span>
                        <span className="font-mono">
                          {fmt(t)} {unit}
                        </span>
                      </div>
                      <div className="h-1.5 rounded bg-slate-100">
                        <div className="h-full rounded bg-accent" style={{ width: `${(t / all) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Part</th>
                  <th className="px-3 py-2 font-medium">P/N</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Mass each</th>
                  <th className="px-3 py-2 text-right font-medium">Mass total</th>
                  <th className="px-3 py-2 text-right font-medium">Cost total</th>
                  <th className="px-3 py-2 font-medium">Layup</th>
                </tr>
              </thead>
              {[...bySub].map(([s, list]) => (
                <tbody key={s}>
                  <tr className="bg-slate-50 text-xs font-semibold text-slate-600">
                    <td className="px-3 py-1.5" colSpan={5}>
                      {s}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {fmt(total(list, "mass"))} {unit}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(total(list, "cost"), 2)}</td>
                    <td />
                  </tr>
                  {list.map((r) => (
                    <tr key={r.partId} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                      <td className="px-3 py-1.5">
                        <Link to={`/p/${project.id}/part/${r.partId}`} className="font-medium hover:text-accent">
                          {r.name}
                        </Link>
                        {r.problems.map((p) => (
                          <div key={p} className="text-xs text-amber-700">
                            ⚠ {p}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.partNumber}</td>
                      <td className="px-3 py-1.5 text-xs">{r.status}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.qty}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmt(r.mass)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.mass === null ? "—" : fmt(r.mass * r.qty)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.cost === null ? "—" : fmt(r.cost * r.qty, 2)}</td>
                      <td className="max-w-[260px] truncate px-3 py-1.5 font-mono text-xs text-slate-500" title={r.layup}>
                        {r.layup}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </Card>
        </>
      ) : (
        <EmptyState title="No parts yet" />
      )}
    </div>
  );
}
