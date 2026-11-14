import { useMemo, useState } from "react";
import { Link } from "react-router";
import EquationSheet, { useEvaluation } from "../components/EquationSheet";
import { Card, Input } from "../components/ui";
import { useProjectCtx } from "./projectContext";

export default function GlobalsPage() {
  const { project, canEdit } = useProjectCtx();
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Project variables</h1>
        <p className="mt-1 text-sm text-slate-600">
          Define shared inputs once — material properties, loads, safety factors, mission parameters — and every part's equations
          update when they change.
        </p>
      </div>
      <EquationSheet projectId={project.id} partId={null} canEdit={canEdit} />
      <AllVariables projectId={project.id} />
    </div>
  );
}

function AllVariables({ projectId }: { projectId: string }) {
  const { vars, parts, results } = useEvaluation(projectId);
  const [q, setQ] = useState("");
  const partById = useMemo(() => new Map((parts.data ?? []).map((p) => [p.id, p])), [parts.data]);
  const rows = (vars.data ?? [])
    .map((v) => {
      const p = v.part_id ? partById.get(v.part_id) : undefined;
      return { v, p, ref: p ? `${p.slug}.${v.name}` : v.name, r: results.get(v.id) };
    })
    .filter(({ v, p, ref }) => {
      const s = q.toLowerCase();
      return !s || ref.toLowerCase().includes(s) || v.description.toLowerCase().includes(s) || p?.name.toLowerCase().includes(s);
    })
    .sort((a, b) => a.ref.localeCompare(b.ref));

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Every variable in the project</h2>
        <Input className="ml-auto max-w-xs py-1.5" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">Reference</th>
              <th className="px-4 py-2 font-medium">Part</th>
              <th className="px-4 py-2 font-medium">Formula</th>
              <th className="px-4 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, p, ref, r }) => (
              <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-1.5 font-mono font-medium">{ref}</td>
                <td className="px-4 py-1.5 text-slate-600">
                  {p ? (
                    <Link to={`/p/${projectId}/part/${p.id}`} className="hover:text-accent">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="text-slate-400">project</span>
                  )}
                </td>
                <td className="px-4 py-1.5 font-mono text-slate-500">{v.expression}</td>
                <td className={`px-4 py-1.5 font-mono ${r?.error ? "text-red-600" : "font-semibold"}`} title={r?.error}>
                  {r?.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-6 text-center text-sm text-slate-500">No variables match.</div>}
      </div>
    </Card>
  );
}
