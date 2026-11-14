# Composite Design Platform

One place for a project team to keep **3D models, technical drawings, 2D sketches and the
equations that size each part**, organized by subsystem.

- **Projects → Subsystems → Parts.** Each part has its own files and its own equation sheet.
- **In-browser viewers:** STEP/IGES (via OpenCascade WASM), STL, OBJ, GLB, PDF drawings, DXF drawings (with layer toggles), and images. Anything else (SolidWorks, DWG, Fusion, Office docs) is stored and can be downloaded.
- **Linked parametric equations** with units, e.g. `t_total = n_plies * t_ply` gives `2 mm`, displayed in `in`.
  - Variables can reference project variables (`E1`), variables on the same part (`t_ply`), or variables on other parts (`spar_cap.t_ply`).
  - Changing a value recomputes everything downstream, live for everyone on the team.
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
- Equation engine (mathjs): [src/equations/engine.ts](src/equations/engine.ts), with tests in `engine.test.ts`.

| Path | What |
| --- | --- |
| `worker/index.ts` | API: upload, download, delete, bulk-delete, Drive import |
| `shared/fileTypes.ts` | Extension → category / viewer mapping (shared by app and worker) |
| `src/components/EquationSheet.tsx` | Spreadsheet-style variable editor with live evaluation |
| `src/components/FilePanel.tsx` | Upload (drag & drop), Drive import, list, revisions |
| `src/components/viewers/` | three.js model viewer, DXF viewer |
| `public/occt-worker.js` | Web worker that tessellates STEP/IGES |

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. Run the migration: paste `supabase/migrations/*_init.sql` into **SQL Editor → Run**, or use `supabase db push` with the CLI.
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
3. Under **Project variables**, define shared inputs such as `E1 = 135 GPa`, `t_ply = 0.19 mm` and `SF = 1.5`.
4. On a part's sheet, write formulas such as `t = n_plies * t_ply` or `sigma = F / (w * t)` with **Show in** set to `MPa`. Hover a row to highlight its inputs (blue) and the variables that use it (amber).
5. Drop files on the part, or click **Import from Drive**. Click a file to view it.

**Tip:** for native CAD (SolidWorks, Fusion, Inventor), also upload a **STEP** export so it can be viewed in 3D, plus a **PDF or DXF** export of the drawing.

## Limits and next steps
- Uploads go through the Worker, so each file is limited to about 95 MB (`MAX_UPLOAD_MB`), which is the Workers request-body limit on Free/Pro plans. For larger files, add R2 presigned multipart uploads.
- DWG and native CAD files can't be rendered in the browser and are download-only.
- Ideas: what-if scenarios and parameter sweeps with plots, file version history (revisions are a label today), comments on files, and a BOM/mass roll-up from part variables.
