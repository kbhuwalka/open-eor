"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { voidInvoiceAction } from "@/app/finance/actions"
import { ActionDialog } from "@/components/finance-portal/action-dialog"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/format"

/**
 * Void invoice: only while nobody has paid or started to pay it (open, overdue). A payroll invoice's
 * pay slip is withdrawn with it. The reason is required and kept on the invoice.
 */
export function VoidInvoiceButton({
  invoiceId,
  number,
  personName,
  totalCents,
}: {
  invoiceId: string
  number: string
  personName: string
  totalCents: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} data-testid="void-invoice">
        Void invoice
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Void ${number}?`}
        description="The invoice is cancelled and can no longer be paid. A payroll invoice's pay slip is withdrawn with it. This cannot be undone."
        confirmLabel="Void invoice"
        pendingLabel="Voiding…"
        tone="danger"
        reason={{ label: "Reason", placeholder: "Billed in error: wrong start date", help: "Kept on the invoice." }}
        onConfirm={(reason) => voidInvoiceAction(invoiceId, reason)}
        onDone={() => router.refresh()}
        cancelLabel="Keep invoice"
        testId="void-dialog"
      >
        <SummaryCard>
          <SummaryRow label="Invoice">{number}</SummaryRow>
          <SummaryRow label="Person">{personName}</SummaryRow>
          <SummaryRow label="Amount" strong>
            {formatCents(totalCents)}
          </SummaryRow>
        </SummaryCard>
      </ActionDialog>
    </>
  )
}
