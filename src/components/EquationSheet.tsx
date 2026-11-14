import { useMemo, useState, type KeyboardEvent } from "react";
import katex from "katex";
import { evaluateProject, isValidIdentifier, toTex, type VarResult } from "../equations/engine";
import { useParts, useTableMutations, useVariables } from "../data/queries";
import { useComposites } from "../data/composites";
import VariableHistory from "./VariableHistory";
import type { Part, Variable } from "../lib/types";
import { Button, Card, ErrorText, cx } from "./ui";

type Draft = Partial<Pick<Variable, "name" | "expression" | "display_unit" | "description">>;

/** Evaluate every variable in the project (cross-part references need the whole set). */
export function useEvaluation(projectId: string, drafts?: Map<string, Draft>) {
  const vars = useVariables(projectId);
  const parts = useParts(projectId);
  const { partValues, materialScopes } = useComposites(projectId);
  const results = useMemo(() => {
    const list = (vars.data ?? []).map((v) => ({ ...v, ...drafts?.get(v.id) }));
    return evaluateProject(
      list.map((v) => ({ id: v.id, partId: v.part_id, name: v.name, expression: v.expression, displayUnit: v.display_unit })),
      (parts.data ?? []).map((p) => ({ id: p.id, slug: p.slug, name: p.name })),
      { partValues, materials: materialScopes },
    );
  }, [vars.data, parts.data, drafts, partValues, materialScopes]);
  return { vars, parts, results };
}

export function Tex({ tex, className }: { tex: string; className?: string }) {
  const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, displayMode: false }), [tex]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

