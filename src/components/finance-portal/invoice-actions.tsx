"use client"

import { useState } from "react"
import { MoreHorizontal } from "lucide-react"

import { markDepositReceivedAction, voidInvoiceAction } from "@/app/finance/actions"
import { ActionDialog } from "@/components/finance-portal/action-dialog"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { StaffInvoiceRow } from "@/lib/finance-staff-view"
import { formatCents } from "@/lib/format"

type InvoiceTarget = Pick<StaffInvoiceRow, "id" | "number" | "personName" | "totalCents" | "caseId" | "kind">

function InvoiceFacts({ row }: { row: InvoiceTarget }) {
  return (
    <SummaryCard>
      <SummaryRow label="Invoice">{row.number}</SummaryRow>
      <SummaryRow label="Person">{row.personName}</SummaryRow>
      <SummaryRow label="Amount" strong>
        {formatCents(row.totalCents)}
      </SummaryRow>
    </SummaryCard>
  )
}

/**
 * "Mark as paid" on an unpaid deposit with nothing in flight: the client paid outside the product.
 * The deposit reads Paid and the order's deposit steps complete, as if the payment had settled.
 */
export function MarkPaidButton({ row, onDone }: { row: InvoiceTarget; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="mark-paid">
        Mark as paid
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Mark ${row.number} as paid?`}
        description={`Use this when the client paid outside the product. The deposit reads Paid and ${row.personName}'s order moves on.`}
        confirmLabel="Mark as paid"
        pendingLabel="Marking paid…"
        onConfirm={() => markDepositReceivedAction(row.caseId)}
        onDone={onDone}
        testId="mark-paid-dialog"
      >
        <InvoiceFacts row={row} />
      </ActionDialog>
    </>
  )
}

/**
 * The invoice drawer's overflow menu, shown only while it has an item: "Void invoice", only while
 * nothing has paid or started to pay the invoice. Voiding asks for a reason and cannot be undone.
 */
export function InvoiceMoreMenu({ row, onDone }: { row: InvoiceTarget; onDone: () => void }) {
  const [voiding, setVoiding] = useState(false)
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={<DropdownMenuTrigger />}
            aria-label="More actions"
            className={buttonVariants({ variant: "outline", size: "icon" })}
            data-testid="invoice-more"
          >
            <MoreHorizontal />
          </TooltipTrigger>
          <TooltipContent side="bottom">More actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuItem variant="destructive" onClick={() => setVoiding(true)} data-testid="void-invoice">
            Void invoice
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ActionDialog
        open={voiding}
        onOpenChange={setVoiding}
        title={`Void ${row.number}?`}
        description={
          row.kind === "payroll"
            ? "The invoice is cancelled and can no longer be paid, and its pay slip is withdrawn. This cannot be undone."
            : "The invoice is cancelled and can no longer be paid. This cannot be undone."
        }
        confirmLabel="Void invoice"
        pendingLabel="Voiding…"
        tone="danger"
        reason={{ label: "Reason", placeholder: "Billed in error: wrong start date", help: "Kept on the invoice." }}
        onConfirm={(reason) => voidInvoiceAction(row.id, reason)}
        onDone={onDone}
        cancelLabel="Keep invoice"
        testId="void-dialog"
      >
        <InvoiceFacts row={row} />
      </ActionDialog>
    </>
  )
}
