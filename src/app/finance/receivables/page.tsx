import { cache, Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { ClientFilter } from "@/components/finance-portal/client-filter"
import { NothingOwed } from "@/components/finance-portal/receivables/receivables-figures"
import { ReceivablesDashboard } from "@/components/finance-portal/receivables/receivables-dashboard"
import { ReceivablesSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import {
  bucketRows,
  clearedReceivablesHref,
  owingClients,
  parseReceivablesQuery,
  RECEIVABLES_PATH,
  receivablesChips,
  receivablesFigures,
  searchOf,
  withKnownClient,
} from "@/lib/receivables-view"
import { clientAgeing } from "@/server/finance-insights"
import { financeReceivablesPage } from "@/server/finance-lists"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** One session, clock, database and read of the book per request, shared by the filter and the page. */
const receivablesBook = cache(async () => {
  const user = await requirePortalUser("finance")
  const db = getDb()
  const now = new Date()
  return { user, db, now, ageing: clientAgeing(db, user, now) }
})

/**
 * `/finance/receivables`, filtered by `?client=<companyId>` (the header's Client filter) and
 * `?bucket=current|1-30|31-60|60-plus` (a By age row), combined.
 */
export default function FinanceReceivablesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Receivables"
        actions={
          <Suspense fallback={null}>
            <ReceivablesFilter searchParams={searchParams} />
          </Suspense>
        }
      />
      <Suspense fallback={<ReceivablesSkeleton />}>
        <Receivables searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

/** The clients that owe money, and the one `?client=` names; nothing while the whole book owes nothing. */
async function ReceivablesFilter({ searchParams }: { searchParams: SearchParams }) {
  const [{ ageing }, params] = await Promise.all([receivablesBook(), searchParams])
  if (ageing.bookAgeing.outstandingCents === 0) return null
  const { client } = withKnownClient(parseReceivablesQuery(params), ageing)
  return <ClientFilter companies={owingClients(ageing)} value={client} path={RECEIVABLES_PATH} current={searchOf(params)} testId="receivables-client-filter" />
}

/** The book is read once (`clientAgeing`): the figures and By age derive from it; the table is its invoices. */
async function Receivables({ searchParams }: { searchParams: SearchParams }) {
  const [{ user, db, now, ageing }, params] = await Promise.all([receivablesBook(), searchParams])
  if (ageing.bookAgeing.outstandingCents === 0) return <NothingOwed inFlightCents={ageing.bookAgeing.inFlight.cents} />

  const query = withKnownClient(parseReceivablesQuery(params), ageing)
  const current = searchOf(params)
  return (
    <ReceivablesDashboard
      figures={receivablesFigures(ageing, query)}
      byAge={bucketRows(ageing, query, current)}
      chips={receivablesChips(query, current)}
      clearHref={clearedReceivablesHref(current)}
      table={financeReceivablesPage(db, user, query, now)}
    />
  )
}
