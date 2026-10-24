"use client"

import { useCallback, useState } from "react"

import { DenseRow, DenseSection, RowOpener, useListCursor } from "@/components/dense-list"
import { EmptyState } from "@/components/empty-state"
import { PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { formatIsoDay } from "@/lib/finance-format"
import type { InvoiceRow, PaymentRow } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { initiallyCollapsed, paymentCoverLabel, paymentSections, type PaymentSectionKey } from "@/lib/payment-sections"

export type PaymentsListProps = {
  payments: readonly PaymentRow[]
  /** The client's invoices, to tell a failed payment that is still owed from one paid since. */
  invoices: readonly InvoiceRow[]
  /** Opens a payment in the drawer, with every payment id in list order for Previous and Next. */
  onOpen: (paymentId: string, orderedIds: string[]) => void
  /** False while the drawer is open, so `j`/`k` and Enter leave the list alone. */
  keyboard: boolean
}

/**
 * The Payments tab (ui-guidelines C24, the C43 list look): In progress and still-owed Failed
 * payments first, then the history by month, newest first (`paymentSections`); months after the
 * newest two start collapsed. One 40px row per payment: the amount and what it covered on the
 * left, the method and start day muted, the status on the right. The whole row opens the payment
 * drawer; `j`/`k` move a cursor and Enter opens it.
 */
export function PaymentsList({ payments, invoices, onOpen, keyboard }: PaymentsListProps) {
  const sections = paymentSections(payments, invoices)
  const [collapsed, setCollapsed] = useState<ReadonlySet<PaymentSectionKey>>(() => initiallyCollapsed(sections))
  const [cursor, setCursor] = useState<string | null>(null)

  const ordered = sections.flatMap((section) => section.payments.map((payment) => payment.id))
  const visible = sections.filter((section) => !collapsed.has(section.key)).flatMap((section) => section.payments.map((payment) => payment.id))
  const orderedKey = ordered.join("|")
  const open = useCallback(
    (paymentId: string) => {
      setCursor(paymentId)
      onOpen(paymentId, orderedKey.split("|"))
    },
    [onOpen, orderedKey],
  )
  useListCursor({ ids: visible, cursor, onCursor: setCursor, onOpen: open, enabled: keyboard })

  if (payments.length === 0) {
    return (
      <div data-testid="no-payments">
        <EmptyState message="No payments yet. When you pay invoices, each payment appears here with its status and the invoices it covers." />
      </div>
    )
  }

  const toggle = (key: PaymentSectionKey) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="flex flex-col gap-6" data-testid="payments-list">
      {sections.map((section) => (
        <DenseSection
          key={section.key}
          id={section.key}
          label={section.label}
          count={section.payments.length}
          open={!collapsed.has(section.key)}
          onToggle={() => toggle(section.key)}
        >
          {section.payments.map((payment) => (
            <DenseRow
              key={payment.id}
              cursor={cursor === payment.id}
              data-testid="payment-row"
              data-payment-id={payment.id}
              data-status={payment.status}
            >
              <RowOpener onOpen={() => open(payment.id)} className="flex-1" testId="payment-open">
                <span className="w-24 shrink-0 text-right font-medium tabular-nums" data-slot="money">
                  {formatCents(payment.amountCents)}
                </span>
                <span className="truncate" data-testid="payment-cover">
                  {paymentCoverLabel(payment)}
                </span>
                <span className="hidden truncate text-muted-foreground sm:inline">
                  {payment.methodLabel} · {formatIsoDay(payment.initiatedAt)}
                </span>
              </RowOpener>
              <PaymentStatusBadge status={payment.status} className="ml-auto shrink-0" />
            </DenseRow>
          ))}
        </DenseSection>
      ))}
    </div>
  )
}
