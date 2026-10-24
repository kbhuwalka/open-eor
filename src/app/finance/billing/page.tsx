import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { RecentIssueDays, UpcomingPeriods } from "@/components/finance-portal/billing-schedule"
import { BillingRunPanel } from "@/components/finance-portal/billing-run-panel"
import { TableSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { Separator } from "@/components/ui/separator"
import { getDb } from "@/db"
import { previewBillingRun } from "@/server/billing-preview"

export default function FinanceBillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing run"
        description="Issues the payroll and deposit invoices that are due, with a pay slip behind each payroll invoice. Safe to run again: nothing is issued twice."
      />
      <Suspense fallback={<TableSkeleton />}>
        <Billing />
      </Suspense>
    </div>
  )
}

async function Billing() {
  const user = await requirePortalUser("finance")
  const preview = previewBillingRun(getDb(), user, new Date())
  return (
    <div className="flex flex-col gap-8">
      <BillingRunPanel preview={preview} />
      <Separator />
      <UpcomingPeriods periods={preview.upcoming} />
      <Separator />
      <RecentIssueDays days={preview.recent} />
    </div>
  )
}
