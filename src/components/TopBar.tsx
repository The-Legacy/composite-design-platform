import { Link } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";

export default function TopBar({ children }: { children?: ReactNode }) {
  const { user, signOut } = useAuth();
  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <Link to="/" className="flex items-center gap-2 font-semibold">
        <img src="/favicon.svg" className="h-6 w-6" alt="" />
        <span className="hidden sm:inline">Composite Design</span>
      </Link>
      <div className="min-w-0 flex-1 truncate text-sm text-slate-500">{children}</div>
      <div className="flex items-center gap-2 text-sm">
        {avatar ? (
          <img src={avatar} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
        ) : null}
        <span className="hidden text-slate-600 md:inline">{user?.email}</span>
        <button onClick={signOut} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100">
          Sign out
        </button>
      </div>
    </header>
  );
}
