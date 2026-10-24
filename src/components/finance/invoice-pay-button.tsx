"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { PayDialog } from "@/components/finance/pay-dialog"
import { Button } from "@/components/ui/button"
import { isPayableRow, type InvoiceRow, type PayOutcome, type SavedPaymentMethodView } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

export type InvoicePayButtonProps = {
  /** The invoice being shown; the button renders only while it is payable (open or overdue). */
  invoice: InvoiceRow
  method: SavedPaymentMethodView | null
  /** Starts the payment; bound to the real server action by the page. */
  onConfirm: (invoiceIds: string[]) => Promise<PayOutcome>
}

/** "Pay $X" for one invoice page: opens the shared `PayDialog` and refreshes the page once paid. */
export function InvoicePayButton({ invoice, method, onConfirm }: InvoicePayButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (!isPayableRow(invoice)) return null
  return (
    <>
      <Button disabled={!method} onClick={() => setOpen(true)} data-testid="invoice-pay">
        Pay {formatCents(invoice.totalCents)}
      </Button>
      <PayDialog
        open={open}
        onOpenChange={setOpen}
        invoices={[invoice]}
        method={method}
        onConfirm={onConfirm}
        onPaid={() => router.refresh()}
      />
    </>
  )
}
