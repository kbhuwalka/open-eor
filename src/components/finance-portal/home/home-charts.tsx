import Link from "next/link"
import { cn } from "cn"

import { DenseRow } from "@/components/dense-list"
import { AgeingBar } from "@/components/finance-portal/charts/ageing-bar"
import { BilledVsCollectedChart } from "@/components/finance-portal/charts/billed-vs-collected-chart"
import { DEFAULT_CHART_PERIODS } from "@/lib/finance-chart-view"
import { topOverdueClients } from "@/lib/finance-home-view"
import { formatCents } from "@/lib/format"
import { bucketSegmentHrefs, daysLabel, receivablesHref } from "@/lib/receivables-view"
import type { BilledVsCollected, ClientAgeing } from "@/server/finance-insights"

export const HOME_CARD = "min-w-0 rounded-lg border border-border p-5"

const ROW_LINK =
  "flex min-w-0 flex-1 items-center truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50"

/** Chart 1: what was billed and what was collected over the last eight pay periods, with the collection rate. */
export function HomeBilledCard({ billed, className }: { billed: BilledVsCollected; className?: string }) {
  return (
    <div className={cn(HOME_CARD, className)} data-testid="home-billed">
      <BilledVsCollectedChart periods={billed.periods} maxPeriods={DEFAULT_CHART_PERIODS} title="Billed vs collected by pay period" />
    </div>
  )
}

/**
 * Chart 2: the book's ageing bar, whose segments open Receivables filtered to that bucket (and
 * money in flight, Payments), over the three clients owing the most overdue money, each opening
 * Receivables filtered to that client.
 */
export function HomeWhoOwesCard({ ageing, className }: { ageing: ClientAgeing; className?: string }) {
  const { bookAgeing } = ageing
  const top = topOverdueClients(ageing.clients)
  return (
    <div className={cn(HOME_CARD, "flex flex-col gap-4", className)} data-testid="home-who-owes">
      <AgeingBar
        buckets={bookAgeing.buckets}
        inFlight={bookAgeing.inFlight}
        title="Who owes us"
        segmentHrefs={bucketSegmentHrefs()}
      />
      {top.length > 0 ? (
        <ul className="border-t border-border" aria-label="Clients owing the most overdue">
          {top.map((client) => (
            <DenseRow key={client.companyId} cursor={false} data-testid="home-top-client" data-company-id={client.companyId}>
              <Link href={receivablesHref({ client: client.companyId })} className={ROW_LINK} data-testid="home-top-client-open">
                <span className="truncate">{client.companyName}</span>
              </Link>
              <span className="w-28 shrink-0 text-right text-status-danger-foreground tabular-nums" data-testid="home-top-client-overdue">
                <span className="sr-only">Overdue </span>
                {formatCents(client.overdueCents)}
              </span>
              <span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums" data-testid="home-top-client-oldest">
                <span className="sr-only">Oldest overdue </span>
                {client.oldestOverdueDays !== null ? daysLabel(client.oldestOverdueDays) : null}
              </span>
            </DenseRow>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="home-no-overdue">
          No client is overdue.
        </p>
      )}
    </div>
  )
}
