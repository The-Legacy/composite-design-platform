/**
 * Google Drive Picker integration.
 *
 * Uses the `drive.file` scope: the app can only read files the user explicitly picks.
 * That scope is "non-sensitive", so the Google Cloud app doesn't need verification.
 */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export const driveConfigured = Boolean(CLIENT_ID && API_KEY && APP_ID);

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

let pickerReady: Promise<void> | null = null;
function loadPicker() {
  pickerReady ??= (async () => {
    await Promise.all([loadScript("https://apis.google.com/js/api.js"), loadScript("https://accounts.google.com/gsi/client")]);
    await new Promise<void>((resolve) => window.gapi.load("picker", () => resolve()));
  })();
  return pickerReady;
}

let cachedToken: { token: string; expires: number } | null = null;

function getAccessToken(hint?: string): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return Promise.resolve(cachedToken.token);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      login_hint: hint,
      callback: (resp: any) => {
        if (resp.error) return reject(new Error(resp.error_description ?? resp.error));
        cachedToken = { token: resp.access_token, expires: Date.now() + Number(resp.expires_in ?? 3600) * 1000 };
        resolve(resp.access_token);
      },
      error_callback: (err: any) => reject(new Error(err?.message ?? "Google authorization cancelled")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

/** Opens the Drive picker; resolves with picked files + the token to fetch them. */
export async function pickDriveFiles(emailHint?: string): Promise<{ files: PickedFile[]; token: string }> {
  if (!driveConfigured) throw new Error("Google Drive isn't configured (VITE_GOOGLE_* env vars)");
  await loadPicker();
  const token = await getAccessToken(emailHint);
  const g = window.google;

  return new Promise((resolve) => {
    const myDrive = new g.picker.DocsView().setIncludeFolders(true).setSelectFolderEnabled(false).setOwnedByMe(true);
    const shared = new g.picker.DocsView().setIncludeFolders(true).setSelectFolderEnabled(false).setEnableDrives(true);
    const recent = new g.picker.DocsView(g.picker.ViewId.RECENTLY_PICKED);
    const picker = new g.picker.PickerBuilder()
      .addView(myDrive)
      .addView(shared)
      .addView(recent)
      .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(g.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setTitle("Import from Google Drive")
      .setCallback((data: any) => {
        if (data.action === g.picker.Action.PICKED) {
          resolve({
            token,
            files: data.docs.map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType })),
          });
        } else if (data.action === g.picker.Action.CANCEL) {
          resolve({ token, files: [] });
        }
      })
      .build();
    picker.setVisible(true);
  });
}
