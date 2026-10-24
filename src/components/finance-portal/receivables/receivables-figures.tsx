import Link from "next/link"
import { cn } from "cn"

import { formatWholeDollars } from "@/lib/finance-portal-view"
import { formatCents } from "@/lib/format"
import { IN_FLIGHT_HREF, type ReceivablesFigures as Figures } from "@/lib/receivables-view"

/** Whole dollars on screen; the exact amount in the `title` and for screen readers. */
function Amount({ cents, className, testId }: { cents: number; className?: string; testId: string }) {
  return (
    <span className={cn("font-semibold tabular-nums", className)} title={formatCents(cents)} data-testid={testId} data-cents={cents}>
      <span aria-hidden>{formatWholeDollars(cents)}</span>
      <span className="sr-only">{formatCents(cents)}</span>
    </span>
  )
}

const Dot = () => (
  <span aria-hidden className="text-muted-foreground">
    ·
  </span>
)

/**
 * The one quiet line over the charts: what the filtered book owes, its overdue part (danger) and,
 * with no filter on, the book's money in flight (muted, a link to Payments). In flight is never
 * filtered: it is a payment waiting to settle, not an invoice of the table.
 */
export function ReceivablesFigures({ figures }: { figures: Figures }) {
  const overdue = figures.overdueCents > 0
  return (
    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm" data-testid="receivables-figures">
      <span>
        <Amount cents={figures.outstandingCents} className="text-foreground" testId="receivables-outstanding" />{" "}
        <span className="text-muted-foreground">outstanding</span>
      </span>
      <Dot />
      <span className={overdue ? "text-status-danger-foreground" : "text-muted-foreground"} data-testid="receivables-overdue-line">
        <Amount cents={figures.overdueCents} className={overdue ? undefined : "font-normal"} testId="receivables-overdue" /> overdue
      </span>
      {figures.inFlightCents !== null && figures.inFlightCents > 0 ? (
        <>
          <Dot />
          <Link
            href={IN_FLIGHT_HREF}
            className="rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid="receivables-inflight-link"
          >
            <Amount cents={figures.inFlightCents} className="font-normal" testId="receivables-inflight" /> in flight
          </Link>
        </>
      ) : null}
    </p>
  )
}

/** The whole book owes nothing: one quiet line, with money in flight beside it when there is some. */
export function NothingOwed({ inFlightCents }: { inFlightCents: number }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2.5 text-sm text-muted-foreground" data-testid="nothing-owed">
      <span>Nothing is owed.</span>
      {inFlightCents > 0 ? (
        <Link
          href={IN_FLIGHT_HREF}
          className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="receivables-inflight-link"
        >
          <Amount cents={inFlightCents} className="font-normal" testId="receivables-inflight" /> in flight
        </Link>
      ) : null}
    </p>
  )
}
