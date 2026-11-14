import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ErrorText } from "../components/ui";
import { BoxIcon, LayersIcon, LogoMark, SigmaIcon } from "../components/icons";

const FEATURES = [
  { icon: LayersIcon, title: "Laminate analysis", text: "Build layups and get thickness, mass and ABD stiffness instantly." },
  { icon: SigmaIcon, title: "Live equations", text: "Unit-aware formulas that update across every part, for the whole team." },
  { icon: BoxIcon, title: "Models & drawings", text: "View STEP, STL and DXF files in the browser, with revision history." },
];

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const params = new URLSearchParams(window.location.search);
  const urlError = params.get("error_description");

  return (
    <div className="grid h-full lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.05) 0 2px, transparent 2px 10px), repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.04) 0 2px, transparent 2px 10px)",
          }}
        />
        <div className="pointer-events-none absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full bg-[oklch(0.53_0.19_262)] opacity-30 blur-[120px]" />
        <div className="relative flex items-center gap-3 text-lg font-semibold tracking-tight">
          <LogoMark className="h-9 w-9" /> Composite Design
        </div>
        <div className="relative mt-auto max-w-lg">
          <h2 className="text-4xl leading-[1.1] font-semibold tracking-tight">
            Every ply, part and equation, <span className="text-[oklch(0.75_0.13_262)]">in one place.</span>
          </h2>
          <ul className="mt-10 space-y-6">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon size={18} />
                </span>
                <div>
                  <div className="font-medium">{title}</div>
                  <div className="text-sm text-slate-400">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-sm">
          <LogoMark className="mb-6 h-11 w-11 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 mb-8 text-sm text-slate-500">Sign in with your team Google account to open your projects.</p>
          <button
            onClick={() => signInWithGoogle().catch(setError)}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 shadow-card transition hover:border-slate-300 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
              <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84Z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
            </svg>
            Continue with Google
          </button>
          <div className="mt-4 space-y-2">
            <ErrorText error={error} />
            {urlError && <ErrorText error={new Error(urlError)} />}
          </div>
          <p className="mt-10 text-xs text-slate-400">Access is limited to members a project owner has invited.</p>
        </div>
      </div>
    </div>
  );
}
