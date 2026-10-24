import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { DepositsList } from "@/components/finance-portal/deposits-list"
import { TableSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { businessDayOf } from "@/domain/business-time"
import { parsePaging, sliceRows } from "@/lib/pagination"
import { listPendingDeposits } from "@/server/finance-portal-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function FinanceDepositsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Deposits"
        description="Orders whose deposit is not settled yet. Confirm the deposit when it has arrived."
      />
      <Suspense fallback={<TableSkeleton />}>
        <Deposits searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Deposits({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("finance"), searchParams])
  const now = new Date()
  const { rows, ...paging } = sliceRows(listPendingDeposits(getDb(), user, now), parsePaging(params))
  return <DepositsList deposits={rows} paging={paging} today={businessDayOf(now)} />
}
