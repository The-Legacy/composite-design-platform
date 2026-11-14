import { useState } from "react";
import { useMaterials, useTableMutations } from "../data/queries";
import { useComposites } from "../data/composites";
import { MATERIAL_FIELDS, type MaterialForm, type MaterialProps } from "../equations/laminate";
import type { Material } from "../lib/types";
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, Select, cx } from "../components/ui";
import { useProjectCtx } from "./projectContext";

const FORMS: { value: MaterialForm; label: string }[] = [
  { value: "ud", label: "Unidirectional" },
  { value: "fabric", label: "Woven fabric" },
  { value: "core", label: "Core" },
  { value: "isotropic", label: "Isotropic (metal, plastic)" },
];

type Preset = Omit<MaterialProps, "id"> & { notes: string };
const blank = { e1_gpa: null, e2_gpa: null, g12_gpa: null, nu12: null, density_g_cc: null, t_ply_mm: null, xt_mpa: null, xc_mpa: null, yt_mpa: null, yc_mpa: null, s12_mpa: null, cost_per_kg: null };

/** Typical textbook values — a starting point; replace them with your supplier's datasheet. */
const PRESETS: Preset[] = [
  { ...blank, name: "Carbon UD / epoxy (T700 class)", slug: "CF_UD", form: "ud", e1_gpa: 135, e2_gpa: 10, g12_gpa: 5, nu12: 0.3, density_g_cc: 1.55, t_ply_mm: 0.15, xt_mpa: 2150, xc_mpa: 1200, yt_mpa: 50, yc_mpa: 200, s12_mpa: 70, notes: "Typical values — replace with datasheet" },
  { ...blank, name: "Carbon 3K 2×2 twill / epoxy", slug: "CF_twill", form: "fabric", e1_gpa: 60, e2_gpa: 60, g12_gpa: 4.5, nu12: 0.05, density_g_cc: 1.45, t_ply_mm: 0.22, xt_mpa: 600, xc_mpa: 550, yt_mpa: 600, yc_mpa: 550, s12_mpa: 90, notes: "Typical values — replace with datasheet" },
  { ...blank, name: "E-glass 7781 / epoxy", slug: "GF_7781", form: "fabric", e1_gpa: 25, e2_gpa: 24, g12_gpa: 4, nu12: 0.12, density_g_cc: 1.9, t_ply_mm: 0.23, xt_mpa: 440, xc_mpa: 425, yt_mpa: 400, yc_mpa: 400, s12_mpa: 70, notes: "Typical values — replace with datasheet" },
  { ...blank, name: "Nomex honeycomb 3 pcf, 1/4 in", slug: "nomex_core", form: "core", e1_gpa: 0.001, e2_gpa: 0.001, g12_gpa: 0.0005, nu12: 0.3, density_g_cc: 0.048, t_ply_mm: 6.35, notes: "In-plane values ≈ 0 so the core adds thickness and mass, not membrane stiffness" },
  { ...blank, name: "Aluminum 6061-T6", slug: "Al6061", form: "isotropic", e1_gpa: 68.9, nu12: 0.33, density_g_cc: 2.7, t_ply_mm: 1, xt_mpa: 310, xc_mpa: 310, s12_mpa: 207, notes: "Thickness = sheet gauge; strengths are ultimate" },
];

export const toIdent = (name: string) => {
  let s = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[A-Za-z]/.test(s)) s = "m_" + s;
  return s.slice(0, 32) || "material";
};

