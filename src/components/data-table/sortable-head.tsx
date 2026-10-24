"use client"

import { cn } from "cn"
import { ChevronDown, ChevronUp } from "lucide-react"

import { TableHead } from "@/components/ui/table"

export type SortDirection = "asc" | "desc"

/**
 * Header cell for a sortable column (eor-prototype SortableHeader): the whole
 * label is a button, `aria-sort` reflects state, and the chevron only shows on
 * the active column.
 */
export function SortableHead({
  label,
  active,
  direction,
  onSort,
  className,
}: {
  label: string
  active: boolean
  direction: SortDirection
  onSort: () => void
  className?: string
}) {
  const Icon = direction === "asc" ? ChevronUp : ChevronDown
  return (
    <TableHead
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}
    >
      <button
        type="button"
        onClick={onSort}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {label}
        <Icon className={cn("size-3.5", active ? "opacity-100" : "opacity-0")} aria-hidden />
      </button>
    </TableHead>
  )
}
