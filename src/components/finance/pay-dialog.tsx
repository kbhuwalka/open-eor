"use client"

import { useState, useTransition } from "react"
import { CircleAlert, CircleCheck } from "lucide-react"

import { MoneyCell } from "@/components/finance/money-cell"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatIsoDay } from "@/lib/finance-format"
import type { InvoiceRow, PayOutcome, SavedPaymentMethodView } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

type Result = { ok: true; outcome: Extract<PayOutcome, { ok: true }> } | { ok: false; message: string } | null

export type PayDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The invoices being paid, exactly as selected. */
  invoices: readonly InvoiceRow[]
  /** The saved ACH method, shown read-only. `null` disables Confirm. */
  method: SavedPaymentMethodView | null
  onConfirm: (invoiceIds: string[]) => Promise<PayOutcome>
  /** Called once after a successful payment, with the ids that were paid. */
  onPaid?: (invoiceIds: string[]) => void
}

/**
 * Confirms one ACH payment: the invoices, the total, the saved method (no add or edit) and the
 * timing. Success replaces the body in place; an error stays in the dialog above the actions.
 */
export function PayDialog({ open, onOpenChange, invoices, method, onConfirm, onPaid }: PayDialogProps) {
  const [result, setResult] = useState<Result>(null)
  const [pending, start] = useTransition()
  const totalCents = invoices.reduce((total, invoice) => total + invoice.totalCents, 0)
  const count = invoices.length

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setResult(null)
  }

  function confirm() {
    setResult(null)
    start(async () => {
      const outcome = await onConfirm(invoices.map((invoice) => invoice.id))
      if (outcome.ok) {
        setResult({ ok: true, outcome })
        onPaid?.(outcome.invoiceIds)
      } else {
        setResult({ ok: false, message: outcome.message })
      }
    })
  }

  if (result?.ok) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent data-testid="pay-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleCheck className="size-4 text-status-success-foreground" aria-hidden />
              Payment initiated
            </DialogTitle>
            <DialogDescription data-testid="pay-success">
              {formatCents(result.outcome.totalCents)} for {result.outcome.invoiceIds.length}{" "}
              {result.outcome.invoiceIds.length === 1 ? "invoice" : "invoices"} is on its way. The invoices show as
              Processing until Finance confirms the payment has settled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button />} data-testid="pay-done">
              Done
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="pay-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Pay {count} {count === 1 ? "invoice" : "invoices"}
          </DialogTitle>
          <DialogDescription>Review what you are paying, then confirm.</DialogDescription>
        </DialogHeader>

        <ul
          className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm"
          data-testid="pay-invoices"
        >
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{invoice.number}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {invoice.personName} · due {formatIsoDay(invoice.dueDate)}
                </span>
              </div>
              <MoneyCell cents={invoice.totalCents} className="shrink-0" />
            </li>
          ))}
        </ul>

        <SummaryCard>
          <SummaryRow label="Total" strong>
            <span data-testid="pay-total">{formatCents(totalCents)}</span>
          </SummaryRow>
          <SummaryRow label="Payment method">
            {method ? (
              <span data-testid="pay-method">
                {method.label} — {method.bankName}
              </span>
            ) : (
              <span className="text-muted-foreground" data-testid="pay-method">
                None on file
              </span>
            )}
          </SummaryRow>
        </SummaryCard>

        <p className="text-xs text-muted-foreground">
          {method
            ? "The ACH payment is initiated now. Invoices show as Processing and settle after Finance confirms the payment."
            : "A payment method is needed to pay online. Contact your Northwind account manager to set one up."}
        </p>

        {result && !result.ok ? (
          <Alert variant="destructive" data-testid="pay-error">
            <CircleAlert aria-hidden />
            <AlertTitle>Payment not started</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={pending || !method || count === 0} onClick={confirm} data-testid="pay-confirm">
            {pending ? "Starting payment…" : `Pay ${formatCents(totalCents)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
