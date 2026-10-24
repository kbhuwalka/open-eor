import Link from "next/link"
import { cn } from "cn"

import { DenseRow } from "@/components/dense-list"
import { buttonVariants } from "@/components/ui/button"
import { PAYMENTS_PATH, waitingDetail } from "@/lib/finance-home-view"
import { waitAge } from "@/lib/finance-portal-view"
import { formatCents } from "@/lib/format"
import { financePaymentHref } from "@/lib/invoice-links"
import type { OldestWaitingPayments, WaitingPayment } from "@/server/finance-insights"

import { HomeSettleButton, HomeSettleProvider, HomeSettleStatus } from "./home-settle"

const ROW_LINK =
  "flex min-w-0 flex-1 items-center truncate text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50"

function WaitingRow({ payment, today }: { payment: WaitingPayment; today: string }) {
  const age = waitAge(payment.initiatedAt, today)
  return (
    <DenseRow
      cursor={false}
      className="h-12"
      data-testid="waiting-row"
      data-payment-id={payment.paymentId}
      data-deposit={payment.deposit ? "true" : undefined}
    >
      <Link href={financePaymentHref(payment.paymentId)} className={ROW_LINK} data-testid="waiting-open">
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium" data-testid="waiting-client">
            {payment.companyName}
          </span>
          <span className="truncate text-xs text-muted-foreground" data-testid="waiting-detail">
            {waitingDetail(payment)}
          </span>
        </span>
      </Link>
      <span
        className={cn("w-16 shrink-0 text-right tabular-nums", age.late ? "text-status-danger-foreground" : "text-muted-foreground")}
        data-testid="waiting-age"
        data-late={age.late || undefined}
      >
        <span className="sr-only">Waiting </span>
        {age.label}
      </span>
      <span className="w-28 shrink-0 text-right font-medium tabular-nums" data-slot="money" data-testid="waiting-amount">
        <span className="sr-only">Amount </span>
        {formatCents(payment.amountCents)}
      </span>
      <span className="relative z-10 shrink-0">
        <HomeSettleButton
          payment={{
            id: payment.paymentId,
            amountCents: payment.amountCents,
            companyName: payment.companyName,
            invoiceCount: payment.invoiceCount,
            depositPersonName: payment.deposit?.personName ?? null,
          }}
        />
      </span>
    </DenseRow>
  )
}

/**
 * "Waiting on you": the first payments of To settle (deposits first, then the longest-waiting), each
 * row opening the payment in the drawer on Payments and carrying the same Settle as Payments. The
 * header counts every payment to settle; "View all" goes to Payments.
 */
export function WaitingOnYou({ waiting, today }: { waiting: OldestWaitingPayments; today: string }) {
  return (
    <HomeSettleProvider>
      <section aria-labelledby="waiting-on-you-title" className="flex flex-col gap-2" data-testid="waiting-on-you">
        <div className="flex min-h-8 items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h3 id="waiting-on-you-title" className="text-sm font-medium">
              Waiting on you{" "}
              <span className="font-normal text-muted-foreground tabular-nums" data-testid="waiting-count">
                {waiting.total.count}
              </span>
            </h3>
            <HomeSettleStatus />
          </div>
          <Link href={PAYMENTS_PATH} className={buttonVariants({ variant: "ghost", size: "sm" })} data-testid="waiting-view-all">
            View all
          </Link>
        </div>
        {waiting.payments.length > 0 ? (
          <ul className="border-t border-border" data-testid="waiting-list">
            {waiting.payments.map((payment) => (
              <WaitingRow key={payment.paymentId} payment={payment} today={today} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground" data-testid="waiting-empty">
            Nothing waiting on you.
          </p>
        )}
      </section>
    </HomeSettleProvider>
  )
}
