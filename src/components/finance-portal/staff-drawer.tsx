"use client"

import { useState } from "react"

import { loadFinanceInvoiceDetailAction } from "@/app/finance/actions"
import { DrawerBody, DrawerHeader, DrawerLoadError, DrawerShell, DrawerSkeleton } from "@/components/drawer/drawer-shell"
import { InvoiceMoreMenu, MarkPaidButton } from "@/components/finance-portal/invoice-actions"
import { FailPaymentForm, SettleDialog, settleTargetOf } from "@/components/finance-portal/payment-actions"
import type { FinanceRecords } from "@/components/finance-portal/use-finance-records"
import { InvoicePanel } from "@/components/finance/invoice-drawer"
import { PaymentPanel, paymentTitle } from "@/components/finance/payment-drawer"
import { Button } from "@/components/ui/button"
import { formatIsoShortDay } from "@/lib/finance-format"
import { financeInvoiceHref, financeInvoicePdfHref, financePaymentHref } from "@/lib/invoice-links"
import {
  isVoidable,
  staffViewPosition,
  stepStaffView,
  swapView,
  type StaffDrawerView,
  type StaffPaymentRow,
} from "@/lib/finance-staff-view"

export type StaffDrawerProps = {
  view: StaffDrawerView | null
  onViewChange: (view: StaffDrawerView | null) => void
  records: FinanceRecords
  /** After an action succeeds: refresh the page and the records. The drawer stays open on the record. */
  onChanged: () => void
}

const noPay = () => {}

/**
 * The Finance portal's one drawer (ui-guidelines C45, staff variant): a payment or an invoice, the
 * client's own panels with Finance's actions in their slots. A payment's invoice and an invoice's
 * payment swap the content in place with Back; Previous and Next walk the list it was opened from.
 */
export function StaffDrawer({ view, onViewChange, records, onChanged }: StaffDrawerProps) {
  const position = view ? staffViewPosition(view) : null
  const stepper =
    view && position
      ? { position, onStep: (delta: -1 | 1) => onViewChange(stepStaffView(view, delta)), noun: view.kind === "payment" ? "payment" : "invoice" }
      : undefined
  const back = view?.from ? { label: backLabel(view.from, records), onBack: () => onViewChange(view.from) } : undefined

  return (
    <DrawerShell open={view !== null} onClose={() => onViewChange(null)} data-testid={view?.kind === "invoice" ? "invoice-drawer" : "payment-drawer"}>
      {view?.kind === "payment" ? (
        <PaymentBody
          key={`payment:${view.id}:${records.version}:${view.intent ?? ""}`}
          view={view}
          records={records}
          stepper={stepper}
          back={back}
          onViewChange={onViewChange}
          onChanged={onChanged}
        />
      ) : view?.kind === "invoice" ? (
        <InvoiceBody
          key={`invoice:${view.id}:${records.version}`}
          view={view}
          records={records}
          stepper={stepper}
          back={back}
          onViewChange={onViewChange}
          onChanged={onChanged}
        />
      ) : null}
    </DrawerShell>
  )
}

function backLabel(from: StaffDrawerView, records: FinanceRecords): string {
  if (from.kind === "payment") {
    const found = records.payment(from.id)
    return found.state === "ready" ? paymentTitle(found.value) : "Payment"
  }
  const found = records.invoice(from.id)
  return found.state === "ready" ? found.value.number : "Invoice"
}

type BodyProps = {
  view: StaffDrawerView
  records: FinanceRecords
  stepper?: { position: { index: number; total: number }; onStep: (delta: -1 | 1) => void; noun: string }
  back?: { label: string; onBack: () => void }
  onViewChange: (view: StaffDrawerView | null) => void
  onChanged: () => void
}

