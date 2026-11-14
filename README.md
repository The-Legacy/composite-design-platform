# Composite Design Platform

One place for a project team to keep **3D models, technical drawings, 2D sketches and the
equations that size each part**, organized by subsystem.

- **Projects → Subsystems → Parts.** Each part has its own files and its own equation sheet.
- **In-browser viewers:** STEP/IGES (via OpenCascade WASM), STL, OBJ, GLB, PDF drawings, DXF drawings (with layer toggles), and images. Anything else (SolidWorks, DWG, Fusion, Office docs) is stored and can be downloaded.
- **Linked parametric equations** with units, e.g. `t_total = n_plies * t_ply` gives `2 mm`, displayed in `in`.
  - Variables can reference project variables (`E1`), variables on the same part (`t_ply`), or variables on other parts (`spar_cap.t_ply`).
  - Changing a value recomputes everything downstream, live for everyone on the team.
- **Materials & layups.** A project materials library (UD, fabric, core, isotropic) and a ply table per part. Type a sequence like `[0/±45/90]s` or add plies one by one. Classical lamination theory gives thickness, areal mass and cost, effective moduli and the ABD matrices, and warns about unsymmetric or unbalanced layups.
  - Equations can use material properties (`CF_UD.E1`, `CF_UD.t_ply`) and layup results (`layup_t`, `layup_areal_mass`, `layup_Ex`, or `spar_cap.layup_t` from another part).
- **Mass & BOM.** Part variables named `mass`, `cost` and `qty` roll up by subsystem, with a CSV export.
- **File revisions.** Uploading a file with the same name, or clicking **New rev**, keeps the old versions under the current one.
- **Variable history.** Every change to a value or formula is recorded with who and when, and old values can be restored. The Project variables page shows a feed of recent changes.
- **Search** (Ctrl/⌘+K) across parts, subsystems, files, variables and materials.
- **Google sign-in** (Supabase Auth), **Google Drive import** (Picker), **team roles** (owner / editor / viewer).

## Architecture

```
Browser (React + Vite SPA)
  │  auth, DB reads/writes ──────────────► Supabase (Postgres + RLS, Auth w/ Google, Realtime)
  │  /api/* (file bytes, Drive import) ──► Cloudflare Worker ──► R2 bucket (file storage)
  │                                              └─► Google Drive API (copy picked files)
  └─ Drive Picker (drive.file scope) ────► Google
```

- One Cloudflare Worker serves both the static app and `/api/*` ([wrangler.jsonc](wrangler.jsonc)).
- The Worker forwards the user's Supabase JWT, so **Postgres RLS is the single source of authorization**. A file's R2 bytes are only read or written after its `files` row has passed RLS.
- Schema and policies: [supabase/migrations/](supabase/migrations/).
- Equation engine (mathjs): [src/equations/engine.ts](src/equations/engine.ts). Lamination theory: [src/equations/laminate.ts](src/equations/laminate.ts). Tests sit next to each.

| Path | What |
| --- | --- |
| `worker/index.ts` | API: upload, download, delete, bulk-delete, Drive import |
| `shared/fileTypes.ts` | Extension → category / viewer mapping (shared by app and worker) |
| `src/components/EquationSheet.tsx` | Spreadsheet-style variable editor with live evaluation |
| `src/components/FilePanel.tsx` | Upload (drag & drop), Drive import, list, revisions |
| `src/components/viewers/` | three.js model viewer, DXF viewer |
| `src/components/LayupPanel.tsx` | Ply table, stacking-sequence input, stack diagram, CLT results |
| `src/pages/MaterialsPage.tsx`, `RollupPage.tsx` | Materials library; mass roll-up and BOM export |
| `src/components/VariableHistory.tsx` | Per-variable history and project change feed |
| `src/components/SearchPalette.tsx` | Ctrl/⌘+K search |
| `public/occt-worker.js` | Web worker that tessellates STEP/IGES |

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. Run the migrations in order: paste each file in `supabase/migrations/` (oldest first) into **SQL Editor → Run**, or use `supabase db push` with the CLI.
3. **Authentication → Providers → Google**: enable it, then paste the Google OAuth client ID and secret from step 2 below.
4. **Authentication → URL Configuration**: set Site URL to your production URL, and add `http://localhost:5173` and your production URL to the Redirect URLs.
5. (Optional) To restrict who can sign up, add rows to `signup_allowlist` in the Table Editor, such as `@umich.edu` or `someone@gmail.com`. If the table is empty, anyone can sign in, but they see nothing until a project owner adds them.

