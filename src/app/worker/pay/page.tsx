import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PageHeader } from "@/components/page-header"
import { WORKER_PAY_HREFS } from "@/components/pay/hrefs"
import { PayDashboardView } from "@/components/pay/pay-dashboard-view"
import { PayDashboardSkeleton } from "@/components/pay/pay-skeletons"
import { parseYearParam, resolvePayYear } from "@/lib/payslip-view"
import payData from "@/server/pay-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function PayPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Pay" description="Your pay slips, withholdings and year-to-date totals." />
      <Suspense fallback={<PayDashboardSkeleton />}>
        <Pay searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Pay({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("worker"), searchParams])
  const now = new Date()
  const summary = await payData.getPayDashboard(user.id, { now })
  const year = resolvePayYear(parseYearParam(params.year), summary.availableYears, summary.taxYear)
  const payslips = await payData.listPayslips(user.id, { year }, { now })
  return <PayDashboardView summary={summary} payslips={payslips} selectedYear={year} hrefs={WORKER_PAY_HREFS} />
}
