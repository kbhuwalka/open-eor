import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { TableSkeleton } from "@/components/finance-portal/skeletons"
import { ClientOpenInvoices, ReceivablesReport } from "@/components/finance-portal/receivables-report"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { parsePaging } from "@/lib/pagination"
import { listFinanceInvoices, receivables } from "@/server/billing-queries"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function FinanceReceivablesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Receivables" description="What clients owe, by how late it is. Choose a client to see its open invoices." />
      <Suspense fallback={<TableSkeleton />}>
        <Receivables searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Receivables({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("finance"), searchParams])
  const db = getDb()
  const now = new Date()
  const report = receivables(db, user, now)
  const requested = Array.isArray(params.company) ? params.company[0] : params.company
  const selected = report.companies.find((company) => company.companyId === requested) ?? null
  const own = parsePaging(params)
  const drill = parsePaging(params, "i")
  const open = selected
    ? listFinanceInvoices(
        db,
        user,
        { companyId: selected.companyId, status: "due", sort: "dueDate", dir: "asc", page: drill.page, pageSize: drill.size },
        now,
      )
    : null
  return (
    <>
      <ReceivablesReport report={report} selectedCompanyId={selected?.companyId ?? null} paging={own} />
      {selected && open ? (
        <ClientOpenInvoices
          rows={open.rows}
          paging={open}
          today={report.asOf}
          companyName={selected.companyName}
          companyId={selected.companyId}
        />
      ) : null}
    </>
  )
}
