import { cn } from "cn"

/** Northwind mark: a compass needle, north half solid, on the primary colour. */
export function NorthwindLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none">
        <path d="M12 3 17 12H7L12 3Z" fill="currentColor" />
        <path d="M7 12h10l-5 9-5-9Z" fill="currentColor" opacity={0.4} />
        <circle cx="12" cy="12" r="1.5" fill="var(--primary)" />
      </svg>
    </span>
  )
}
