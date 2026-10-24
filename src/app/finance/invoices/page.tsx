import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { InvoicesList } from "@/components/finance-portal/invoices-list"
import { TableSkeleton } from "@/components/finance-portal/skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { parseInvoicesQuery } from "@/lib/finance-portal-query"
import { listFinanceInvoices } from "@/server/billing-queries"
import { listCompanyOptions } from "@/server/finance-portal-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function FinanceInvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" description="Every invoice across clients: payroll and deposit." />
      <Suspense fallback={<TableSkeleton filters />}>
        <Invoices searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Invoices({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("finance"), searchParams])
  const query = parseInvoicesQuery(params)
  const db = getDb()
  const data = listFinanceInvoices(
    db,
    user,
    {
      q: query.q,
      status: query.status,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.company ? { companyId: query.company } : {}),
      ...(query.from ? { issuedFrom: query.from } : {}),
      ...(query.to ? { issuedTo: query.to } : {}),
      ...(query.sort ? { sort: query.sort, dir: query.dir } : {}),
      page: query.page,
      pageSize: query.size,
    },
    new Date(),
  )
  return <InvoicesList data={data} query={query} companies={listCompanyOptions(db, user)} />
}
