import { useMemo } from "react";
import { analyzeLaminate, laminateScope, materialScope, type LaminateResult } from "../equations/laminate";
import { useLayupPlies, useMaterials, useParts } from "./queries";
import type { LayupPly, Material, Part } from "../lib/types";

export type LaminateOutcome = { ok: true; result: LaminateResult } | { ok: false; error: string };

export function computeLaminates(parts: Part[], plies: LayupPly[], materials: Material[]) {
  const matById = new Map(materials.map((m) => [m.id, m]));
  const byPart = new Map<string, LayupPly[]>();
  for (const p of plies) {
    const list = byPart.get(p.part_id) ?? [];
    list.push(p);
    byPart.set(p.part_id, list);
  }
  const out = new Map<string, LaminateOutcome>();
  for (const part of parts) {
    const list = byPart.get(part.id);
    if (!list?.length) continue;
    try {
      const sorted = [...list].sort((a, b) => a.position - b.position);
      const result = analyzeLaminate(
        sorted.map((p) => ({ materialId: p.material_id, angleDeg: Number(p.angle_deg), count: p.count })),
        matById,
        part.layup_symmetric,
      );
      out.set(part.id, { ok: true, result });
    } catch (e) {
      out.set(part.id, { ok: false, error: (e as Error).message });
    }
  }
  return out;
}

/** Laminate analysis for every part, plus the extra scopes the equation engine needs. */
export function useComposites(projectId: string) {
  const parts = useParts(projectId);
  const plies = useLayupPlies(projectId);
  const materials = useMaterials(projectId);
  return useMemo(() => {
    const laminates = computeLaminates(parts.data ?? [], plies.data ?? [], materials.data ?? []);
    const partValues = new Map<string, Record<string, unknown>>();
    for (const [partId, o] of laminates) if (o.ok) partValues.set(partId, laminateScope(o.result));
    const materialScopes = new Map((materials.data ?? []).map((m) => [m.slug, materialScope(m)]));
    return { laminates, partValues, materialScopes, materials: materials.data ?? [], plies: plies.data ?? [] };
  }, [parts.data, plies.data, materials.data]);
}
