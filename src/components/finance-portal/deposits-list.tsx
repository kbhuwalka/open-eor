"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { markDepositNotReceivedAction, markDepositReceivedAction } from "@/app/finance/actions"
import { ActionDialog } from "@/components/finance-portal/action-dialog"
import { EmptyState } from "@/components/empty-state"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { UrlPagination } from "@/components/data-table/url-pagination"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"
import type { PageSlice } from "@/lib/pagination"
import type { InvoiceDisplayStatus } from "@/lib/finance-view"
import type { PendingDeposit } from "@/server/finance-portal-queries"

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

/** `depositState` as an invoice badge: processing, or open (overdue once past its due date). */
export function depositBadgeStatus(deposit: Pick<PendingDeposit, "state" | "overdue">): InvoiceDisplayStatus {
  if (deposit.state === "processing") return "processing"
  return deposit.overdue ? "overdue" : "open"
}

const STATE_NOTE: Record<PendingDeposit["state"], string> = {
  processing: "Client paid; waiting for you to confirm",
  open: "Awaiting payment",
}

function DepositFacts({ deposit }: { deposit: PendingDeposit }) {
  return (
    <SummaryCard>
      <SummaryRow label="Person">{deposit.personName}</SummaryRow>
      <SummaryRow label="Client">{deposit.companyName}</SummaryRow>
      <SummaryRow label="Deposit invoice">{deposit.invoiceNumber}</SummaryRow>
      <SummaryRow label="Amount" strong>
        {formatCents(deposit.amountCents)}
      </SummaryRow>
    </SummaryCard>
  )
}

export function ConfirmDepositDialog({
  deposit,
  onOpenChange,
  onDone,
}: {
  deposit: PendingDeposit | null
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  return (
    <ActionDialog
      open={deposit !== null}
      onOpenChange={onOpenChange}
      title="Confirm deposit received?"
      description={
        deposit?.state === "processing"
          ? "The client's ACH payment settles and the deposit invoice becomes Paid. The Confirm deposit step completes and onboarding can continue."
          : "The client has not paid in the product. This records the deposit as received outside it: the invoice becomes Paid and the Confirm deposit step completes."
      }
      confirmLabel={deposit ? `Confirm ${formatCents(deposit.amountCents)} received` : "Confirm received"}
      pendingLabel="Confirming…"
      onConfirm={() => markDepositReceivedAction(deposit?.caseId)}
      onDone={onDone}
      testId="confirm-deposit-dialog"
    >
      {deposit ? <DepositFacts deposit={deposit} /> : null}
    </ActionDialog>
  )
}

/** The client's payment is in flight and the money did not arrive: fail it, so the client can pay again. */
export function NotReceivedDialog({
  deposit,
  onOpenChange,
  onDone,
}: {
  deposit: PendingDeposit | null
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const others = deposit && deposit.paymentInvoiceCount > 1 ? deposit.paymentInvoiceCount - 1 : 0
  return (
    <ActionDialog
      open={deposit !== null}
      onOpenChange={onOpenChange}
      title="Deposit not received?"
      description={
        <>
          The client&apos;s payment is marked failed and the deposit invoice is due again. The client sees it on their Invoices tab and
          is asked to pay again.
          {others > 0 ? ` This payment also covers ${others} other invoice${others === 1 ? "" : "s"}; they become payable again too.` : ""}
        </>
      }
      confirmLabel="Mark not received"
      pendingLabel="Updating…"
      tone="danger"
      reason={{
        label: "Reason",
        placeholder: "The ACH debit was returned",
        help: "Added after \u201cDeposit not received\u201d and shown to the client on the payment.",
        optional: true,
      }}
      onConfirm={(reason) => markDepositNotReceivedAction(deposit?.caseId, reason)}
      onDone={onDone}
      testId="not-received-dialog"
    >
      {deposit ? <DepositFacts deposit={deposit} /> : null}
    </ActionDialog>
  )
}

/** Deposits whose invoice is open or processing, with Confirm received per order, and Not received while the client's payment is in flight. */
export function DepositsList({
  deposits,
  today,
  paging,
}: {
  /** The deposits of the current page. */
  deposits: readonly PendingDeposit[]
  today: string
  /** Where this page sits in the whole list; the shared bar shows above ten deposits. */
  paging?: Omit<PageSlice<PendingDeposit>, "rows">
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<PendingDeposit | null>(null)
  const [rejecting, setRejecting] = useState<PendingDeposit | null>(null)

  if (deposits.length === 0) {
    return (
      <div data-testid="no-deposits">
        <EmptyState message="No deposits are waiting on Finance. New orders appear here once their deposit invoice is issued, until it is paid." />
      </div>
    )
  }

  return (
    <>
      <section aria-label="Deposits awaiting Finance" className="overflow-hidden rounded-lg border border-border" data-testid="deposits-table">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={TH}>Person</TableHead>
              <TableHead className={TH}>Client</TableHead>
              <TableHead className={TH}>Deposit</TableHead>
              <TableHead className={TH}>Due</TableHead>
              <TableHead className={`${TH} text-right`}>Amount</TableHead>
              <TableHead className={TH}>Status</TableHead>
              <TableHead className={`${TH} text-right`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deposits.map((deposit) => (
              <TableRow key={deposit.invoiceId} data-testid="deposit-row" data-case-id={deposit.caseId} data-state={deposit.state}>
                <TableCell>
                  <div className="flex flex-col">
                    {deposit.taskId ? (
                      <Link
                        href={`/finance/tasks/${encodeURIComponent(deposit.taskId)}`}
                        className="w-fit rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        data-testid="deposit-task-link"
                      >
                        {deposit.personName}
                      </Link>
                    ) : (
                      <span className="font-medium">{deposit.personName}</span>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {deposit.startDate ? `Starts ${formatIsoDay(deposit.startDate)}` : "No start date"}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{deposit.companyName}</TableCell>
                <TableCell>
                  <Link
                    href={`/finance/invoices/${encodeURIComponent(deposit.invoiceId)}`}
                    className="rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {deposit.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(deposit.dueDate)}</TableCell>
                <TableCell>
                  <MoneyCell cents={deposit.amountCents} className="font-medium" />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col items-start gap-0.5">
                    <InvoiceStatusBadge status={depositBadgeStatus(deposit)} />
                    <span className="text-xs text-muted-foreground">
                      {STATE_NOTE[deposit.state]}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {deposit.taskId || deposit.paymentId ? (
                    <div className="flex justify-end gap-2">
                      {deposit.taskId ? (
                        <Button size="sm" variant="outline" onClick={() => setConfirming(deposit)} data-testid="confirm-deposit">
                          Confirm received
                        </Button>
                      ) : null}
                      {deposit.paymentId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRejecting(deposit)}
                          aria-label={`Deposit not received for ${deposit.personName}`}
                          data-testid="not-received-deposit"
                        >
                          Not received
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-right text-xs text-muted-foreground" data-testid="deposit-no-action">
                      Not ready for Finance yet
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {paging ? <UrlPagination page={paging.page} totalPages={paging.totalPages} total={paging.total} pageSize={paging.pageSize} /> : null}
      </section>
      <p className="text-xs text-muted-foreground">As of {formatIsoDay(today)}.</p>
      <ConfirmDepositDialog deposit={confirming} onOpenChange={(open) => !open && setConfirming(null)} onDone={() => router.refresh()} />
      <NotReceivedDialog deposit={rejecting} onOpenChange={(open) => !open && setRejecting(null)} onDone={() => router.refresh()} />
    </>
  )
}