### 2. Google Cloud
1. Create a project at console.cloud.google.com.
2. **APIs & Services → Library**: enable the **Google Drive API** and the **Google Picker API**.
3. **OAuth consent screen**: choose External (or Internal for a Workspace org), and add scopes `email`, `profile`, `openid` and `.../auth/drive.file`. `drive.file` is non-sensitive, so the app doesn't need Google verification.
4. **Credentials → Create OAuth client ID → Web application**:
   - Authorized JavaScript origins: `http://localhost:5173` and your production URL.
   - Authorized redirect URI: `https://<your-supabase-ref>.supabase.co/auth/v1/callback`.
   - Copy the client ID and secret into Supabase (step 1.3). Put the client ID in `VITE_GOOGLE_CLIENT_ID`.
5. **Credentials → Create API key**. Restrict it to the Picker API and to your HTTP referrers, then put it in `VITE_GOOGLE_API_KEY`.
6. Put the **project number** (from the dashboard, not the project ID) in `VITE_GOOGLE_APP_ID`.

### 3. Cloudflare
```bash
npx wrangler login
npx wrangler r2 bucket create composite-design-files
```
Edit `vars` in [wrangler.jsonc](wrangler.jsonc) and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`. These are public values, the same ones the frontend uses.

### 4. Run locally
```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:5173 — the Worker + a local R2 simulator run inside Vite
npm test                     # equation engine tests
```

### 5. Deploy
```bash
npm run deploy               # builds the SPA + Worker and runs wrangler deploy
```
Then add the deployed URL (or a custom domain) to the Supabase redirect URLs and the Google OAuth JavaScript origins.

## Using it

1. Create a project, then add your teammates under **Team & settings**. If someone hasn't signed in yet, they get an invite that is accepted automatically on their first sign-in.
2. Add subsystems (Airframe, Recovery, …) and parts. Each part gets an **equation ID** such as `spar_cap`.
3. Under **Materials**, add your prepregs, fabrics and cores (start from a preset and replace the values with your datasheet's). Under **Project variables**, define shared inputs such as loads and `SF = 1.5`.
4. On a part, build the **Layup**, either ply by ply or by typing `[0/±45/90]s`. The results update as you edit.
5. On a part's sheet, write formulas such as `sigma = F / (w * layup_t)` with **Show in** set to `MPa`, and `mass = layup_areal_mass * area` so the part shows up in **Mass & BOM**. Hover a row to highlight its inputs (blue) and the variables that use it (amber).
6. Drop files on the part, or click **Import from Drive**. Click a file to view it. Dropping a file with the same name again adds a new revision.

**Tip:** for native CAD (SolidWorks, Fusion, Inventor), also upload a **STEP** export so it can be viewed in 3D, plus a **PDF or DXF** export of the drawing.

## Limits and next steps
- Uploads go through the Worker, so each file is limited to about 95 MB (`MAX_UPLOAD_MB`), which is the Workers request-body limit on Free/Pro plans. For larger files, add R2 presigned multipart uploads.
- DWG and native CAD files can't be rendered in the browser and are download-only.
- The lamination analysis covers stiffness, mass and cost. It doesn't do failure analysis (first-ply failure, Tsai-Wu); material strengths are stored for use in your own equations.
- Ideas: what-if scenarios and parameter sweeps with plots, comments on files, first-ply failure under load.
