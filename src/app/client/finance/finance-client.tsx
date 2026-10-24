"use client"

import { FinanceDashboard, type FinanceDashboardProps } from "@/components/finance/finance-dashboard"
import type { PayOutcome } from "@/lib/finance-view"

import { getInvoiceDetailAction, payInvoicesAction } from "./actions"

async function payInvoices(invoiceIds: string[]): Promise<PayOutcome> {
  const result = await payInvoicesAction(invoiceIds)
  if (result.ok) return { ok: true, ...result.data }
  const code = typeof result.details?.error === "string" ? result.details.error : result.code
  return { ok: false, message: result.message, code }
}

const pdfHref = (invoiceId: string) => `/client/finance/invoices/${encodeURIComponent(invoiceId)}/pdf`
const invoiceHref = (invoiceId: string) => `/client/finance/invoices/${encodeURIComponent(invoiceId)}`

type Data = Pick<FinanceDashboardProps, "summary" | "invoices" | "payments" | "method">

/** Binds the real server actions to the dashboard; the data arrives from the server page. */
export function FinanceClient(data: Data) {
  return (
    <FinanceDashboard
      {...data}
      payInvoices={payInvoices}
      loadInvoiceDetail={getInvoiceDetailAction}
      pdfHref={pdfHref}
      invoiceHref={invoiceHref}
    />
  )
}
