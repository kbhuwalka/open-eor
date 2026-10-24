import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { InvoicesScreen } from "@/components/finance-portal/invoices-screen"
import { InvoicesSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { parseOpenParam } from "@/lib/finance-drawer"
import { parseInvoicesQuery } from "@/lib/finance-portal-query"
import { financeInvoiceRecord, financeInvoicesPage } from "@/server/finance-lists"
import { listCompanyOptions } from "@/server/finance-portal-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** `/finance/invoices`, and `?open=<invoiceId>` (`financeInvoiceHref`) with that invoice open in the drawer. */
export default function FinanceInvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" />
      <Suspense fallback={<InvoicesSkeleton />}>
        <Invoices searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Invoices({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("finance"), searchParams])
  const db = getDb()
  const now = new Date()
  const openId = parseOpenParam(params.open)
  const query = parseInvoicesQuery(params)
  return (
    <InvoicesScreen
      data={financeInvoicesPage(db, user, query, now)}
      query={query}
      companies={listCompanyOptions(db, user)}
      linked={openId ? financeInvoiceRecord(db, user, openId, now) : null}
    />
  )
}
