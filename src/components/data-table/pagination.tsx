"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PAGE_SIZES, pageWindow } from "@/lib/pagination"

/**
 * Pagination bar (eor-prototype Pagination): range summary, previous/next with
 * page numbers, and a rows-per-page selector. Callers hide it when the list
 * fits on one page of the smallest size.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-sm"
    >
      <span className="text-muted-foreground tabular-nums" data-testid="page-range">
        {start}–{end} of {total}
      </span>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="px-2 text-muted-foreground tabular-nums sm:hidden">
          {page} / {totalPages}
        </span>
        <div className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, totalPages).map((entry, i) =>
            entry === "ellipsis" ? (
              <span key={`gap-${i}`} aria-hidden className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={entry}
                variant={entry === page ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? "page" : undefined}
                onClick={() => onPageChange(entry)}
                className="tabular-nums"
              >
                {entry}
              </Button>
            )
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <label className="flex items-center gap-2 text-muted-foreground">
        Rows
        <Select
          value={String(pageSize)}
          onValueChange={(v) => v && onPageSizeChange(Number(v))}
          items={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
        >
          <SelectTrigger size="sm" aria-label="Rows per page" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </nav>
  )
}
