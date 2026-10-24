"use client"

import { useRouter } from "next/navigation"

import { FinanceDashboard, type FinanceDashboardProps } from "@/components/finance/finance-dashboard"
import { invoiceDrawerHref } from "@/lib/invoice-links"

import { invoicePdfHref, loadInvoiceDetail, payInvoices } from "./client-bindings"

type Data = Pick<FinanceDashboardProps, "summary" | "invoices" | "payments" | "method" | "linkedInvoiceId">

/**
 * Binds the real server actions to the dashboard; the data arrives from the server page. Closing a
 * drawer that `?open=` opened drops the parameter with `router.replace`, so a reload does not reopen it.
 */
export function FinanceClient(data: Data) {
  const router = useRouter()
  return (
    <FinanceDashboard
      {...data}
      payInvoices={payInvoices}
      loadInvoiceDetail={loadInvoiceDetail}
      pdfHref={invoicePdfHref}
      invoiceHref={invoiceDrawerHref}
      onLinkClosed={() => router.replace("/client/finance", { scroll: false })}
    />
  )
}
