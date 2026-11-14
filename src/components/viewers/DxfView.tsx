import { useEffect, useRef, useState } from "react";
import { DxfViewer } from "dxf-viewer";
import fontUrl from "@fontsource/roboto/files/roboto-latin-400-normal.woff?url";
import { Spinner } from "../ui";

interface Layer {
  name: string;
  displayName: string;
  color: number;
  visible: boolean;
}

export default function DxfView({ blob }: { blob: Blob }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DxfViewer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [layers, setLayers] = useState<Layer[]>([]);
  const [showLayers, setShowLayers] = useState(false);

  useEffect(() => {
    let disposed = false;
    const url = URL.createObjectURL(blob);
    const viewer = new DxfViewer(ref.current!, { autoResize: true, colorCorrection: true, antialias: true });
    viewerRef.current = viewer;
    viewer
      .Load({ url, fonts: [fontUrl], workerFactory: null })
      .then(() => {
        if (disposed) return;
        setLayers([...(viewer.GetLayers() as Iterable<Layer>)]);
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (disposed) return;
        setError(e.message);
        setStatus("error");
      });
    return () => {
      disposed = true;
      viewer.Destroy();
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  return (
    <div className="relative h-full w-full bg-white">
      <div ref={ref} className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-600">
          <Spinner />
          Rendering drawing…
        </div>
      )}
      {status === "error" && <div className="absolute inset-0 flex items-center justify-center text-sm text-red-700">Couldn't display DXF: {error}</div>}
      {status === "ready" && layers.length > 0 && (
        <div className="absolute top-3 right-3 max-h-[70%] w-56 overflow-auto rounded-lg border border-slate-200 bg-white/95 text-xs shadow">
          <button className="w-full px-3 py-2 text-left font-medium" onClick={() => setShowLayers(!showLayers)}>
            Layers ({layers.length}) {showLayers ? "▾" : "▸"}
          </button>
          {showLayers &&
            layers.map((l) => (
              <label key={l.name} className="flex items-center gap-2 px-3 py-1 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={l.visible}
                  onChange={(e) => {
                    viewerRef.current?.ShowLayer(l.name, e.target.checked);
                    setLayers((ls) => ls.map((x) => (x.name === l.name ? { ...x, visible: e.target.checked } : x)));
                  }}
                />
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `#${l.color.toString(16).padStart(6, "0")}` }} />
                <span className="truncate">{l.displayName}</span>
              </label>
            ))}
        </div>
      )}
      <div className="absolute bottom-3 left-3 text-xs text-slate-400">Drag to pan · scroll to zoom</div>
    </div>
  );
}