function NotShown({ kind, state, onRetry, back, stepper }: { kind: "payment" | "invoice"; state: "loading" | "missing" | "error"; onRetry: () => void } & Pick<BodyProps, "back" | "stepper">) {
  const noun = kind === "payment" ? "payment" : "invoice"
  return (
    <>
      <DrawerHeader title={kind === "payment" ? "Payment" : "Invoice"} back={back} stepper={stepper} />
      <DrawerBody>
        {state === "loading" ? (
          <DrawerSkeleton />
        ) : (
          <DrawerLoadError title={state === "missing" ? `That ${noun} was not found` : `The ${noun} could not be loaded`} onRetry={onRetry}>
            <p>{state === "missing" ? "It may have been removed. Nothing has been changed." : "Nothing has been changed."}</p>
          </DrawerLoadError>
        )}
      </DrawerBody>
    </>
  )
}

function depositNoteText(payment: StaffPaymentRow): string | null {
  const deposit = payment.deposit
  if (!deposit || payment.status !== "initiated") return null
  const starts = deposit.startDate ? `, who starts ${formatIsoShortDay(deposit.startDate)}` : ""
  if (deposit.orderCancelled) return `Deposit for ${deposit.personName}${starts}. The order was cancelled.`
  return deposit.reopensOnFail
    ? `Deposit for ${deposit.personName}${starts}. Settling it confirms the deposit, so onboarding can move on.`
    : `Deposit for ${deposit.personName}${starts}.`
}

function PaymentBody({ view, records, stepper, back, onViewChange, onChanged }: BodyProps) {
  const found = records.payment(view.id)
  const [failing, setFailing] = useState(view.intent === "fail")
  const [settling, setSettling] = useState(false)
  if (found.state !== "ready") {
    return <NotShown kind="payment" state={found.state} onRetry={() => records.retry(view)} back={back} stepper={stepper} />
  }
  const payment = found.value
  const waiting = payment.status === "initiated"
  const note = depositNoteText(payment)
  return (
    <>
      <PaymentPanel
        payment={payment}
        invoices={records.coveredInvoices(payment)}
        invoiceHref={financeInvoiceHref}
        onOpenInvoice={(invoiceId) =>
          onViewChange(swapView(view, "invoice", invoiceId, payment.invoices.map((ref) => ref.id)))
        }
        stepper={stepper}
        back={back}
        staff={{
          clientName: payment.companyName,
          actions: waiting ? (
            <>
              <Button onClick={() => setSettling(true)} data-testid="drawer-settle">
                Settle
              </Button>
              {failing ? null : (
                <Button variant="outline" onClick={() => setFailing(true)} data-testid="drawer-mark-failed">
                  Mark failed
                </Button>
              )}
            </>
          ) : null,
          top:
            waiting && failing ? (
              <FailPaymentForm payment={payment} onCancel={() => setFailing(false)} onDone={onChanged} />
            ) : null,
          note: note ? (
            <p className="text-sm text-muted-foreground" data-testid="payment-note">
              {note}
            </p>
          ) : null,
        }}
      />
      <SettleDialog payment={settling ? settleTargetOf(payment) : null} onOpenChange={setSettling} onDone={onChanged} />
    </>
  )
}

function InvoiceBody({ view, records, stepper, back, onViewChange, onChanged }: BodyProps) {
  const found = records.invoice(view.id)
  if (found.state !== "ready") {
    return <NotShown kind="invoice" state={found.state} onRetry={() => records.retry(view)} back={back} stepper={stepper} />
  }
  const row = found.value
  return (
    <InvoicePanel
      row={row}
      loadDetail={loadFinanceInvoiceDetailAction}
      pdfHref={financeInvoicePdfHref}
      canPay={false}
      onPay={noPay}
      stepper={stepper}
      back={back}
      staff={{
        clientName: row.companyName,
        leadingActions: row.canMarkPaid ? <MarkPaidButton row={row} onDone={onChanged} /> : null,
        trailingActions: isVoidable(row) ? <InvoiceMoreMenu row={row} onDone={onChanged} /> : null,
        onOpenPayment: (paymentId, paymentIds) => onViewChange(swapView(view, "payment", paymentId, paymentIds)),
        paymentHref: financePaymentHref,
      }}
    />
  )
}
