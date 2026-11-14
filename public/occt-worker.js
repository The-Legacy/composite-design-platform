// Classic web worker that converts STEP/IGES -> triangle meshes using OpenCascade (WASM).
importScripts("/vendor/occt/occt-import-js.js");

let occtPromise = null;
onmessage = async (ev) => {
  try {
    occtPromise ??= occtimportjs({ locateFile: (p) => "/vendor/occt/" + p });
    const occt = await occtPromise;
    const { format, buffer } = ev.data;
    const result = occt.ReadFile(format, new Uint8Array(buffer), {
      linearUnit: "millimeter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.001,
      angularDeflection: 0.5,
    });
    postMessage({ ok: true, result });
  } catch (err) {
    postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
