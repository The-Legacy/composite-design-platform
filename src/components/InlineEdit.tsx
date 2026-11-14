import { useEffect, useState } from "react";
import { cx } from "./ui";

/** Text that becomes an input on click and saves on blur/Enter. */
export default function InlineEdit({
  value,
  onSave,
  disabled,
  className,
  placeholder,
  multiline,
}: {
  value: string;
  onSave: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) onSave(v);
  };
  const cls = cx(
    "-mx-1.5 w-[calc(100%+0.75rem)] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 outline-none transition placeholder:text-slate-400 hover:bg-slate-100/70 focus:border-accent focus:bg-white focus:ring-3 focus:ring-accent/15 disabled:hover:bg-transparent",
    className,
  );
  return multiline ? (
    <textarea
      rows={2}
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      className={cx(cls, "resize-y")}
    />
  ) : (
    <input
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
      className={cls}
    />
  );
}
