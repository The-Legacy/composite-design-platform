// Copies browser-only vendor assets that must be served as plain static files.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("public/vendor/occt", { recursive: true });
for (const f of ["occt-import-js.js", "occt-import-js.wasm"]) {
  cpSync(`node_modules/occt-import-js/dist/${f}`, `public/vendor/occt/${f}`);
}
console.log("copied occt-import-js -> public/vendor/occt");