export default function MaterialsPage() {
  const { project, parts, canEdit } = useProjectCtx();
  const materials = useMaterials(project.id);
  const { plies } = useComposites(project.id);
  const { create, update, remove } = useTableMutations<Material>("materials", project.id);
  const [adding, setAdding] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const list = materials.data ?? [];
  const usedBy = (id: string) => new Set(plies.filter((p) => p.material_id === id).map((p) => p.part_id)).size;

  const numCommit = (m: Material, key: keyof MaterialProps, raw: string) => {
    const t = raw.trim();
    const n = t === "" ? null : Number(t);
    if (n !== null && !Number.isFinite(n)) return alert("Enter a number (or leave blank)");
    if (n !== m[key]) update.mutate({ id: m.id, [key]: n } as Partial<Material> & { id: string });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Materials</h1>
          <p className="mt-1 text-sm text-slate-600">
            Ply and core properties used by part layups. Equations can also use them directly, e.g.{" "}
            <code className="font-mono">{list[0]?.slug ?? "CF_UD"}.E1</code> or <code className="font-mono">{list[0]?.slug ?? "CF_UD"}.t_ply</code>.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Add material
          </Button>
        )}
      </div>
      <ErrorText error={materials.error ?? update.error ?? create.error} />
      {removeError && <ErrorText error={new Error(removeError)} />}

      {list.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Form</th>
                {MATERIAL_FIELDS.map((f) => (
                  <th key={f.key} className="px-1.5 py-2 text-right font-medium" title={`${f.ref}${f.unit ? ` (${f.unit})` : ""}`}>
                    {f.label}
                    {f.unit && <div className="font-normal text-slate-400">{f.unit}</div>}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                  <td className="px-2 py-1">
                    <Cell defaultValue={m.name} disabled={!canEdit} onCommit={(v) => v.trim() && v !== m.name && update.mutate({ id: m.id, name: v.trim() })} className="w-48 font-medium" />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-700" title="Rename by recreating — formulas reference this ID">
                    {m.slug}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={m.form}
                      disabled={!canEdit}
                      onChange={(e) => update.mutate({ id: m.id, form: e.target.value as MaterialForm })}
                      className="rounded border border-transparent bg-transparent py-1 text-xs hover:border-slate-200"
                    >
                      {FORMS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {MATERIAL_FIELDS.map((f) => (
                    <td key={f.key} className="px-0.5 py-1">
                      <Cell
                        defaultValue={m[f.key] == null ? "" : String(m[f.key])}
                        disabled={!canEdit}
                        onCommit={(v) => numCommit(m, f.key, v)}
                        className="w-16 text-right font-mono"
                        placeholder="—"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <Cell defaultValue={m.notes} disabled={!canEdit} onCommit={(v) => v !== m.notes && update.mutate({ id: m.id, notes: v })} className="w-56" placeholder="—" />
                  </td>
                  <td className="py-1 pr-2 text-right text-xs whitespace-nowrap text-slate-400">
                    {usedBy(m.id) > 0 && <span title="Parts whose layup uses this material">{usedBy(m.id)} parts</span>}
                    {canEdit && (
                      <button
                        className="ml-1 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                        title="Delete material"
                        onClick={async () => {
                          setRemoveError(null);
                          if (usedBy(m.id)) return setRemoveError(`${m.name} is used in ${usedBy(m.id)} part layup(s). Remove those plies first.`);
                          if (!confirm(`Delete ${m.name}? Formulas using ${m.slug}.* will show errors.`)) return;
                          remove.mutate(m.id, { onError: (e) => setRemoveError((e as Error).message) });
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Blank E2/G12 are filled in for isotropic materials (E2 = E1, G12 = E1 / 2(1+ν)). Core and fabric need all four elastic values.
            Strengths are for reference and equations; the layup analysis uses stiffness, thickness, density and cost.
          </div>
        </Card>
      ) : (
        <EmptyState title="No materials yet">{canEdit ? "Add one from a preset and edit the values to match your datasheet." : "An editor needs to add materials."}</EmptyState>
      )}

      <AddMaterialModal
        open={adding}
        onClose={() => setAdding(false)}
        takenSlugs={new Set([...list.map((m) => m.slug), ...parts.map((p) => p.slug)])}
        onCreate={(m) => create.mutateAsync(m as Partial<Material>)}
      />
    </div>
  );
}

function Cell({ defaultValue, onCommit, className, ...props }: { defaultValue: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue">) {
  return (
    <input
      key={defaultValue}
      defaultValue={defaultValue}
      {...props}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = defaultValue;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cx(
        "rounded-md border border-transparent bg-transparent px-1.5 py-1.5 outline-none hover:border-slate-200 focus:border-accent focus:bg-white disabled:hover:border-transparent",
        className,
      )}
    />
  );
}

function AddMaterialModal({
  open,
  onClose,
  takenSlugs,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  takenSlugs: Set<string>;
  onCreate: (m: Omit<Preset, never>) => Promise<unknown>;
}) {
  const [preset, setPreset] = useState(0);
  const [name, setName] = useState(PRESETS[0].name);
  const [slug, setSlug] = useState(PRESETS[0].slug);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z][A-Za-z0-9_]*$/.test(slug);
  const taken = takenSlugs.has(slug);

  const pick = (i: number) => {
    setPreset(i);
    const p = i >= 0 ? PRESETS[i] : null;
    setName(p?.name ?? "");
    setSlug(p?.slug ?? "");
  };

  return (
    <Modal open={open} onClose={onClose} title="Add material">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setBusy(true);
          try {
            const base: Preset = preset >= 0 ? PRESETS[preset] : { ...blank, name, slug, form: "ud", notes: "" };
            await onCreate({ ...base, name: name.trim(), slug });
            onClose();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Start from">
          <Select className="w-full" value={preset} onChange={(e) => pick(Number(e.target.value))}>
            {PRESETS.map((p, i) => (
              <option key={p.slug} value={i}>
                {p.name}
              </option>
            ))}
            <option value={-1}>Blank</option>
          </Select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !slug && setSlug(toIdent(name))} />
        </Field>
        <Field
          label="Equation ID"
          hint={taken ? <span className="text-red-600">Already used by a material or part</span> : <>Formulas use <code className="font-mono">{slug || "ID"}.E1</code></>}
        >
          <Input className="font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">Preset values are typical, not design allowables. Edit them in the table to match your datasheet.</p>
        <ErrorText error={err ? new Error(err) : null} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || !valid || taken || busy}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}
