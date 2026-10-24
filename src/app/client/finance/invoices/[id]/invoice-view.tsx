import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import { InvoiceDocument } from "@/components/finance/invoice-document"
import { financeQueries } from "@/server/finance-queries"

import { InvoiceActions } from "./invoice-actions"

export type InvoiceParams = Promise<{ id: string }>

function decodeId(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The signed-in client's invoice as a full page; another company's id is a 404 (the seam scopes every read). */
export async function InvoiceView({ params }: { params: InvoiceParams }) {
  const [{ id }, user] = await Promise.all([params, requirePortalUser("client_hr")])
  const clientId = user.clientCompanyId ?? ""
  const invoiceId = decodeId(id)
  const [invoice, method] = await Promise.all([
    financeQueries.getInvoiceDetail(clientId, invoiceId),
    financeQueries.getSavedPaymentMethod(clientId),
  ])
  if (!invoice) notFound()
  return (
    <InvoiceDocument
      invoice={invoice}
      actions={
        <InvoiceActions
          invoice={invoice}
          method={method}
          pdfHref={`/client/finance/invoices/${encodeURIComponent(invoice.id)}/pdf`}
        />
      }
    />
  )
}
