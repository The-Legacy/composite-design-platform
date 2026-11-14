import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Spinner } from "../ui";

export type ModelFormat = "step" | "iges" | "stl" | "obj" | "gltf";

const DEFAULT_COLOR = 0x8fa3bf;

interface OcctMesh {
  name?: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}

/** Convert STEP/IGES with OpenCascade in a web worker (keeps the UI responsive). */
function parseCad(buffer: ArrayBuffer, format: "step" | "iges"): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/occt-worker.js");
    worker.onmessage = (ev) => {
      worker.terminate();
      const { ok, result, error } = ev.data;
      if (!ok || !result?.success) return reject(new Error(error ?? "Could not read CAD file"));
      const group = new THREE.Group();
      for (const m of result.meshes as OcctMesh[]) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
        if (m.attributes.normal) geom.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
        geom.setIndex(new THREE.Uint32BufferAttribute(Uint32Array.from(m.index.array), 1));
        if (!m.attributes.normal) geom.computeVertexNormals();
        const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(DEFAULT_COLOR);
        const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }));
        mesh.name = m.name ?? "";
        group.add(mesh);
      }
      resolve(group);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "CAD worker failed"));
    };
    worker.postMessage({ format, buffer }, [buffer]);
  });
}

async function loadModel(blob: Blob, format: ModelFormat): Promise<THREE.Object3D> {
  const material = () => new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
  switch (format) {
    case "step":
    case "iges":
      return parseCad(await blob.arrayBuffer(), format);
    case "stl": {
      const geom = new STLLoader().parse(await blob.arrayBuffer());
      geom.computeVertexNormals();
      const hasColors = Boolean(geom.getAttribute("color"));
      const mat = material();
      if (hasColors) mat.vertexColors = true;
      return new THREE.Mesh(geom, mat);
    }
    case "obj": {
      const obj = new OBJLoader().parse(await blob.text());
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material();
      });
      return obj;
    }
    case "gltf": {
      const gltf = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), "");
      return gltf.scene;
    }
  }
}

export default function ModelViewer({ blob, format }: { blob: Blob; format: ModelFormat }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const api = useRef<{ fit: () => void; setWireframe: (w: boolean) => void; setEdges: (e: boolean) => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [size, setSize] = useState<THREE.Vector3 | null>(null);
  const [triangles, setTriangles] = useState(0);
  const [wire, setWire] = useState(false);
  const [edges, setEdges] = useState(false);

  useEffect(() => {
    const mount = mountRef.current!;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6fa);
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.01, 1e7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    camera.add(key);
    key.position.set(1, 1, 2);
    scene.add(camera);

    let model: THREE.Object3D | null = null;
    const edgeLines: THREE.LineSegments[] = [];
    let grid: THREE.GridHelper | null = null;

    const fit = () => {
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(dist));
      camera.near = dist / 1000;
      camera.far = dist * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.update();
    };

    api.current = {
      fit,
      setWireframe: (w) =>
        model?.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if ((o as THREE.Mesh).isMesh && m) m.wireframe = w;
        }),
      setEdges: (show) => {
        if (show && !edgeLines.length && model) {
          model.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color: 0x1e293b }));
            mesh.add(lines);
            edgeLines.push(lines);
          });
        }
        edgeLines.forEach((l) => (l.visible = show));
      },
    };

    loadModel(blob, format)
      .then((obj) => {
        if (disposed) return;
        model = obj;
        scene.add(obj);
        const box = new THREE.Box3().setFromObject(obj);
        const s = box.getSize(new THREE.Vector3());
        setSize(s);
        let tris = 0;
        obj.traverse((o) => {
          const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          if ((o as THREE.Mesh).isMesh && g) tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
        });
        setTriangles(Math.round(tris));
        const maxDim = Math.max(s.x, s.y, s.z) || 1;
        grid = new THREE.GridHelper(maxDim * 2, 20, 0xb8c2d0, 0xdde3ea);
        grid.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
        scene.add(grid);
        fit();
        setStatus("ready");
      })
      .catch((e) => {
        if (disposed) return;
        setError(e.message ?? String(e));
        setStatus("error");
      });

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      ro.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [blob, format]);

  const unit = format === "step" || format === "iges" ? " mm" : "";
  const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toPrecision(4));

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/60 text-sm text-slate-600">
          <Spinner />
          {format === "step" || format === "iges" ? "Tessellating CAD geometry…" : "Loading model…"}
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-sm text-red-700">Couldn't display this model: {error}</div>
      )}
      {status === "ready" && (
        <>
          <div className="absolute top-3 left-3 flex gap-1.5">
            <ToolbarBtn onClick={() => api.current?.fit()}>Fit</ToolbarBtn>
            <ToolbarBtn
              active={wire}
              onClick={() => {
                setWire(!wire);
                api.current?.setWireframe(!wire);
              }}
            >
              Wireframe
            </ToolbarBtn>
            <ToolbarBtn
              active={edges}
              onClick={() => {
                setEdges(!edges);
                api.current?.setEdges(!edges);
              }}
            >
              Edges
            </ToolbarBtn>
          </div>
          {size && (
            <div className="absolute bottom-3 left-3 rounded-md bg-white/90 px-2.5 py-1.5 font-mono text-xs text-slate-600 shadow">
              Bounding box: {fmt(size.x)} × {fmt(size.y)} × {fmt(size.z)}
              {unit} · {triangles.toLocaleString()} tris
              {!unit && <span className="text-slate-400"> (file units)</span>}
            </div>
          )}
          <div className="absolute right-3 bottom-3 text-xs text-slate-400">Drag to rotate · right-drag to pan · scroll to zoom</div>
        </>
      )}
    </div>
  );
}

function ToolbarBtn({ active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium shadow-sm ${
        active ? "border-accent bg-accent text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    />
  );
}
