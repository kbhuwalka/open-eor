import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { FinanceDashboardSkeleton } from "@/components/finance/finance-dashboard"
import { PageHeader } from "@/components/page-header"
import { parseOpenParam } from "@/lib/finance-drawer"
import { financeQueries } from "@/server/finance-queries"

import { FinanceClient } from "./finance-client"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** `/client/finance`, and `/client/finance?open=<invoiceId>` (`invoiceDrawerHref`) with that invoice open in the drawer. */
export default function FinancePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Finance" description="Invoices you still need to pay, and the payments you have made to Northwind." />
      <Suspense fallback={<FinanceDashboardSkeleton />}>
        <Finance searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Finance({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser("client_hr"), searchParams])
  const clientId = user.clientCompanyId ?? ""
  const [summary, invoices, payments, method] = await Promise.all([
    financeQueries.getClientFinanceSummary(clientId),
    financeQueries.listClientInvoices(clientId),
    financeQueries.listClientPayments(clientId),
    financeQueries.getSavedPaymentMethod(clientId),
  ])
  return (
    <FinanceClient
      summary={summary}
      invoices={invoices}
      payments={payments}
      method={method}
      linkedInvoiceId={parseOpenParam(params.open)}
    />
  )
}
