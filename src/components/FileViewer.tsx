import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { viewerFor } from "../../shared/fileTypes";
import { downloadFile, fetchFileBlob } from "../lib/api";
import type { FileRow } from "../lib/types";
import { Button, Modal, Spinner, formatBytes } from "./ui";

const ModelViewer = lazy(() => import("./viewers/ModelViewer"));
const DxfView = lazy(() => import("./viewers/DxfView"));

export default function FileViewer({ file, onClose }: { file: FileRow | null; onClose: () => void }) {
  return (
    <Modal
      open={Boolean(file)}
      onClose={onClose}
      wide
      title={
        file && (
          <div className="flex items-center gap-3">
            <span className="truncate">{file.name}</span>
            {file.revision && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal">Rev {file.revision}</span>}
            <span className="text-xs font-normal text-slate-400">{formatBytes(file.size_bytes)}</span>
            <Button size="sm" onClick={() => downloadFile(file)}>
              Download
            </Button>
            {file.drive_url && (
              <a href={file.drive_url} target="_blank" rel="noreferrer" className="text-xs font-normal text-accent hover:underline">
                Open in Drive ↗
              </a>
            )}
          </div>
        )
      }
    >
      {file && <ViewerBody key={file.id} file={file} />}
    </Modal>
  );
}

function ViewerBody({ file }: { file: FileRow }) {
  const viewer = viewerFor(file.name);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    fetchFileBlob(file.id)
      .then((b) => !cancelled && setBlob(b))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [file.id, viewer]);

  const typed = useMemo(() => (blob ? new Blob([blob], { type: file.mime_type }) : null), [blob, file.mime_type]);
  const objectUrl = useMemo(() => (typed ? URL.createObjectURL(typed) : null), [typed]);
  useEffect(() => () => void (objectUrl && URL.revokeObjectURL(objectUrl)), [objectUrl]);

  if (!viewer)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-slate-600">
        <div>
          No in-browser preview for <b>.{file.name.split(".").pop()}</b> files.
        </div>
        <div className="max-w-md text-slate-500">
          Tip: alongside native CAD files (SolidWorks, Fusion, DWG…), upload a STEP export for 3D viewing or a PDF/DXF export of
          drawings.
        </div>
        <Button variant="primary" onClick={() => downloadFile(file)}>
          Download
        </Button>
      </div>
    );
  if (error) return <div className="p-8 text-sm text-red-700">{error}</div>;
  if (!typed || !objectUrl) return <Spinner full />;

  return (
    <Suspense fallback={<Spinner full />}>
      {viewer === "pdf" && <iframe title={file.name} src={objectUrl} className="h-full w-full border-0" />}
      {viewer === "image" && (
        <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:20px_20px] p-4">
          <img src={objectUrl} alt={file.name} className="max-h-full max-w-full object-contain shadow" />
        </div>
      )}
      {viewer === "dxf" && <DxfView blob={typed} />}
      {(viewer === "step" || viewer === "iges" || viewer === "stl" || viewer === "obj" || viewer === "gltf") && (
        <ModelViewer blob={typed} format={viewer} />
      )}
    </Suspense>
  );
}
