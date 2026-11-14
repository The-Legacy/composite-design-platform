import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "../lib/supabase";
import { qk, useTableMutations } from "../data/queries";
import { useComposites } from "../data/composites";
import { formatLayup, LAYUP_VARIABLES, parseLayup, type LaminateResult } from "../equations/laminate";
import type { LayupPly, Part } from "../lib/types";
import { Button, Card, ErrorText, Input, cx } from "./ui";

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
      <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Layup</h2>
        {current && <code className="font-mono text-sm text-slate-600">{current}</code>}
        <span className="ml-auto text-xs text-slate-500">Plies listed from the tool side (bottom) up</span>
      </div>
      <ErrorText error={create.error ?? update.error ?? remove.error ?? partMut.update.error} />

      {!materials.length ? (
        <div className="p-4 text-sm text-slate-500">
          No materials yet. {canEdit && <Link to={`/p/${part.project_id}/materials`} className="text-accent hover:underline">Add materials</Link>} to build a layup.
        </div>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_minmax(260px,340px)]">
          <div className="min-w-0 space-y-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="w-8 py-1 font-medium">#</th>
                  <th className="py-1 font-medium">Material</th>
                  <th className="w-20 py-1 font-medium">Angle °</th>
                  <th className="w-16 py-1 font-medium">Count</th>
                  <th className="py-1 font-medium">Label</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {plies.map((p, i) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-1 text-xs text-slate-400">
                      <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: angleColor(Number(p.angle_deg)) }} />
                      {i + 1}
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        value={p.material_id}
                        disabled={!canEdit}
                        onChange={(e) => update.mutate({ id: p.id, material_id: e.target.value })}
                        className="w-full rounded border border-transparent bg-transparent py-1 hover:border-slate-200"
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
                        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-slate-200 focus:border-accent focus:outline-none"
                      />
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <IconBtn title="Move toward tool side" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                            ↑
                          </IconBtn>
                          <IconBtn title="Move toward bag side" disabled={i === plies.length - 1} onClick={() => swap(i, i + 1)}>
                            ↓
                          </IconBtn>
                          <IconBtn title="Remove ply" onClick={() => remove.mutate(p.id)} className="hover:text-red-600">
                            ✕
                          </IconBtn>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!plies.length && (
                  <tr>
                    <td colSpan={6} className="py-3 text-center text-sm text-slate-500">
                      No plies yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {canEdit && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-slate-500">Add ply:</span>
                  {[0, 45, -45, 90].map((a) => (
                    <Button
                      key={a}
                      size="sm"
                      onClick={() => create.mutate({ part_id: part.id, material_id: defaultMaterial, angle_deg: a, count: 1, position: nextPos })}
                    >
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: angleColor(a) }} />
                      {a}°
                    </Button>
                  ))}
                  <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
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
                  <Input value={notation} onChange={(e) => setNotation(e.target.value)} placeholder="Type a sequence: [0/±45/90]s  or  [0_2/90]" className="py-1.5 font-mono" />
                  <Button size="sm" disabled={!notation.trim()}>
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
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{outcome.error}</div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">Add plies to see thickness, mass and stiffness.</div>
            )}
          </div>
        </div>
      )}

      {outcome?.ok && (
        <div className="space-y-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          <div className="flex gap-4">
            <button className="hover:text-slate-700" onClick={() => setShowMatrices(!showMatrices)}>
              {showMatrices ? "▾" : "▸"} ABD matrices
            </button>
            <button className="hover:text-slate-700" onClick={() => setShowVars(!showVars)}>
              {showVars ? "▾" : "▸"} Use in equations
            </button>
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
                  <code className="font-mono text-slate-700">{v.name}</code> — {v.desc}
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

function IconBtn({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={cx("rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30", className)} />;
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
      className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 font-mono hover:border-slate-200 focus:border-accent focus:outline-none"
    />
  );
}

function StackDiagram({ r }: { r: LaminateResult }) {
  const maxH = 180;
  const top = [...r.plies].reverse();
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-slate-400">
        <span>bag side</span>
        <span>{fmt(r.h, 3)} mm</span>
      </div>
      <div className="overflow-hidden rounded border border-slate-200" style={{ maxHeight: maxH + 40 }}>
        {top.map((p, i) => (
          <div
            key={i}
            title={`${p.material.name} @ ${p.angleDeg}° · ${p.t} mm${p.mirrored ? " (mirrored)" : ""}`}
            className="flex items-center border-b border-white/60 px-2 text-[10px] leading-none text-white"
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
      <div className="mt-1 text-[11px] text-slate-400">tool side</div>
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
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      {r.warnings.map((w) => (
        <div key={w} className="mt-2 text-xs text-amber-700">
          ⚠ {w}
        </div>
      ))}
    </div>
  );
}

function Matrix({ title, m, scale }: { title: string; m: number[][]; scale: number }) {
  return (
    <div>
      <div className="mb-1 font-medium text-slate-600">{title}</div>
      <table className="font-mono text-[11px] text-slate-700">
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
