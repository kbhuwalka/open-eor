import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export const SUMMARY_ROW = "flex items-center justify-between gap-4 px-4 py-3"

/** Bordered list of label/value rows; the one container shared by the order details, the quote and the agreement. */
export function SummaryCard({ children, className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border text-sm", className)} {...props}>
      {children}
    </div>
  )
}

export function SummaryRow({
  label,
  children,
  strong,
}: {
  label: ReactNode
  children: ReactNode
  strong?: boolean
}) {
  return (
    <div className={cn(SUMMARY_ROW, "not-first:border-t not-first:border-border", strong && "bg-muted/30 font-medium")}>
      <span>{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  )
}
