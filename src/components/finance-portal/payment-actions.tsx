"use client"

import { useId, useState, useTransition } from "react"
import { CircleAlert, MoreHorizontal } from "lucide-react"

import { failPaymentAction, settlePaymentAction, settlePaymentsAction, type BulkSettleResult } from "@/app/finance/actions"
import { ActionDialog, REASON_MAX } from "@/components/finance-portal/action-dialog"
import { MoneyCell } from "@/components/finance/money-cell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { plural } from "@/lib/finance-portal-view"
import { failConsequence, type StaffPaymentRow } from "@/lib/finance-staff-view"
import { formatCents } from "@/lib/format"

/** What the Settle dialog states: the amount, the client, how many invoices and whose deposit. */
export type SettleTarget = Pick<StaffPaymentRow, "id" | "amountCents" | "companyName"> & {
  invoiceCount: number
  depositPersonName: string | null
}

export function settleTargetOf(payment: Pick<StaffPaymentRow, "id" | "amountCents" | "companyName" | "invoices" | "deposit">): SettleTarget {
  return {
    id: payment.id,
    amountCents: payment.amountCents,
    companyName: payment.companyName,
    invoiceCount: payment.invoices.length,
    depositPersonName: payment.deposit?.personName ?? null,
  }
}

function settleDescription(payment: SettleTarget): string {
  const invoices = payment.invoiceCount === 1 ? "Its invoice becomes Paid." : `Its ${payment.invoiceCount} invoices become Paid.`
  const deposit = payment.depositPersonName ? ` It also confirms ${payment.depositPersonName}'s deposit, so onboarding can move on.` : ""
  return `Use this once the ACH transfer has cleared. ${invoices}${deposit}`
}

/** Settle one payment: the money arrived, its invoices become Paid and a deposit confirms its order. */
export function SettleDialog({
  payment,
  onOpenChange,
  onDone,
}: {
  payment: SettleTarget | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const amount = payment ? formatCents(payment.amountCents) : ""
  return (
    <ActionDialog
      open={payment !== null}
      onOpenChange={onOpenChange}
      title={payment ? `Settle ${amount} from ${payment.companyName}?` : "Settle"}
      description={payment ? settleDescription(payment) : ""}
      confirmLabel={`Settle ${amount}`}
      pendingLabel="Settling…"
      onConfirm={() => settlePaymentAction(payment?.id)}
      onDone={onDone}
      testId="settle-dialog"
    />
  )
}

/**
 * Settle the selected payments, each on its own: one that is no longer waiting does not hold back
 * the rest. The dialog states the total to the cent; what settled and what did not comes back to
 * the bulk bar.
 */
export function BulkSettleDialog({
  payments,
  open,
  onOpenChange,
  onDone,
}: {
  payments: readonly Pick<SettleTarget, "id" | "amountCents" | "companyName">[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (result: BulkSettleResult) => void
}) {
  const total = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Settle ${plural(payments.length, "payment")}?`}
      description="Use this once the transfers have cleared. Each payment settles on its own: its invoices become Paid and a deposit confirms its order."
      confirmLabel={`Settle ${formatCents(total)}`}
      pendingLabel="Settling…"
      onConfirm={() => settlePaymentsAction(payments.map((payment) => payment.id))}
      onDone={onDone}
      testId="bulk-settle-dialog"
    >
      <ul className="max-h-56 overflow-y-auto border-t border-border text-sm" data-testid="bulk-settle-list">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center justify-between gap-4 border-b border-border py-2">
            <span className="truncate">{payment.companyName}</span>
            <MoneyCell cents={payment.amountCents} className="shrink-0" />
          </li>
        ))}
      </ul>
    </ActionDialog>
  )
}

/**
 * "Mark failed" inside the payment drawer: a required reason, what failing does in one line, and
 * the action. A refusal (the payment was settled or failed meanwhile) stays here and changes nothing.
 */
export function FailPaymentForm({
  payment,
  onCancel,
  onDone,
}: {
  payment: Pick<StaffPaymentRow, "id" | "invoices" | "deposit">
  onCancel: () => void
  onDone: () => void
}) {
  const id = useId()
  const [reason, setReason] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    const text = reason.trim()
    if (text === "") return setFieldError("Say why the payment failed.")
    if (text.length > REASON_MAX) return setFieldError(`Keep the reason under ${REASON_MAX} characters.`)
    setFieldError(null)
    setError(null)
    start(async () => {
      const result = await failPaymentAction(payment.id, text)
      if (result.ok) onDone()
      else setError(result.message)
    })
  }

  return (
    <section aria-label="Mark failed" className="flex flex-col gap-3 rounded-lg border border-border p-4" data-testid="fail-form">
      <Field data-invalid={fieldError ? true : undefined}>
        <FieldLabel htmlFor={`${id}-reason`}>Why did it fail? *</FieldLabel>
        <Textarea
          id={`${id}-reason`}
          autoFocus
          value={reason}
          onChange={(event) => {
            setReason(event.target.value)
            if (fieldError) setFieldError(null)
          }}
          rows={2}
          maxLength={REASON_MAX + 50}
          placeholder="ACH return R01: insufficient funds"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${id}-consequence${fieldError ? ` ${id}-error` : ""}`}
          data-testid="fail-reason"
        />
        <FieldError id={`${id}-error`} data-testid="fail-reason-error">
          {fieldError}
        </FieldError>
      </Field>
      <p id={`${id}-consequence`} className="text-sm text-muted-foreground" data-testid="fail-consequence">
        {failConsequence(payment)} The client sees the reason.
      </p>
      {error ? (
        <Alert variant="destructive" data-testid="fail-error">
          <CircleAlert aria-hidden />
          <AlertTitle>Nothing was changed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={onCancel} data-testid="fail-cancel">
          Cancel
        </Button>
        <Button variant="danger" size="sm" disabled={pending} onClick={submit} data-testid="fail-confirm">
          {pending ? "Marking failed…" : "Mark failed"}
        </Button>
      </div>
    </section>
  )
}

/** A To settle row's overflow menu: "Mark failed" opens the drawer with the reason field showing. */
export function PaymentRowMenu({ label, onMarkFailed }: { label: string; onMarkFailed: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${label}`} data-testid="payment-row-menu" />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem variant="destructive" onClick={onMarkFailed} data-testid="row-mark-failed">
          Mark failed
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
