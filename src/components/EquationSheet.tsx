import { useMemo, useState, type KeyboardEvent } from "react";
import katex from "katex";
import { evaluateProject, isValidIdentifier, toTex, type VarResult } from "../equations/engine";
import { useParts, useTableMutations, useVariables } from "../data/queries";
import { useComposites } from "../data/composites";
import VariableHistory from "./VariableHistory";
import type { Part, Variable } from "../lib/types";
import { Button, Card, CardHeader, Disclosure, ErrorText, IconButton, Warning, cx } from "./ui";
import { FunctionIcon, HistoryIcon, PlusIcon, SigmaIcon, TrashIcon } from "./icons";

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
      <CardHeader
        icon={partId ? FunctionIcon : SigmaIcon}
        title={partId ? "Equations & variables" : "Project variables"}
        description={
          partId ? (
            <>
              Other parts use these as <code className="code-chip">{thisPart?.slug}.name</code>. Project variables are available by bare name.
            </>
          ) : (
            "Shared constants (materials, loads, safety factors…) every part can use by bare name."
          )
        }
        actions={
          rows.length > 0 && (
            <div className="hidden items-center gap-3 text-[11px] text-slate-500 md:flex">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-accent-muted ring-1 ring-accent/30" /> uses
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> used by
              </span>
            </div>
          )
        }
      />
      {(update.error ?? create.error ?? remove.error ?? vars.error) && (
        <div className="px-4 pt-3">
          <ErrorText error={update.error ?? create.error ?? remove.error ?? vars.error} />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="w-44 py-2 pr-2 pl-5 font-semibold">Name</th>
              <th className="px-2 py-2 font-semibold">Value / formula</th>
              <th className="w-48 px-2 py-2 font-semibold">Result</th>
              <th className="w-24 px-2 py-2 font-semibold">Show in</th>
              <th className="w-56 px-2 py-2 font-semibold">Notes</th>
              <th className="w-20" />
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
                    "group relative border-b border-slate-100 align-top transition-colors",
                    isDep ? "bg-accent-soft" : isDependent ? "bg-amber-50/80" : hovered === v.id ? "bg-slate-50/80" : "",
                  )}
                >
                  <td className="relative py-1.5 pr-2 pl-5">
                    <span
                      className={cx(
                        "absolute inset-y-0 left-0 w-[3px]",
                        isDep ? "bg-accent" : isDependent ? "bg-amber-400" : hovered === v.id ? "bg-slate-300" : "bg-transparent",
                      )}
                    />
                    <CellInput {...inputProps("name")} className="font-mono font-medium text-slate-900" />
                  </td>
                  <td className="px-2 py-1.5">
                    <CellInput {...inputProps("expression")} className="font-mono text-slate-700" placeholder="e.g. 0.25 mm or E1 * t_ply" />
                    {tex && <Tex tex={tex} className="mt-1 block px-2 text-slate-500" />}
                    <RefLine r={r} refLabel={refLabel} />
                  </td>
                  <td className="px-2 py-1.5">
                    <div
                      className={cx(
                        "mt-0.5 inline-flex max-w-full rounded-md px-2 py-1 font-mono text-[13px] tabular-nums",
                        r?.error ? "bg-red-50 text-red-700 ring-1 ring-red-200/70 ring-inset" : "bg-slate-100/80 font-semibold text-slate-900",
                      )}
                      title={r?.error}
                    >
                      <span className="truncate">{r?.text}</span>
                    </div>
                    {r?.error && <div className="mt-1 px-0.5 text-xs text-red-600">{r.error}</div>}
                    {r?.warnings.map((w) => (
                      <div key={w} className="mt-1 px-0.5">
                        <Warning>{w}</Warning>
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-1.5">
                    <CellInput {...inputProps("display_unit")} className="font-mono" placeholder="unit" />
                  </td>
                  <td className="px-2 py-1.5">
                    <CellInput {...inputProps("description")} className="text-slate-600" placeholder="—" />
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    <span className="inline-flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton title="Change history" onClick={() => setHistoryFor(v)}>
                        <HistoryIcon size={15} />
                      </IconButton>
                      {canEdit && (
                        <IconButton
                          tone="danger"
                          title="Delete variable"
                          onClick={() => {
                            const users = r?.dependents.length ?? 0;
                            if (confirm(users ? `${users} other variable(s) use ${v.name}. Delete anyway?` : `Delete ${v.name}?`)) remove.mutate(v.id);
                          }}
                        >
                          <TrashIcon size={15} />
                        </IconButton>
                      )}
                    </span>
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
      {!rows.length && !canEdit && <div className="p-8 text-center text-sm text-slate-500">No variables yet.</div>}
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
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 px-2 text-[11px] text-slate-400">
      {r.deps.length > 0 && (
        <span>
          <span className="text-slate-500">uses</span> <span className="font-mono">{r.deps.map(refLabel).join(", ")}</span>
        </span>
      )}
      {r.dependents.length > 0 && (
        <span>
          <span className="text-slate-500">used by</span> <span className="font-mono">{r.dependents.map(refLabel).join(", ")}</span>
        </span>
      )}
    </div>
  );
}

function CellInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-[13px] outline-none transition placeholder:text-slate-300 hover:border-slate-200 hover:bg-white focus:border-accent focus:bg-white focus:ring-3 focus:ring-accent/15 disabled:hover:border-transparent disabled:hover:bg-transparent",
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
    <tr className="bg-slate-50/50">
      <td className="py-2.5 pr-2 pl-5">
        <CellInput id="new-var-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} placeholder="new_name" className="border-slate-200 bg-white font-mono shadow-card" />
      </td>
      <td className="px-2 py-2.5">
        <CellInput value={expression} onChange={(e) => setExpression(e.target.value)} onKeyDown={onKey} placeholder="value or formula" className="border-slate-200 bg-white font-mono shadow-card" />
        {err && <div className="px-2 pt-1 text-xs text-red-600">{err}</div>}
      </td>
      <td className="px-2 py-2.5">
        <Button size="sm" variant="primary" className="h-8" onClick={submit}>
          <PlusIcon size={14} /> Add variable
        </Button>
      </td>
      <td className="px-2 py-2.5">
        <CellInput value={unit} onChange={(e) => setUnit(e.target.value)} onKeyDown={onKey} placeholder="unit" className="border-slate-200 bg-white font-mono shadow-card" />
      </td>
      <td colSpan={2} className="px-2 py-2.5 align-middle text-[11px] text-slate-400">
        Press Enter to add
      </td>
    </tr>
  );
}

function Help({ partSlug, otherParts }: { partSlug?: string; otherParts: Part[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
      <Disclosure open={open} onToggle={() => setOpen(!open)}>
        Formula help
      </Disclosure>
      {open && (
        <div className="mt-3 grid gap-x-8 gap-y-4 pb-2 leading-relaxed sm:grid-cols-2 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-px [&_code]:text-slate-700">
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
