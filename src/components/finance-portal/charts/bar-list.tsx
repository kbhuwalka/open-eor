"use client"

import { useId, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import Link from "next/link"
import { cn } from "cn"
import { Check } from "lucide-react"

import { CHART_FILL, ChartDataTable, ChartEmptyState, ChartFrame } from "@/components/ui/chart"
import type { BarListRow } from "@/lib/finance-chart-view"
import { formatCents } from "@/lib/format"
import { formatWholeDollars, plural } from "@/lib/finance-portal-view"

const ROW =
  "flex w-full min-w-0 flex-col gap-1.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm outline-none transition-colors duration-150"
const INTERACTIVE = "cursor-pointer hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
const SELECTED = "border-foreground/50 bg-muted/60"

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

function percent(value: number): string {
  return `${(value * 100).toFixed(3)}%`
}

/** The row's bar on a muted track: its parts side by side, the whole as long as the row's `scale`. */
function Bar({ row }: { row: BarListRow }) {
  const clipId = `bar-${useId().replace(/:/g, "")}`
  const widths = row.segments.map((segment) => (row.cents > 0 ? (segment.cents / row.cents) * row.scale : 0))
  const offsets = widths.map((_, index) => widths.slice(0, index).reduce((total, width) => total + width, 0))
  return (
    <svg aria-hidden className="block h-2 w-full" data-testid="bar-list-bar">
      <defs>
        <clipPath id={clipId}>
          <rect width={percent(row.scale)} height="100%" rx="3" />
        </clipPath>
      </defs>
      <rect width="100%" height="100%" rx="3" className="fill-muted" />
      <g clipPath={`url(#${clipId})`}>
        {row.segments.map((segment, index) =>
          widths[index] > 0 ? (
            <rect
              key={index}
              x={percent(offsets[index])}
              width={percent(widths[index])}
              height="100%"
              fill={CHART_FILL[segment.tone]}
              data-tone={segment.tone}
            />
          ) : null,
        )}
      </g>
    </svg>
  )
}

function RowContent({ row }: { row: BarListRow }) {
  const empty = row.cents === 0
  return (
    <>
      <span className="flex min-w-0 items-baseline gap-3">
        <span
          className={cn("flex min-w-0 flex-1 items-center gap-1.5 truncate", row.selected && "font-medium")}
          data-testid="bar-list-label"
        >
          {row.selected ? <Check aria-hidden className="size-3.5 shrink-0" data-testid="bar-list-check" /> : null}
          <span className="truncate">{row.label}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{plural(row.count, "invoice")}</span>
        <span
          className={cn("w-20 shrink-0 text-right font-medium tabular-nums", empty && "font-normal text-muted-foreground")}
          title={formatCents(row.cents)}
          data-testid="bar-list-amount"
        >
          {formatWholeDollars(row.cents)}
        </span>
      </span>
      <Bar row={row} />
    </>
  )
}

/** A row that filters: a link (so cmd-click opens the filtered view in a new tab) acting as a toggle button. */
function FilterRow({ row, onNavigate }: { row: BarListRow & { href: string }; onNavigate?: (href: string) => void }) {
  return (
    <Link
      href={row.href}
      scroll={false}
      role="button"
      aria-pressed={row.selected}
      aria-label={row.name}
      onClick={(event) => {
        if (!onNavigate || !plainClick(event)) return
        event.preventDefault()
        onNavigate(row.href)
      }}
      onKeyDown={(event: KeyboardEvent<HTMLAnchorElement>) => {
        if (event.key !== " ") return
        event.preventDefault()
        event.currentTarget.click()
      }}
      className={cn(ROW, INTERACTIVE, row.selected && SELECTED)}
      data-testid="bar-list-row"
      data-key={row.key}
      data-cents={row.cents}
      data-selected={row.selected || undefined}
    >
      <RowContent row={row} />
    </Link>
  )
}

export type BarListProps = {
  /** The card's small title ("By age"); it also captions the hidden data table. */
  title: string
  rows: readonly BarListRow[]
  /** The first column of the hidden table ("Bucket", "Client"). */
  rowHeader: string
  emptyMessage: string
  /** Plain clicks on a row go here instead of a full navigation (a soft `router.push`). */
  onNavigate?: (href: string) => void
  testId?: string
  className?: string
  /** Under the rows, before the hidden table (a legend). */
  footer?: ReactNode
  /**
   * `card`: a bordered card with a small muted title. `section`: no box, the title as a
   * `text-base font-semibold` section heading with `takeaway` muted beside it and a hairline under
   * it (the Finance Home's chart head).
   */
  variant?: "card" | "section"
  takeaway?: ReactNode
}

/**
 * A clickable bar list (ui-guidelines CH10): one row per item, each with its label, the invoice
 * count, the amount written on the row and a bar scaled to the longest row, in status tones only.
 * A row that filters is a link with `role="button"` and `aria-pressed` (Enter and Space); the
 * selected one is outlined with a check and a bolder label, and the others keep full contrast. A
 * row with nothing in it filters nothing and is not a link.
 */
export function BarList({ title, rows, rowHeader, emptyMessage, onNavigate, testId, className, footer, variant = "card", takeaway }: BarListProps) {
  const titleId = useId()
  const drawn = rows.some((row) => row.cents > 0)
  const body = (
    <>
      {drawn ? (
        <ul className={cn("flex flex-col gap-0.5", variant === "section" && "-mx-2.5")}>
          {rows.map((row) => (
            <li key={row.key}>
              {row.href !== null ? (
                <FilterRow row={{ ...row, href: row.href }} onNavigate={onNavigate} />
              ) : (
                <button
                  type="button"
                  disabled
                  aria-pressed={false}
                  aria-label={row.name}
                  className={cn(ROW, "cursor-default")}
                  data-testid="bar-list-row"
                  data-key={row.key}
                  data-cents={row.cents}
                >
                  <RowContent row={row} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ChartEmptyState message={emptyMessage} className="h-32" />
      )}
      {footer}
      <ChartDataTable
        caption={title}
        columns={[rowHeader, "Amount", "Invoices"]}
        rows={rows.map((row) => ({ key: row.key, cells: [row.label, formatCents(row.cents), String(row.count)] }))}
      />
    </>
  )
  if (variant === "section") {
    return (
      <div className={cn("min-w-0", className)} data-testid={testId}>
        <ChartFrame title={title} takeaway={takeaway} variant="section">
          {body}
        </ChartFrame>
      </div>
    )
  }
  return (
    <section aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4", className)} data-testid={testId}>
      <h3 id={titleId} className="px-2.5 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {body}
    </section>
  )
}
