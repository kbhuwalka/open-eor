import Link from "next/link"
import { cn } from "cn"

import { MoneyCell } from "@/components/finance/money-cell"
import { buttonVariants } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDayInYear } from "@/lib/finance-format"
import { paymentsHref, waitingTitle } from "@/lib/finance-home-view"
import { waitAge } from "@/lib/finance-portal-view"
import { financePaymentHref } from "@/lib/invoice-links"
import type { OldestWaitingPayments, WaitingPayment } from "@/server/finance-insights"

import { HomeSettleButton, HomeSettleProvider, HomeSettleStatus } from "./home-settle"

const HEAD = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

const ROW_LINK =
  "flex min-w-0 flex-col items-start outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50"

function WaitingRow({ payment, today }: { payment: WaitingPayment; today: string }) {
  const age = waitAge(payment.initiatedAt, today)
  return (
    <TableRow
      className="relative"
      data-testid="waiting-row"
      data-payment-id={payment.paymentId}
      data-deposit={payment.deposit ? "true" : undefined}
    >
      <TableCell>
        <Link href={financePaymentHref(payment.paymentId)} className={ROW_LINK} data-testid="waiting-open">
          <span className="max-w-full truncate font-medium tabular-nums" data-testid="waiting-invoice">
            {waitingTitle(payment)}
          </span>
          <span className="max-w-full truncate text-xs text-muted-foreground" title={payment.companyName} data-testid="waiting-client">
            {payment.companyName}
          </span>
        </Link>
      </TableCell>
      <TableCell
        className={cn("tabular-nums", age.late && "text-status-danger-foreground")}
        data-testid="waiting-due"
        data-late={age.late || undefined}
      >
        {formatIsoDayInYear(age.due, today)}
      </TableCell>
      <TableCell data-testid="waiting-amount">
        <span className="sr-only">Amount </span>
        <MoneyCell cents={payment.amountCents} />
      </TableCell>
      <TableCell className="relative z-10 text-right">
        <HomeSettleButton
          payment={{
            id: payment.paymentId,
            amountCents: payment.amountCents,
            companyName: payment.companyName,
            invoiceCount: payment.invoiceCount,
            depositPersonName: payment.deposit?.personName ?? null,
          }}
        />
      </TableCell>
    </TableRow>
  )
}

/**
 * "To do" (named as on the client Home), as a table like Invoices: the first payments of To settle
 * (deposits first, then the longest-waiting), each row the invoice it settles (or "6 invoices")
 * with the client muted beneath, the day it is due to be settled (danger once late), the amount
 * and the same Settle as Payments. The row opens the payment in the drawer on Payments. The header
 * counts every payment to settle; "View all" goes to Payments. Filtered to one client (`client`),
 * the rows, the count and "View all" are that client's.
 */
export function FinanceTodo({ waiting, today, client = null }: { waiting: OldestWaitingPayments; today: string; client?: string | null }) {
  return (
    <HomeSettleProvider>
      <section aria-labelledby="finance-todo-title" className="flex flex-col gap-2" data-testid="waiting-on-you">
        <div className="flex min-h-8 items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h3 id="finance-todo-title" className="text-base font-semibold">
              To do{" "}
              <span className="font-normal text-muted-foreground tabular-nums">
                <span aria-hidden>· </span>
                <span data-testid="waiting-count">{waiting.total.count}</span>
              </span>
            </h3>
            <HomeSettleStatus />
          </div>
          <Link
            href={paymentsHref(client)}
            aria-label="View all payments"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            data-testid="waiting-view-all"
          >
            View all
          </Link>
        </div>
        {waiting.payments.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table className="table-fixed" data-testid="waiting-list">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className={HEAD}>
                    Invoice
                  </TableHead>
                  <TableHead scope="col" className={cn(HEAD, "w-28")}>
                    Due
                  </TableHead>
                  <TableHead scope="col" className={cn(HEAD, "w-32 text-right")}>
                    Amount
                  </TableHead>
                  <TableHead scope="col" className="w-28">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waiting.payments.map((payment) => (
                  <WaitingRow key={payment.paymentId} payment={payment} today={today} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="waiting-empty">
            You&apos;re all caught up.
          </p>
        )}
      </section>
    </HomeSettleProvider>
  )
}
