import { useMemo, useState } from "react";
import { Link } from "react-router";
import EquationSheet, { useEvaluation } from "../components/EquationSheet";
import { Card, CardHeader, Input, Page, PageHeader } from "../components/ui";
import { SearchIcon } from "../components/icons";
import { RecentChanges } from "../components/VariableHistory";
import { useProjectCtx } from "./projectContext";

export default function GlobalsPage() {
  const { project, canEdit } = useProjectCtx();
  return (
    <Page>
      <PageHeader
        title="Project variables"
        description="Define shared inputs once — material properties, loads, safety factors, mission parameters — and every part's equations update when they change."
      />
      <EquationSheet projectId={project.id} partId={null} canEdit={canEdit} />
      <AllVariables projectId={project.id} />
      <RecentChanges projectId={project.id} />
    </Page>
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
      <CardHeader
        title="Every variable in the project"
        description={`${vars.data?.length ?? 0} variables across all parts`}
        actions={
          <div className="relative w-64">
            <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <Input compact className="pl-8" placeholder="Filter by name, part, note…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      />
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-slate-50/95 backdrop-blur">
            <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-5 py-2 font-semibold">Reference</th>
              <th className="px-4 py-2 font-semibold">Part</th>
              <th className="px-4 py-2 font-semibold">Formula</th>
              <th className="px-4 py-2 font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, p, ref, r }) => (
              <tr key={v.id} className="border-b border-slate-100/70 hover:bg-slate-50/80">
                <td className="px-5 py-2 font-mono text-[13px] font-medium text-slate-900">{ref}</td>
                <td className="px-4 py-2 text-slate-600">
                  {p ? (
                    <Link to={`/p/${projectId}/part/${p.id}`} className="hover:text-accent">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="text-slate-400">project</span>
                  )}
                </td>
                <td className="max-w-[320px] truncate px-4 py-2 font-mono text-[13px] text-slate-500" title={v.expression}>{v.expression}</td>
                <td className={`px-4 py-2 font-mono text-[13px] tabular-nums ${r?.error ? "text-red-600" : "font-semibold text-slate-900"}`} title={r?.error}>
                  {r?.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-8 text-center text-sm text-slate-500">No variables match.</div>}
      </div>
    </Card>
  );
}
