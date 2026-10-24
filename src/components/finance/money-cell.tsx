import { cn } from "cn"

import { formatCents } from "@/lib/format"

/** Integer cents as dollars, right-aligned and tabular so amounts line up down a column (F4). */
export function MoneyCell({
  cents,
  className,
  muted,
}: {
  cents: number
  className?: string
  muted?: boolean
}) {
  return (
    <span
      data-slot="money"
      className={cn("block text-right tabular-nums", muted && "text-muted-foreground", className)}
    >
      {formatCents(cents)}
    </span>
  )
}
