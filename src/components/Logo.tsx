import { cx } from "./ui";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cx("size-8", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#1d1530" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#e9b65c" strokeWidth="5" strokeLinecap="round" strokeDasharray="80 27" transform="rotate(-50 32 32)" />
      <circle cx="32" cy="32" r="5" fill="#f4eee4" />
    </svg>
  );
}

export function Logo({ className, light, suffix }: { className?: string; light?: boolean; suffix?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cx("font-display text-[1.35rem] font-semibold leading-none", light ? "text-paper" : "text-ink")}>
        Eventos<span className="text-champagne-deep">360</span>
      </span>
      {suffix && (
        <span className={cx("rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider", light ? "bg-white/10 text-paper/80" : "bg-[var(--accent-soft)] text-[var(--accent)]")}>
          {suffix}
        </span>
      )}
    </span>
  );
}
