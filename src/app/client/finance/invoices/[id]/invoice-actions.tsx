"use client"

import { Download } from "lucide-react"

import { InvoicePayButton } from "@/components/finance/invoice-pay-button"
import { Button } from "@/components/ui/button"
import type { InvoiceDetail, PayOutcome, SavedPaymentMethodView } from "@/lib/finance-view"

import { payInvoicesAction } from "../../actions"

async function payInvoices(invoiceIds: string[]): Promise<PayOutcome> {
  const result = await payInvoicesAction(invoiceIds)
  if (result.ok) return { ok: true, ...result.data }
  const code = typeof result.details?.error === "string" ? result.details.error : result.code
  return { ok: false, message: result.message, code }
}

/** Download PDF and Pay for the invoice page, bound to the client's server action. */
export function InvoiceActions({
  invoice,
  method,
  pdfHref,
}: {
  invoice: InvoiceDetail
  method: SavedPaymentMethodView | null
  pdfHref: string
}) {
  return (
    <>
      <Button variant="outline" nativeButton={false} render={<a href={pdfHref} download />} data-testid="invoice-pdf">
        <Download data-icon="inline-start" />
        Download PDF
      </Button>
      <InvoicePayButton invoice={invoice} method={method} onConfirm={payInvoices} />
    </>
  )
}
