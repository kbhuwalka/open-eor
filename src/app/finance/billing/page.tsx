import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { BillingByClient } from "@/components/finance-portal/billing/billing-by-client"
import { BillingRunCard } from "@/components/finance-portal/billing/billing-run-card"
import { RecentIssueDates } from "@/components/finance-portal/billing/recent-issue-dates"
import { UpcomingBillingChart } from "@/components/finance-portal/charts/upcoming-billing-chart"
import { BillingRunSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { previewByClient } from "@/lib/billing-run-view"
import { previewBillingRun } from "@/server/billing-preview"
import { billingCadence } from "@/server/finance-insights"

const RECENT_DAYS = 5

export default function FinanceBillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Billing run" description="Issue the invoices due this pay period and confirm what was issued. Safe to run again: nothing is issued twice." />
      <Suspense fallback={<BillingRunSkeleton />}>
        <Billing />
      </Suspense>
    </div>
  )
}

async function Billing() {
  const user = await requirePortalUser("finance")
  const db = getDb()
  const now = new Date()
  const preview = previewBillingRun(db, user, now)
  const cadence = billingCadence(db, user, now, preview.upcoming)
  return (
    <div className="grid gap-8 lg:grid-cols-5 lg:items-start">
      <div className="flex min-w-0 flex-col gap-8 lg:col-span-3">
        <BillingRunCard preview={preview} />
        <BillingByClient groups={previewByClient(preview.wouldIssue)} />
      </div>
      <div className="flex min-w-0 flex-col gap-8 lg:col-span-2">
        <div className="rounded-lg border border-border p-5" data-testid="billing-cadence">
          <UpcomingBillingChart periods={cadence.periods} title="Next pay periods" />
        </div>
        <RecentIssueDates days={preview.recent.slice(0, RECENT_DAYS)} />
      </div>
    </div>
  )
}
