import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useFiles, useMaterials, useVariables } from "../data/queries";
import type { Part, Subsystem } from "../lib/types";
import { groupRevisions } from "./FilePanel";
import { Kbd, cx } from "./ui";
import { BoxIcon, ComponentIcon, DashboardIcon, FileTextIcon, LayersIcon, SearchIcon, SigmaIcon } from "./icons";

const KIND_ICON: Record<Hit["kind"], typeof BoxIcon> = {
  Part: BoxIcon,
  Subsystem: ComponentIcon,
  File: FileTextIcon,
  Variable: SigmaIcon,
  Material: LayersIcon,
  Page: DashboardIcon,
};

interface Hit {
  key: string;
  kind: "Part" | "Subsystem" | "File" | "Variable" | "Material" | "Page";
  title: string;
  sub: string;
  to: string;
  /** lower-case haystack */
  text: string;
}

/** Score: exact/prefix matches on the title rank above substring matches anywhere. */
function score(h: Hit, terms: string[]) {
  let s = 0;
  const t = h.title.toLowerCase();
  for (const term of terms) {
    if (!h.text.includes(term)) return -1;
    if (t === term) s += 100;
    else if (t.startsWith(term)) s += 50;
    else if (t.includes(term)) s += 20;
    else s += 5;
  }
  return s;
}

export default function SearchPalette({ projectId, parts, subsystems }: { projectId: string; parts: Part[]; subsystems: Subsystem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const files = useFiles(projectId).data ?? [];
  const vars = useVariables(projectId).data ?? [];
  const materials = useMaterials(projectId).data ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-search", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const index = useMemo<Hit[]>(() => {
    const base = `/p/${projectId}`;
    const partById = new Map(parts.map((p) => [p.id, p]));
    const subById = new Map(subsystems.map((s) => [s.id, s]));
    const hits: Hit[] = [
      { key: "pg-vars", kind: "Page", title: "Project variables", sub: "", to: `${base}/globals`, text: "project variables globals" },
      { key: "pg-mat", kind: "Page", title: "Materials", sub: "", to: `${base}/materials`, text: "materials library" },
      { key: "pg-bom", kind: "Page", title: "Mass & BOM", sub: "", to: `${base}/rollup`, text: "mass bom rollup cost bill of materials" },
      { key: "pg-team", kind: "Page", title: "Team & settings", sub: "", to: `${base}/settings`, text: "team settings members" },
    ];
    for (const s of subsystems)
      hits.push({ key: `s-${s.id}`, kind: "Subsystem", title: s.name, sub: s.description, to: `${base}/s/${s.id}`, text: `${s.name} ${s.description}`.toLowerCase() });
    for (const p of parts)
      hits.push({
        key: `p-${p.id}`,
        kind: "Part",
        title: p.name,
        sub: [p.part_number, p.slug, subById.get(p.subsystem_id)?.name].filter(Boolean).join(" · "),
        to: `${base}/part/${p.id}`,
        text: `${p.name} ${p.slug} ${p.part_number} ${p.description}`.toLowerCase(),
      });
    for (const { current: f, revs } of groupRevisions(files)) {
      const where = f.part_id ? partById.get(f.part_id)?.name : f.subsystem_id ? subById.get(f.subsystem_id)?.name : "project";
      const page = f.part_id ? `${base}/part/${f.part_id}` : f.subsystem_id ? `${base}/s/${f.subsystem_id}` : base;
      hits.push({
        key: `f-${f.id}`,
        kind: "File",
        title: f.name,
        sub: [where, revs.length > 1 ? `r${f.rev_number}` : "", f.revision].filter(Boolean).join(" · "),
        to: `${page}?file=${f.id}`,
        text: `${f.name} ${f.revision} ${f.notes} ${where ?? ""}`.toLowerCase(),
      });
    }
    for (const v of vars) {
      const p = v.part_id ? partById.get(v.part_id) : undefined;
      const ref = p ? `${p.slug}.${v.name}` : v.name;
      hits.push({
        key: `v-${v.id}`,
        kind: "Variable",
        title: ref,
        sub: `${v.expression}${v.description ? ` — ${v.description}` : ""}`,
        to: p ? `${base}/part/${p.id}` : `${base}/globals`,
        text: `${ref} ${v.name} ${v.expression} ${v.description}`.toLowerCase(),
      });
    }
    for (const m of materials)
      hits.push({ key: `m-${m.id}`, kind: "Material", title: m.name, sub: m.slug, to: `${base}/materials`, text: `${m.name} ${m.slug} ${m.notes}`.toLowerCase() });
    return hits;
  }, [projectId, parts, subsystems, files, vars, materials]);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return index.filter((h) => h.kind === "Page" || h.kind === "Part").slice(0, 12);
    return index
      .map((h) => ({ h, s: score(h, terms) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.h);
  }, [index, q]);

  if (!open) return null;
  const go = (h?: Hit) => {
    if (!h) return;
    setOpen(false);
    navigate(h.to);
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-slate-950/40 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div className="w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl bg-white shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
        <SearchIcon size={18} className="shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            }
            if (e.key === "Enter") go(results[sel]);
          }}
          placeholder="Search parts, files, variables, materials…"
          className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-slate-400"
        />
        <Kbd>Esc</Kbd>
        </div>
        {!q && <div className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Jump to</div>}
        <ul className="max-h-[50vh] overflow-auto p-2">
          {results.map((h, i) => (
            <li key={h.key}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => go(h)}
                className={cx("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left", i === sel ? "bg-accent-soft" : "")}
              >
                {(() => {
                  const Icon = KIND_ICON[h.kind];
                  return (
                    <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", i === sel ? "bg-white text-accent shadow-card" : "bg-slate-100 text-slate-500")}>
                      <Icon size={14} />
                    </span>
                  );
                })()}
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-sm font-medium text-slate-900", h.kind === "Variable" && "font-mono text-[13px]")}>{h.title}</span>
                  {h.sub && <span className="block truncate text-xs text-slate-500">{h.sub}</span>}
                </span>
                <span className={cx("shrink-0 text-[11px] font-medium", i === sel ? "text-accent" : "text-slate-400")}>{h.kind}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-4 py-8 text-center text-sm text-slate-500">No matches for “{q}”</li>}
        </ul>
        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Enter</Kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}
