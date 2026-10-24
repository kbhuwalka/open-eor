import { Suspense } from "react"
import Link from "next/link"
import { cn } from "cn"

import { requirePortalUser } from "@/auth"
import { SummaryCard } from "@/components/summary-card"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"
import { financeOverview, type FinanceOverview } from "@/server/finance-portal-queries"

const TILE =
  "flex flex-col gap-1 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset not-first:border-t not-first:border-border sm:not-first:border-t-0 sm:not-first:border-l"

function Tile({
  href,
  label,
  value,
  testId,
  tone,
}: {
  href: string
  label: string
  value: string
  testId: string
  tone?: "danger"
}) {
  return (
    <Link href={href} className={TILE} data-testid={testId}>
      <span
        className={cn("text-xl font-semibold tabular-nums", tone === "danger" && "text-status-danger-foreground")}
        data-testid={`${testId}-value`}
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </Link>
  )
}

/** The four figures of the Finance home, as plain data in, markup out (also used by tests). */
export function FinanceOverviewTilesView({ overview }: { overview: FinanceOverview }) {
  const { paymentsToReconcile: pay, depositsAwaiting: dep, overdueReceivables: late, billing } = overview
  const readyToBill = billing.toIssueCount > 0
  return (
    <SummaryCard className="grid sm:grid-cols-4" data-testid="finance-overview">
      <Tile href="/finance/payments" testId="tile-reconcile" label="Payments to reconcile" value={formatCents(pay.cents)} />
      <Tile href="/finance/deposits" testId="tile-deposits" label="Deposits awaiting" value={formatCents(dep.cents)} />
      <Tile
        href="/finance/receivables"
        testId="tile-overdue"
        label="Overdue receivables"
        value={formatCents(late.cents)}
        tone={late.cents > 0 ? "danger" : undefined}
      />
      <Tile
        href="/finance/billing"
        testId="tile-billing"
        label={readyToBill ? "Ready to bill" : "Next billing"}
        value={readyToBill ? formatCents(billing.toIssueCents) : billing.nextIssueDate ? formatIsoDay(billing.nextIssueDate) : "—"}
      />
    </SummaryCard>
  )
}

export function FinanceOverviewSkeleton() {
  return (
    <SummaryCard className="grid sm:grid-cols-4" aria-busy data-testid="finance-overview-skeleton">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cn(TILE, "hover:bg-transparent")}>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </SummaryCard>
  )
}

async function Overview() {
  const user = await requirePortalUser("finance")
  return <FinanceOverviewTilesView overview={financeOverview(getDb(), user, new Date())} />
}

/**
 * Server component for the Finance home: payments to reconcile, deposits awaiting, overdue
 * receivables and the next billing date. It reads the session and the database itself and brings
 * its own Suspense boundary and skeleton, so the home only renders `<FinanceOverviewTiles />`.
 */
export function FinanceOverviewTiles() {
  return (
    <Suspense fallback={<FinanceOverviewSkeleton />}>
      <Overview />
    </Suspense>
  )
}
