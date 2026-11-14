import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Button, ErrorText } from "../components/ui";

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const params = new URLSearchParams(window.location.search);
  const urlError = params.get("error_description");

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <img src="/favicon.svg" alt="" className="mb-5 h-10 w-10" />
        <h1 className="text-xl font-semibold">Composite Design Platform</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Drawings, 3D models and parametric equations for every subsystem, all in one place.
        </p>
        <Button
          variant="primary"
          className="w-full"
          onClick={() => signInWithGoogle().catch(setError)}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path fill="#fff" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.69 3.7 14.56 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12S6.9 21.25 12 21.25c5.34 0 8.88-3.75 8.88-9.04 0-.6-.07-1.07-.15-1.53Z" />
          </svg>
          Sign in with Google
        </Button>
        <div className="mt-4 space-y-2">
          <ErrorText error={error} />
          {urlError && <ErrorText error={new Error(urlError)} />}
        </div>
      </div>
    </div>
  );
}