const looksLikeFormula = (expr: string) => /[A-Za-z_]\w*\s*[*/^+\-(]|[*/^+\-(]\s*[A-Za-z_]|\(|\w+\.\w+/.test(expr);

export default function EquationSheet({
  projectId,
  partId,
  canEdit,
}: {
  projectId: string;
  /** null = project-level (global) variables */
  partId: string | null;
  canEdit: boolean;
}) {
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const { vars, parts, results } = useEvaluation(projectId, drafts);
  const { create, update, remove } = useTableMutations<Variable>("variables", projectId);
  const [hovered, setHovered] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<Variable | null>(null);

  const allVars = vars.data ?? [];
  const partById = useMemo(() => new Map((parts.data ?? []).map((p) => [p.id, p])), [parts.data]);
  const rows = allVars.filter((v) => v.part_id === partId);
  const thisPart = partId ? partById.get(partId) : undefined;
  const hoveredRes = hovered ? results.get(hovered) : undefined;

  const setDraft = (id: string, patch: Draft) =>
    setDrafts((d) => {
      const n = new Map(d);
      n.set(id, { ...n.get(id), ...patch });
      return n;
    });
  const clearDraft = (id: string) =>
    setDrafts((d) => {
      const n = new Map(d);
      n.delete(id);
      return n;
    });

  const commit = (v: Variable) => {
    const d = drafts.get(v.id);
    if (!d) return;
    const patch: Draft = {};
    for (const k of Object.keys(d) as (keyof Draft)[]) if (d[k] !== undefined && d[k] !== v[k]) patch[k] = d[k];
    if (patch.name !== undefined && (!isValidIdentifier(patch.name) || rows.some((r) => r.id !== v.id && r.name === patch.name))) {
      clearDraft(v.id);
      return alert("Names must be unique within this sheet, start with a letter, and contain only letters, digits and _");
    }
    if (Object.keys(patch).length) update.mutate({ id: v.id, ...patch }, { onSettled: () => clearDraft(v.id) });
    else clearDraft(v.id);
  };

  const refLabel = (id: string) => {
    const v = allVars.find((x) => x.id === id);
    if (!v) return "?";
    if (v.part_id === partId) return v.name;
    if (!v.part_id) return v.name;
    return `${partById.get(v.part_id)?.slug ?? "?"}.${v.name}`;
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">{partId ? "Equations & variables" : "Project variables"}</h2>
        <span className="text-xs text-slate-500">
          {partId ? (
            <>
              Other parts use these as <code className="font-mono text-slate-700">{thisPart?.slug}.name</code>. Project variables are
              available by bare name.
            </>
          ) : (
            "Shared constants (materials, loads, safety factors…) every part can use by bare name."
          )}
        </span>
      </div>
      <ErrorText error={update.error ?? create.error ?? remove.error ?? vars.error} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="w-40 px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Value / formula</th>
              <th className="w-44 px-3 py-2 font-medium">Result</th>
              <th className="w-24 px-3 py-2 font-medium">Show in</th>
              <th className="w-56 px-3 py-2 font-medium">Notes</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const d = drafts.get(v.id) ?? {};
              const val = { ...v, ...d };
              const r = results.get(v.id);
              const isDep = hoveredRes?.deps.includes(v.id);
              const isDependent = hoveredRes?.dependents.includes(v.id);
              const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  clearDraft(v.id);
                  (e.target as HTMLInputElement).blur();
                }
              };
              const inputProps = (field: keyof Draft) => ({
                value: val[field] ?? "",
                disabled: !canEdit,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(v.id, { [field]: e.target.value }),
                onBlur: () => commit(v),
                onKeyDown: onKey,
              });
              const tex = looksLikeFormula(val.expression) ? toTex(val.expression) : null;
              return (
                <tr
                  key={v.id}
                  onMouseEnter={() => setHovered(v.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={cx(
                    "border-b border-slate-100 align-top",
                    isDep && "bg-blue-50",
                    isDependent && "bg-amber-50",
                    hovered === v.id && "bg-slate-50",
                  )}
                >
                  <td className="px-3 py-1.5">
                    <CellInput {...inputProps("name")} className="font-mono font-medium" />
                  </td>
                  <td className="px-3 py-1.5">
                    <CellInput {...inputProps("expression")} className="font-mono" placeholder="e.g. 0.25 mm or E1 * t_ply" />
                    {tex && <Tex tex={tex} className="mt-1 block px-2 text-slate-600" />}
                    <RefLine r={r} refLabel={refLabel} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div
                      className={cx(
                        "px-2 py-1.5 font-mono",
                        r?.error ? "text-red-600" : "font-semibold text-slate-900",
                      )}
                      title={r?.error}
                    >
                      {r?.text}
                    </div>
                    {r?.error && <div className="px-2 text-xs text-red-600">{r.error}</div>}
                    {r?.warnings.map((w) => (
                      <div key={w} className="px-2 text-xs text-amber-700">
                        ⚠ {w}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-1.5">
                    <CellInput {...inputProps("display_unit")} className="font-mono" placeholder="unit" />
                  </td>
                  <td className="px-3 py-1.5">
                    <CellInput {...inputProps("description")} placeholder="—" />
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <button
                      className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-700"
                      title="Change history"
                      onClick={() => setHistoryFor(v)}
                    >
                      ⟲
                    </button>
                    {canEdit && (
                      <button
                        className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                        title="Delete variable"
                        onClick={() => {
                          const users = r?.dependents.length ?? 0;
                          if (confirm(users ? `${users} other variable(s) use ${v.name}. Delete anyway?` : `Delete ${v.name}?`)) remove.mutate(v.id);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {canEdit && (
              <NewRow
                existing={rows.map((r) => r.name)}
                onAdd={(row) => create.mutateAsync({ ...row, part_id: partId, position: rows.length })}
              />
            )}
          </tbody>
        </table>
      </div>
      {!rows.length && !canEdit && <div className="p-6 text-center text-sm text-slate-500">No variables yet.</div>}
      <Help partSlug={thisPart?.slug} otherParts={(parts.data ?? []).filter((p) => p.id !== partId)} />
      <VariableHistory
        projectId={projectId}
        variable={historyFor}
        canEdit={canEdit}
        onClose={() => setHistoryFor(null)}
        onRestore={(expression, display_unit) => historyFor && update.mutate({ id: historyFor.id, expression, display_unit })}
      />
    </Card>
  );
}

function RefLine({ r, refLabel }: { r?: VarResult; refLabel: (id: string) => string }) {
  if (!r || (!r.deps.length && !r.dependents.length)) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-3 px-2 text-[11px] text-slate-400">
      {r.deps.length > 0 && <span>uses {r.deps.map(refLabel).join(", ")}</span>}
      {r.dependents.length > 0 && <span>used by {r.dependents.map(refLabel).join(", ")}</span>}
    </div>
  );
}

function CellInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 outline-none hover:border-slate-200 focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 disabled:hover:border-transparent",
        className,
      )}
    />
  );
}

function NewRow({ existing, onAdd }: { existing: string[]; onAdd: (row: Partial<Variable>) => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [unit, setUnit] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!isValidIdentifier(name)) return setErr("Name must start with a letter and use only letters, digits, _");
    if (existing.includes(name)) return setErr(`“${name}” already exists here`);
    if (!expression.trim()) return setErr("Enter a value or formula");
    try {
      await onAdd({ name, expression, display_unit: unit });
      setName("");
      setExpression("");
      setUnit("");
      document.getElementById("new-var-name")?.focus();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const onKey = (e: KeyboardEvent) => e.key === "Enter" && submit();

  return (
    <tr className="bg-slate-50/60">
      <td className="px-3 py-2">
        <CellInput id="new-var-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} placeholder="new_name" className="border-slate-200 bg-white font-mono" />
      </td>
      <td className="px-3 py-2">
        <CellInput value={expression} onChange={(e) => setExpression(e.target.value)} onKeyDown={onKey} placeholder="value or formula" className="border-slate-200 bg-white font-mono" />
        {err && <div className="px-2 pt-1 text-xs text-red-600">{err}</div>}
      </td>
      <td className="px-3 py-2">
        <Button size="sm" variant="primary" onClick={submit}>
          Add
        </Button>
      </td>
      <td className="px-3 py-2">
        <CellInput value={unit} onChange={(e) => setUnit(e.target.value)} onKeyDown={onKey} placeholder="unit" className="border-slate-200 bg-white font-mono" />
      </td>
      <td colSpan={2} />
    </tr>
  );
}

function Help({ partSlug, otherParts }: { partSlug?: string; otherParts: Part[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
      <button onClick={() => setOpen(!open)} className="hover:text-slate-700">
        {open ? "▾" : "▸"} Formula help
      </button>
      {open && (
        <div className="mt-2 grid gap-4 pb-2 sm:grid-cols-2">
          <ul className="space-y-1">
            <li>
              Values with units: <code className="font-mono">135 GPa</code>, <code className="font-mono">0.25 mm</code>,{" "}
              <code className="font-mono">1.2 g/cm^3</code>, <code className="font-mono">30 deg</code>
            </li>
            <li>
              Formulas: <code className="font-mono">n_plies * t_ply</code>, <code className="font-mono">F / (w * t)</code>
            </li>
            <li>
              Functions: <code className="font-mono">sqrt, sin, cos, tan, abs, min, max, log, exp, pi</code>
            </li>
            <li>“Show in” converts the result, e.g. a stress in <code className="font-mono">MPa</code> or a length in <code className="font-mono">in</code>.</li>
          </ul>
          <ul className="space-y-1">
            <li>Bare names resolve to this sheet first, then the part's layup values, then project variables.</li>
            <li>
              Materials: <code className="font-mono">T700.E1</code>, <code className="font-mono">T700.t_ply</code>,{" "}
              <code className="font-mono">T700.rho</code> (see the Materials page).
            </li>
            {partSlug && (
              <li>
                Layup: <code className="font-mono">layup_t</code>, <code className="font-mono">layup_areal_mass</code>,{" "}
                <code className="font-mono">layup_Ex</code>, <code className="font-mono">layup_D11</code>…
              </li>
            )}
            <li>
              Rollups: a part variable named <code className="font-mono">mass</code>, <code className="font-mono">cost</code> or{" "}
              <code className="font-mono">qty</code> feeds the project mass &amp; BOM table.
            </li>
            {partSlug && (
              <li>
                Other parts reference this one as <code className="font-mono">{partSlug}.name</code>.
              </li>
            )}
            {otherParts.length > 0 && (
              <li>
                Part IDs:{" "}
                {otherParts.slice(0, 12).map((p) => (
                  <code key={p.id} className="mr-1 font-mono">
                    {p.slug}
                  </code>
                ))}
                {otherParts.length > 12 && "…"}
              </li>
            )}
            <li>Changes recompute everything that depends on them, live for the whole team.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
