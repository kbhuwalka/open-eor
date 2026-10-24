import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PaymentsScreen } from "@/components/finance-portal/payments-screen"
import { TableSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { parseOpenParam } from "@/lib/finance-drawer"
import { parsePaymentsQuery, type PaymentTab } from "@/lib/finance-portal-query"
import type { PaymentViewStatus } from "@/lib/finance-view"
import { financePaymentRecord, financePaymentsPage } from "@/server/finance-lists"
import { listCompanyOptions } from "@/server/finance-portal-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const TAB_OF: Record<PaymentViewStatus, PaymentTab> = { initiated: "to_settle", settled: "settled", failed: "failed" }

/** `/finance/payments`, and `?open=<paymentId>` (`financePaymentHref`) with that payment open in the drawer. */
export default function FinancePaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" description="Payments clients have started. Settle them once the money arrives, or mark them failed." />
      <Suspense fallback={<TableSkeleton filters />}>
        <Payments searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Payments({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("finance"), searchParams])
  const db = getDb()
  const now = new Date()
  const openId = parseOpenParam(params.open)
  const linked = openId ? financePaymentRecord(db, user, openId, now) : null
  const parsed = parsePaymentsQuery(params)
  // A link to a payment shows the tab that lists it, unless the link names a tab itself.
  const query = linked && params.tab === undefined ? { ...parsed, tab: TAB_OF[linked.payment.status] } : parsed
  return (
    <PaymentsScreen
      data={financePaymentsPage(db, user, query, now)}
      query={query}
      companies={listCompanyOptions(db, user)}
      linked={linked}
    />
  )
}
