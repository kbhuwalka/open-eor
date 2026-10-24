import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { PaymentsQueue } from "@/components/finance-portal/payments-queue"
import { TableSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { PAYMENT_TAB_STATUS, parsePaymentsQuery } from "@/lib/finance-portal-query"
import { listFinancePayments } from "@/server/billing-queries"
import { coveredInvoicesByPayment } from "@/server/finance-portal-covered"
import { paymentStatusCounts } from "@/server/finance-portal-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function FinancePaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Payments clients have started. Settle them once the money arrives, or mark them failed."
      />
      <Suspense fallback={<TableSkeleton />}>
        <Payments searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Payments({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("finance"), searchParams])
  const query = parsePaymentsQuery(params)
  const db = getDb()
  const data = listFinancePayments(db, user, { status: PAYMENT_TAB_STATUS[query.tab], page: query.page, pageSize: query.size })
  const raw = paymentStatusCounts(db, user)
  const covered = coveredInvoicesByPayment(db, user, data.rows.map((row) => row.id))
  return (
    <PaymentsQueue
      query={query}
      data={data}
      covered={covered}
      counts={{ initiated: raw.initiated, settled: raw.succeeded, failed: raw.failed }}
    />
  )
}
