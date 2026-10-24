"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { failPaymentAction, settlePaymentAction, settlePaymentsAction } from "@/app/finance/actions"
import { ActionDialog } from "@/components/finance-portal/action-dialog"
import { MoneyCell } from "@/components/finance/money-cell"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { formatIsoDay } from "@/lib/finance-format"
import { plural } from "@/lib/finance-portal-view"
import { formatCents } from "@/lib/format"
import type { PaymentListRow } from "@/server/billing-queries"

type PaymentSummary = Pick<PaymentListRow, "id" | "companyName" | "totalCents" | "methodLabel" | "initiatedAt" | "invoices">

function PaymentFacts({ payment }: { payment: PaymentSummary }) {
  return (
    <SummaryCard>
      <SummaryRow label="Client">{payment.companyName}</SummaryRow>
      <SummaryRow label="Method">{payment.methodLabel}</SummaryRow>
      <SummaryRow label="Started">{formatIsoDay(payment.initiatedAt)}</SummaryRow>
      <SummaryRow label={`Covers ${plural(payment.invoices.length, "invoice")}`}>
        <span className="text-xs">{payment.invoices.map((invoice) => invoice.number).join(", ")}</span>
      </SummaryRow>
      <SummaryRow label="Amount" strong>
        {formatCents(payment.totalCents)}
      </SummaryRow>
    </SummaryCard>
  )
}

type DialogProps<T> = {
  payment: T | null
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}

/** Confirms that money arrived: the payment settles and every invoice it covers becomes Paid. */
export function SettlePaymentDialog({ payment, onOpenChange, onDone }: DialogProps<PaymentSummary>) {
  return (
    <ActionDialog
      open={payment !== null}
      onOpenChange={onOpenChange}
      title="Settle this payment?"
      description="Use this once the ACH transfer has cleared. The invoices it covers become Paid. A deposit also completes the client's Confirm deposit step, so onboarding can move on."
      confirmLabel={payment ? `Settle ${formatCents(payment.totalCents)}` : "Settle"}
      pendingLabel="Settling…"
      onConfirm={() => settlePaymentAction(payment?.id)}
      onDone={onDone}
      testId="settle-dialog"
    >
      {payment ? <PaymentFacts payment={payment} /> : null}
    </ActionDialog>
  )
}

/** The transfer did not clear: the payment fails with a reason and its invoices become payable again. */
export function FailPaymentDialog({ payment, onOpenChange, onDone }: DialogProps<PaymentSummary>) {
  return (
    <ActionDialog
      open={payment !== null}
      onOpenChange={onOpenChange}
      title="Mark this payment as failed?"
      description="The invoices it covers become payable again and the client sees the reason."
      confirmLabel="Mark failed"
      pendingLabel="Marking failed…"
      tone="danger"
      reason={{ label: "Reason", placeholder: "ACH return R01: insufficient funds", help: "Shown to the client on the payment." }}
      onConfirm={(reason) => failPaymentAction(payment?.id, reason)}
      onDone={onDone}
      testId="fail-dialog"
    >
      {payment ? <PaymentFacts payment={payment} /> : null}
    </ActionDialog>
  )
}

/** Settles several payments at once; ones that are no longer waiting are reported, not hidden. */
export function BulkSettleDialog({
  payments,
  open,
  onOpenChange,
  onDone,
}: {
  payments: readonly PaymentSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const total = payments.reduce((sum, payment) => sum + payment.totalCents, 0)
  const [skipped, setSkipped] = useState<string | null>(null)
  return (
    <ActionDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setSkipped(null)
        onOpenChange(next)
      }}
      title={`Settle ${plural(payments.length, "payment")}?`}
      description="Each payment settles on its own: its invoices become Paid and any deposit moves its order forward."
      confirmLabel={`Settle ${formatCents(total)}`}
      pendingLabel="Settling…"
      onConfirm={async () => {
        const result = await settlePaymentsAction(payments.map((payment) => payment.id))
        if (result.ok && result.data.failed.length > 0) {
          setSkipped(`${plural(result.data.failed.length, "payment")} could not be settled: ${result.data.failed[0].message}`)
        }
        return result
      }}
      onDone={onDone}
      testId="bulk-settle-dialog"
    >
      <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm" data-testid="bulk-settle-list">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{payment.companyName}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{payment.id}</span>
            </div>
            <MoneyCell cents={payment.totalCents} className="shrink-0" />
          </li>
        ))}
      </ul>
      {skipped ? (
        <p className="text-xs text-status-danger-foreground" role="status">
          {skipped}
        </p>
      ) : null}
    </ActionDialog>
  )
}

/** Settle and Mark failed for one payment, shown only while it is waiting. Used on the detail page. */
export function PaymentDetailActions({ payment }: { payment: PaymentSummary & { status: PaymentListRow["status"] } }) {
  const router = useRouter()
  const [settle, setSettle] = useState(false)
  const [failing, setFailing] = useState(false)
  if (payment.status !== "initiated") return null
  return (
    <>
      <Button onClick={() => setSettle(true)} data-testid="settle-payment">
        Settle
      </Button>
      <Button variant="outline" onClick={() => setFailing(true)} data-testid="fail-payment">
        Mark failed
      </Button>
      <SettlePaymentDialog payment={settle ? payment : null} onOpenChange={setSettle} onDone={() => router.refresh()} />
      <FailPaymentDialog payment={failing ? payment : null} onOpenChange={setFailing} onDone={() => router.refresh()} />
    </>
  )
}
