export type FileKind = "model_3d" | "drawing" | "image" | "document" | "other";

/** Which in-browser viewer can render a file (null = download only). */
export type ViewerType = "step" | "iges" | "stl" | "obj" | "gltf" | "pdf" | "dxf" | "image" | null;

const EXT_INFO: Record<string, { kind: FileKind; viewer: ViewerType; mime: string }> = {
  // 3D models
  step: { kind: "model_3d", viewer: "step", mime: "model/step" },
  stp: { kind: "model_3d", viewer: "step", mime: "model/step" },
  iges: { kind: "model_3d", viewer: "iges", mime: "model/iges" },
  igs: { kind: "model_3d", viewer: "iges", mime: "model/iges" },
  stl: { kind: "model_3d", viewer: "stl", mime: "model/stl" },
  obj: { kind: "model_3d", viewer: "obj", mime: "model/obj" },
  glb: { kind: "model_3d", viewer: "gltf", mime: "model/gltf-binary" },
  "3mf": { kind: "model_3d", viewer: null, mime: "model/3mf" },
  sldprt: { kind: "model_3d", viewer: null, mime: "application/octet-stream" },
  sldasm: { kind: "model_3d", viewer: null, mime: "application/octet-stream" },
  f3d: { kind: "model_3d", viewer: null, mime: "application/octet-stream" },
  ipt: { kind: "model_3d", viewer: null, mime: "application/octet-stream" },
  iam: { kind: "model_3d", viewer: null, mime: "application/octet-stream" },
  x_t: { kind: "model_3d", viewer: null, mime: "application/octet-stream" },
  // Technical drawings
  pdf: { kind: "drawing", viewer: "pdf", mime: "application/pdf" },
  dxf: { kind: "drawing", viewer: "dxf", mime: "image/vnd.dxf" },
  dwg: { kind: "drawing", viewer: null, mime: "image/vnd.dwg" },
  slddrw: { kind: "drawing", viewer: null, mime: "application/octet-stream" },
  idw: { kind: "drawing", viewer: null, mime: "application/octet-stream" },
  // Images / sketches
  png: { kind: "image", viewer: "image", mime: "image/png" },
  jpg: { kind: "image", viewer: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", viewer: "image", mime: "image/jpeg" },
  gif: { kind: "image", viewer: "image", mime: "image/gif" },
  webp: { kind: "image", viewer: "image", mime: "image/webp" },
  svg: { kind: "image", viewer: "image", mime: "image/svg+xml" },
  // Documents
  csv: { kind: "document", viewer: null, mime: "text/csv" },
  txt: { kind: "document", viewer: null, mime: "text/plain" },
  md: { kind: "document", viewer: null, mime: "text/markdown" },
  xlsx: { kind: "document", viewer: null, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  docx: { kind: "document", viewer: null, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pptx: { kind: "document", viewer: null, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function guessKind(name: string): FileKind {
  return EXT_INFO[extensionOf(name)]?.kind ?? "other";
}

export function viewerFor(name: string): ViewerType {
  return EXT_INFO[extensionOf(name)]?.viewer ?? null;
}

export function guessMime(name: string, fallback?: string | null): string {
  const known = EXT_INFO[extensionOf(name)]?.mime;
  if (known && known !== "application/octet-stream") return known;
  return fallback || known || "application/octet-stream";
}

export const FILE_KINDS: { value: FileKind; label: string }[] = [
  { value: "model_3d", label: "3D model" },
  { value: "drawing", label: "Technical drawing" },
  { value: "image", label: "2D image / sketch" },
  { value: "document", label: "Document" },
  { value: "other", label: "Other" },
];

export const ACCEPTED_EXTENSIONS = Object.keys(EXT_INFO).map((e) => "." + e);

export function isFileKind(v: unknown): v is FileKind {
  return typeof v === "string" && FILE_KINDS.some((k) => k.value === v);
}
