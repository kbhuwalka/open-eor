import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { FinanceDashboardSkeleton } from "@/components/finance/finance-dashboard"
import { PageHeader } from "@/components/page-header"
import { financeQueries } from "@/server/finance-queries"

import { FinanceClient } from "./finance-client"

export default function FinancePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Finance" description="Invoices you still need to pay, and the payments you have made to Northwind." />
      <Suspense fallback={<FinanceDashboardSkeleton />}>
        <Finance />
      </Suspense>
    </div>
  )
}

async function Finance() {
  const user = await requirePortalUser("client_hr")
  const clientId = user.clientCompanyId ?? ""
  const [summary, invoices, payments, method] = await Promise.all([
    financeQueries.getClientFinanceSummary(clientId),
    financeQueries.listClientInvoices(clientId),
    financeQueries.listClientPayments(clientId),
    financeQueries.getSavedPaymentMethod(clientId),
  ])
  return <FinanceClient summary={summary} invoices={invoices} payments={payments} method={method} />
}
