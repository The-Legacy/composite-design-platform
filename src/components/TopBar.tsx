import { Link } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Avatar, IconButton } from "./ui";
import { LogoMark, LogOutIcon } from "./icons";

export default function TopBar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  const { user, signOut } = useAuth();
  const avatar = user?.user_metadata?.avatar_url as string | undefined;
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email;
  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur">
      <Link to="/" className="flex items-center gap-2.5 rounded-lg pr-1 font-semibold tracking-tight text-slate-900">
        <LogoMark />
        <span className="hidden text-[15px] sm:inline">Composite Design</span>
      </Link>
      {children && <span className="h-5 w-px bg-slate-200" />}
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">{children}</div>
      {actions}
      <div className="flex items-center gap-1.5 pl-2">
        <div className="hidden items-center gap-2 rounded-full py-1 pr-2.5 pl-1 md:flex" title={user?.email}>
          <Avatar src={avatar} name={name} size={26} />
          <span className="max-w-[160px] truncate text-[13px] font-medium text-slate-700">{name}</span>
        </div>
        <span className="md:hidden">
          <Avatar src={avatar} name={name} size={26} />
        </span>
        <IconButton onClick={signOut} title="Sign out">
          <LogOutIcon />
        </IconButton>
      </div>
    </header>
  );
}
