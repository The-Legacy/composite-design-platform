import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useEvaluation } from "../components/EquationSheet";
import { groupRevisions } from "../components/FilePanel";
import { useFiles } from "../data/queries";
import { useComposites } from "../data/composites";
import { math } from "../equations/engine";
import { formatLayup } from "../equations/laminate";
import { Button, Card, CardHeader, EmptyState, Page, PageHeader, Select, Stat, StatusBadge, Warning } from "../components/ui";
import { BoxIcon, DownloadIcon, ScaleIcon } from "../components/icons";
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
    <Page width="wide">
      <PageHeader
        title="Mass & BOM"
        description={
          <>
            Sums each part's <code className="code-chip">mass</code> and <code className="code-chip">cost</code> variables, times{" "}
            <code className="code-chip">qty</code> (default 1). Add those names to a part's equation sheet, e.g.{" "}
            <code className="code-chip">mass = layup_areal_mass * 0.12 m^2</code>.
          </>
        }
        actions={
          <>
            <Select value={unit} onChange={(e) => setUnit(e.target.value as MassUnit)} title="Mass unit">
              {MASS_UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
            <Button onClick={exportCsv} disabled={!rows.length}>
              <DownloadIcon /> Export CSV
            </Button>
          </>
        }
      />

      {rows.length ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-4">
              <Stat
                icon={ScaleIcon}
                label="Total mass"
                value={
                  <>
                    {fmt(total(rows, "mass"))} <span className="text-base font-medium text-slate-400">{unit}</span>
                  </>
                }
                hint={missingMass > 0 && <Warning>{missingMass} part{missingMass === 1 ? " has" : "s have"} no mass yet</Warning>}
              />
              <Stat icon={BoxIcon} label="Total cost" value={fmt(total(rows, "cost"), 2)} />
            </div>
            <Card className="p-4 md:col-span-2">
              <div className="text-xs font-medium text-slate-500">Mass by subsystem</div>
              <div className="mt-3 space-y-3">
                {[...bySub].map(([s, list]) => {
                  const t = total(list, "mass");
                  const all = total(rows, "mass") || 1;
                  return (
                    <div key={s} className="text-[13px]">
                      <div className="mb-1 flex justify-between gap-3">
                        <span className="font-medium text-slate-700">{s}</span>
                        <span className="font-mono text-slate-600 tabular-nums">
                          {fmt(t)} {unit} <span className="ml-1 text-slate-400">{Math.round((t / all) * 100)}%</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-accent to-[oklch(0.6_0.17_275)] transition-all" style={{ width: `${(t / all) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader title="Bill of materials" description={`${rows.length} parts across ${bySub.size} subsystems`} />
            <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-2.5 font-semibold">Part</th>
                  <th className="px-3 py-2.5 font-semibold">P/N</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mass each</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mass total</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Cost total</th>
                  <th className="px-3 py-2.5 font-semibold">Layup</th>
                </tr>
              </thead>
              {[...bySub].map(([s, list]) => (
                <tbody key={s}>
                  <tr className="border-y border-slate-200/70 bg-slate-50/80 text-xs font-semibold text-slate-700">
                    <td className="px-4 py-2" colSpan={5}>
                      {s}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {fmt(total(list, "mass"))} {unit}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(total(list, "cost"), 2)}</td>
                    <td />
                  </tr>
                  {list.map((r) => (
                    <tr key={r.partId} className="border-b border-slate-100 align-top transition-colors last:border-b-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2">
                        <Link to={`/p/${project.id}/part/${r.partId}`} className="font-medium text-slate-900 hover:text-accent">
                          {r.name}
                        </Link>
                        {r.problems.map((p) => (
                          <div key={p} className="mt-0.5">
                            <Warning>{p}</Warning>
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.partNumber}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.qty}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(r.mass)}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">{r.mass === null ? "—" : fmt(r.mass * r.qty)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.cost === null ? "—" : fmt(r.cost * r.qty, 2)}</td>
                      <td className="max-w-[260px] truncate px-3 py-2 font-mono text-xs text-slate-500" title={r.layup}>
                        {r.layup}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            </div>
          </Card>
        </>
      ) : (
        <EmptyState icon={ScaleIcon} title="No parts yet">
          Add parts with <code className="code-chip">mass</code> variables to see the rollup.
        </EmptyState>
      )}
    </Page>
  );
}
