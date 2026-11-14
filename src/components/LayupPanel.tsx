import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "../lib/supabase";
import { qk, useTableMutations } from "../data/queries";
import { useComposites } from "../data/composites";
import { formatLayup, LAYUP_VARIABLES, parseLayup, type LaminateResult } from "../equations/laminate";
import type { LayupPly, Part } from "../lib/types";
import { Button, Card, CardHeader, Disclosure, ErrorText, IconButton, Input, Warning } from "./ui";
import { ArrowDownIcon, ArrowUpIcon, LayersIcon, TrashIcon } from "./icons";

const angleColor = (a: number) => {
  const x = Math.abs(a);
  if (x === 0) return "#3b82f6";
  if (x === 90) return "#f59e0b";
  if (x === 45) return a > 0 ? "#10b981" : "#8b5cf6";
  return "#94a3b8";
};

const fmt = (n: number, p = 4) => (Math.abs(n) < 1e-9 ? "0" : Number(n.toPrecision(p)).toLocaleString(undefined, { maximumSignificantDigits: p }));

export default function LayupPanel({ part, canEdit }: { part: Part; canEdit: boolean }) {
  const qc = useQueryClient();
  const { laminates, materials, plies: allPlies } = useComposites(part.project_id);
  const { create, update, remove } = useTableMutations<LayupPly>("layup_plies", part.project_id);
  const partMut = useTableMutations<Part>("parts", part.project_id);
  const [notation, setNotation] = useState("");
  const [notationErr, setNotationErr] = useState<string | null>(null);
  const [showMatrices, setShowMatrices] = useState(false);
  const [showVars, setShowVars] = useState(false);

  const plies = allPlies.filter((p) => p.part_id === part.id).sort((a, b) => a.position - b.position);
  const outcome = laminates.get(part.id);
  const matById = new Map(materials.map((m) => [m.id, m]));
  const defaultMaterial = plies.at(-1)?.material_id ?? materials[0]?.id;
  const nextPos = (plies.at(-1)?.position ?? -1) + 1;

  const swap = (i: number, j: number) => {
    if (!plies[i] || !plies[j]) return;
    const order = [...plies];
    [order[i], order[j]] = [order[j], order[i]];
    // renumber 0..n so duplicate positions can't make a move a no-op
    order.forEach((p, k) => p.position !== k && update.mutate({ id: p.id, position: k }));
  };

  const applyNotation = async () => {
    setNotationErr(null);
    try {
      if (!defaultMaterial) throw new Error("Add a material first");
      const parsed = parseLayup(notation);
      if (plies.length && !confirm(`Replace the ${plies.length} existing plies with ${notation}?`)) return;
      unwrap(await supabase.from("layup_plies").delete().eq("part_id", part.id));
      unwrap(
        await supabase.from("layup_plies").insert(
          parsed.plies.map((p, i) => ({
            project_id: part.project_id,
            part_id: part.id,
            material_id: defaultMaterial,
            angle_deg: p.angleDeg,
            count: p.count,
            position: i,
          })),
        ),
      );
      if (parsed.symmetric !== part.layup_symmetric) partMut.update.mutate({ id: part.id, layup_symmetric: parsed.symmetric });
      setNotation("");
    } catch (e) {
      setNotationErr((e as Error).message);
    } finally {
      qc.invalidateQueries({ queryKey: qk.layup_plies(part.project_id) });
    }
  };

  const current = plies.length ? formatLayup(plies.map((p) => ({ angleDeg: Number(p.angle_deg), count: p.count })), part.layup_symmetric) : "";

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={LayersIcon}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Layup
            {current && <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] font-medium text-slate-700">{current}</code>}
          </span>
        }
        description="Plies listed from the tool side (bottom) up"
      />
      {(create.error ?? update.error ?? remove.error ?? partMut.update.error) && (
        <div className="px-4 pt-3">
          <ErrorText error={create.error ?? update.error ?? remove.error ?? partMut.update.error} />
        </div>
      )}

      {!materials.length ? (
        <div className="p-6 text-center text-sm text-slate-500">
          No materials yet. {canEdit && <Link to={`/p/${part.project_id}/materials`} className="text-accent hover:underline">Add materials</Link>} to build a layup.
        </div>
      ) : (
        <div className="grid gap-6 p-4 lg:grid-cols-[1fr_minmax(280px,340px)] lg:p-5">
          <div className="min-w-0 space-y-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="w-12 pb-2 font-semibold">#</th>
                  <th className="pb-2 font-semibold">Material</th>
                  <th className="w-20 pb-2 font-semibold">Angle °</th>
                  <th className="w-16 pb-2 font-semibold">Count</th>
                  <th className="pb-2 font-semibold">Label</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {plies.map((p, i) => (
                  <tr key={p.id} className="group border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="py-1 text-xs text-slate-400 tabular-nums">
                      <span className="mr-1.5 inline-block h-3 w-1.5 rounded-full align-middle" style={{ background: angleColor(Number(p.angle_deg)) }} />
                      {i + 1}
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        value={p.material_id}
                        disabled={!canEdit}
                        onChange={(e) => update.mutate({ id: p.id, material_id: e.target.value })}
                        className="ui-select h-8 w-full rounded-md border border-transparent bg-transparent pl-1.5 text-[13px] hover:border-slate-200 hover:bg-white focus:border-accent focus:outline-none"
                      >
                        {materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <NumCell value={Number(p.angle_deg)} disabled={!canEdit} min={-90} max={90} onCommit={(angle_deg) => update.mutate({ id: p.id, angle_deg })} />
                    </td>
                    <td className="py-1 pr-2">
                      <NumCell value={p.count} disabled={!canEdit} min={1} max={200} integer onCommit={(count) => update.mutate({ id: p.id, count })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        key={p.label}
                        defaultValue={p.label}
                        disabled={!canEdit}
                        placeholder="—"
                        onBlur={(e) => e.target.value !== p.label && update.mutate({ id: p.id, label: e.target.value })}
                        className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-[13px] placeholder:text-slate-300 hover:border-slate-200 hover:bg-white focus:border-accent focus:bg-white focus:outline-none"
                      />
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {canEdit && (
                        <span className="inline-flex gap-0.5 opacity-40 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <IconButton size="sm" title="Move toward tool side" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                            <ArrowUpIcon size={13} />
                          </IconButton>
                          <IconButton size="sm" title="Move toward bag side" disabled={i === plies.length - 1} onClick={() => swap(i, i + 1)}>
                            <ArrowDownIcon size={13} />
                          </IconButton>
                          <IconButton size="sm" tone="danger" title="Remove ply" onClick={() => remove.mutate(p.id)}>
                            <TrashIcon size={13} />
                          </IconButton>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!plies.length && (
                  <tr>
                    <td colSpan={6} className="border-t border-slate-100 py-6 text-center text-sm text-slate-500">
                      No plies yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {canEdit && (
              <div className="space-y-3 rounded-lg bg-slate-50/80 p-3 ring-1 ring-slate-200/60 ring-inset">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs font-medium text-slate-500">Add ply</span>
                  {[0, 45, -45, 90].map((a) => (
                    <Button
                      key={a}
                      size="sm"
                      onClick={() => create.mutate({ part_id: part.id, material_id: defaultMaterial, angle_deg: a, count: 1, position: nextPos })}
                    >
                      <span className="inline-block h-2.5 w-1 rounded-full" style={{ background: angleColor(a) }} />
                      <span className="font-mono">{a}°</span>
                    </Button>
                  ))}
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded accent-[var(--color-accent)]"
                      checked={part.layup_symmetric}
                      onChange={(e) => partMut.update.mutate({ id: part.id, layup_symmetric: e.target.checked })}
                    />
                    Symmetric (mirror about midplane)
                  </label>
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    applyNotation();
                  }}
                >
                  <Input compact value={notation} onChange={(e) => setNotation(e.target.value)} placeholder="Type a sequence: [0/±45/90]s  or  [0_2/90]" className="font-mono text-[13px]" />
                  <Button size="sm" className="h-8" disabled={!notation.trim()}>
                    Set layup
                  </Button>
                </form>
                {notationErr && <div className="text-xs text-red-600">{notationErr}</div>}
                {plies.length > 0 && (
                  <p className="text-xs text-slate-400">The sequence uses the material of the last ply ({matById.get(defaultMaterial!)?.name}); change individual plies afterwards.</p>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            {outcome?.ok ? (
              <>
                <StackDiagram r={outcome.result} />
                <Results r={outcome.result} />
              </>
            ) : outcome ? (
              <ErrorText error={new Error(outcome.error)} />
            ) : (
              <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Add plies to see thickness, mass and stiffness.</div>
            )}
          </div>
        </div>
      )}

      {outcome?.ok && (
        <div className="space-y-3 border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          <div className="flex gap-5">
            <Disclosure open={showMatrices} onToggle={() => setShowMatrices(!showMatrices)}>
              ABD matrices
            </Disclosure>
            <Disclosure open={showVars} onToggle={() => setShowVars(!showVars)}>
              Use in equations
            </Disclosure>
          </div>
          {showMatrices && (
            <div className="grid gap-4 pb-2 sm:grid-cols-3">
              <Matrix title="A (N/mm)" m={outcome.result.A} scale={1000} />
              <Matrix title="B (N)" m={outcome.result.B} scale={1000} />
              <Matrix title="D (N·mm)" m={outcome.result.D} scale={1000} />
            </div>
          )}
          {showVars && (
            <ul className="grid gap-x-6 gap-y-0.5 pb-2 sm:grid-cols-2">
              {LAYUP_VARIABLES.map((v) => (
                <li key={v.name}>
                  <code className="code-chip">{v.name}</code> — {v.desc}
                </li>
              ))}
              <li className="sm:col-span-2">
                On this part's sheet use the bare name (e.g. <code className="font-mono">mass = layup_areal_mass * area</code>); elsewhere use{" "}
                <code className="font-mono">{part.slug}.layup_t</code>.
              </li>
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function NumCell({ value, onCommit, disabled, min, max, integer }: { value: number; onCommit: (n: number) => void; disabled?: boolean; min: number; max: number; integer?: boolean }) {
  return (
    <input
      key={value}
      defaultValue={value}
      disabled={disabled}
      inputMode="decimal"
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
          e.target.value = String(value);
          return;
        }
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 font-mono text-[13px] tabular-nums hover:border-slate-200 hover:bg-white focus:border-accent focus:bg-white focus:outline-none"
    />
  );
}

function StackDiagram({ r }: { r: LaminateResult }) {
  const maxH = 180;
  const top = [...r.plies].reverse();
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[11px] font-medium text-slate-400">
        <span className="tracking-wide uppercase">Bag side</span>
        <span className="font-mono text-slate-600 tabular-nums">{fmt(r.h, 3)} mm</span>
      </div>
      <div className="overflow-hidden rounded-lg shadow-card ring-1 ring-slate-900/10" style={{ maxHeight: maxH + 40 }}>
        {top.map((p, i) => (
          <div
            key={i}
            title={`${p.material.name} @ ${p.angleDeg}° · ${p.t} mm${p.mirrored ? " (mirrored)" : ""}`}
            className="flex items-center border-b border-white/50 px-2 text-[10px] leading-none font-medium text-white"
            style={{ height: Math.max(5, (p.t / r.h) * maxH), background: angleColor(p.angleDeg), opacity: p.mirrored ? 0.7 : 1 }}
          >
            {(p.t / r.h) * maxH >= 11 && (
              <span className="truncate">
                {p.angleDeg}° {p.material.slug}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase">Tool side</div>
    </div>
  );
}

function Results({ r }: { r: LaminateResult }) {
  const rows: [string, string][] = [
    ["Thickness", `${fmt(r.h)} mm`],
    ["Plies", String(r.plies.length)],
    ["Areal mass", r.arealMass !== null ? `${fmt(r.arealMass * 1000)} g/m²` : "— (material density missing)"],
    ["Material cost", r.arealCost !== null ? `${fmt(r.arealCost)} /m²` : "—"],
    ["Ex / Ey", `${fmt(r.Ex)} / ${fmt(r.Ey)} GPa`],
    ["Gxy", `${fmt(r.Gxy)} GPa`],
    ["νxy", fmt(r.nuxy, 3)],
    ["Flexural Ex / Ey", `${fmt(r.Efx)} / ${fmt(r.Efy)} GPa`],
  ];
  return (
    <div>
      <dl className="divide-y divide-slate-100 rounded-lg text-[13px] ring-1 ring-slate-200/80">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-mono font-medium text-slate-900 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {r.warnings.map((w) => (
        <div key={w} className="mt-2">
          <Warning>{w}</Warning>
        </div>
      ))}
    </div>
  );
}

function Matrix({ title, m, scale }: { title: string; m: number[][]; scale: number }) {
  return (
    <div>
      <div className="mb-1.5 font-medium text-slate-600">{title}</div>
      <table className="rounded-md bg-slate-50 font-mono text-[11px] text-slate-700 tabular-nums ring-1 ring-slate-200/70">
        <tbody>
          {m.map((row, i) => (
            <tr key={i}>
              {row.map((x, j) => (
                <td key={j} className="px-1.5 py-0.5 text-right">
                  {fmt(x * scale)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
