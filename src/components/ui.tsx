import {
  useEffect,
  type ButtonHTMLAttributes,
  type ComponentType,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertIcon, XIcon } from "./icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50",
        focusRing,
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" &&
          "bg-accent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(15_23_42/0.15)] hover:bg-accent-hover",
        variant === "secondary" && "border border-slate-200 bg-white text-slate-700 shadow-card hover:border-slate-300 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        variant === "danger" && "border border-red-200 bg-white text-red-600 shadow-card hover:border-red-300 hover:bg-red-50",
        className,
      )}
    />
  );
}

/** Square, icon-only button. Always pass a `title` for accessibility. */
export function IconButton({
  tone = "neutral",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "neutral" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      aria-label={props.title}
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors disabled:pointer-events-none disabled:opacity-30",
        focusRing,
        size === "sm" ? "h-6 w-6" : "h-7 w-7",
        tone === "danger" ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-slate-100 hover:text-slate-700",
        className,
      )}
    />
  );
}

const fieldBase =
  "rounded-lg border border-slate-200 bg-white text-sm shadow-card outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className, compact, ...props }: InputHTMLAttributes<HTMLInputElement> & { compact?: boolean }) {
  return <input {...props} className={cx(fieldBase, compact ? "h-8 px-2.5" : "h-9 px-3", "w-full", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldBase, "w-full px-3 py-2", className)} />;
}

export function Select({ className, compact, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return <select {...props} className={cx(fieldBase, "ui-select", compact ? "h-8 pl-2.5 text-[13px]" : "h-9 pl-3", className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Spinner({ full }: { full?: boolean }) {
  const s = <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-accent" />;
  return full ? <div className="flex h-full items-center justify-center">{s}</div> : s;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded border border-slate-200 bg-slate-50 px-1.5 font-sans text-[10px] font-medium text-slate-500">
      {children}
    </kbd>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal
        className={cx(
          "flex max-h-[92vh] w-full animate-pop-in flex-col overflow-hidden rounded-2xl bg-white shadow-pop",
          wide ? "h-[92vh] max-w-6xl" : "max-w-lg",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</div>
          <IconButton onClick={onClose} title="Close">
            <XIcon />
          </IconButton>
        </div>
        <div className={cx("min-h-0 flex-1", wide ? "" : "overflow-auto p-5")}>{children}</div>
      </div>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-slate-200/80 bg-white shadow-card", className)}>{children}</div>;
}

/** Header strip at the top of a Card. */
export function CardHeader({
  title,
  icon: Icon,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3", className)}>
      {Icon && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <Icon size={15} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] leading-tight font-semibold text-slate-900">{title}</h2>
        {description && <div className="mt-0.5 text-xs text-slate-500">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Title block at the top of a page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="mb-1 text-xs font-medium text-slate-500">{eyebrow}</div>}
        <div className="text-[26px] leading-tight font-semibold tracking-tight text-slate-900">{title}</div>
        {description && <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-600">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Standard page container. */
export function Page({ children, width = "default" }: { children: ReactNode; width?: "narrow" | "default" | "wide" }) {
  return (
    <div
      className={cx(
        "mx-auto space-y-6 px-6 py-8 lg:px-10",
        width === "narrow" ? "max-w-3xl" : width === "wide" ? "max-w-[1400px]" : "max-w-6xl",
      )}
    >
      {children}
    </div>
  );
}

type Tone = "neutral" | "accent" | "green" | "amber" | "red" | "violet" | "teal";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 ring-slate-200/70",
  accent: "bg-accent-soft text-accent ring-accent-muted",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  amber: "bg-amber-50 text-amber-700 ring-amber-200/70",
  red: "bg-red-50 text-red-700 ring-red-200/70",
  violet: "bg-violet-50 text-violet-700 ring-violet-200/70",
  teal: "bg-teal-50 text-teal-700 ring-teal-200/70",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; dot: string }> = {
  concept: { tone: "neutral", dot: "bg-slate-400" },
  design: { tone: "accent", dot: "bg-accent" },
  analysis: { tone: "violet", dot: "bg-violet-500" },
  review: { tone: "amber", dot: "bg-amber-500" },
  released: { tone: "green", dot: "bg-emerald-500" },
  manufactured: { tone: "teal", dot: "bg-teal-600" },
};

export function statusDot(status: string) {
  return STATUS[status]?.dot ?? "bg-slate-300";
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.concept;
  return (
    <Badge tone={s.tone} className="capitalize">
      <span className={cx("h-1.5 w-1.5 rounded-full", s.dot)} />
      {status}
    </Badge>
  );
}

export function Stat({ label, value, hint, icon: Icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ComponentType<{ size?: number }> }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {Icon && <Icon size={14} />}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function EmptyState({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon?: ComponentType<{ size?: number }>;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white/50 px-6 py-10 text-center">
      {Icon && (
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
          <Icon size={20} />
        </span>
      )}
      <div className="text-sm font-medium text-slate-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertIcon size={15} className="mt-0.5 shrink-0" />
      <span>{(error as Error).message ?? String(error)}</span>
    </div>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-amber-700">
      <AlertIcon size={13} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Collapsible toggle used for "help" / "advanced" sections. */
export function Disclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button onClick={onToggle} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
      <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} className={cx("transition-transform", open && "rotate-90")} aria-hidden>
        <path d="m9 18 6-6-6-6" />
      </svg>
      {children}
    </button>
  );
}

export function Avatar({ src, name, size = 28 }: { src?: string | null; name?: string | null; size?: number }) {
  const initials = (name ?? "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return src ? (
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full ring-1 ring-slate-200" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 font-semibold text-slate-600"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

/** Coloured initials tile for projects/subsystems. */
export function Monogram({ name, className }: { name: string; className?: string }) {
  const hues = [262, 200, 160, 25, 330, 290, 140, 45];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hues[h % hues.length];
  return (
    <span
      className={cx("flex shrink-0 items-center justify-center rounded-lg font-semibold text-white", className ?? "h-9 w-9 text-sm")}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.15 ${hue}), oklch(0.5 0.17 ${hue + 15}))` }}
    >
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/** Low-key destructive action row at the bottom of a page. */
export function DangerRow({ label, text, onClick }: { label: string; text: ReactNode; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200/70 bg-red-50/40 px-4 py-3">
      <div className="min-w-0 flex-1 text-sm text-slate-600">{text}</div>
      <Button variant="danger" size="sm" onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function slugify(name: string) {
  let s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(s)) s = "p_" + s;
  return s.slice(0, 40) || "part";
}
