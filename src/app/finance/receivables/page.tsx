import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { NothingOwed } from "@/components/finance-portal/receivables/receivables-figures"
import { ReceivablesDashboard } from "@/components/finance-portal/receivables/receivables-dashboard"
import { ReceivablesSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import {
  bucketRows,
  clearedReceivablesHref,
  clientRows,
  parseReceivablesQuery,
  receivablesChips,
  receivablesFigures,
  searchOf,
  withKnownClient,
} from "@/lib/receivables-view"
import { clientAgeing } from "@/server/finance-insights"
import { financeReceivablesPage } from "@/server/finance-lists"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** `/finance/receivables`, filtered by `?bucket=current|1-30|31-60|60-plus` and `?client=<companyId>` (both, combined). */
export default function FinanceReceivablesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Receivables" />
      <Suspense fallback={<ReceivablesSkeleton />}>
        <Receivables searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

/** The book is read once (`clientAgeing`): the figures and both charts derive from it; the table is its invoices. */
async function Receivables({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("finance"), searchParams])
  const db = getDb()
  const now = new Date()
  const ageing = clientAgeing(db, user, now)
  if (ageing.bookAgeing.outstandingCents === 0) return <NothingOwed inFlightCents={ageing.bookAgeing.inFlight.cents} />

  const query = withKnownClient(parseReceivablesQuery(params), ageing)
  const current = searchOf(params)
  return (
    <ReceivablesDashboard
      figures={receivablesFigures(ageing, query)}
      byAge={bucketRows(ageing, query, current)}
      byClient={clientRows(ageing, query, current)}
      chips={receivablesChips(ageing, query, current)}
      clearHref={clearedReceivablesHref(current)}
      table={financeReceivablesPage(db, user, query, now)}
    />
  )
}
