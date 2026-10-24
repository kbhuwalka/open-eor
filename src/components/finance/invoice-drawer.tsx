"use client"

import { useEffect, useState, type ReactNode } from "react"
import { cn } from "cn"
import { Download } from "lucide-react"

import { RowOpener } from "@/components/dense-list"
import {
  DrawerBody,
  DrawerFact as Fact,
  DrawerFacts,
  DrawerHeader,
  DrawerIconAction,
  DrawerLoadError,
  DrawerShell,
  DrawerSubhead as Subhead,
  type DrawerHeaderProps,
  type DrawerStepperProps,
} from "@/components/drawer/drawer-shell"
import { InvoiceStatusBadge, PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatIsoDay } from "@/lib/finance-format"
import { formatHistoryWhen, invoiceHistory } from "@/lib/finance-portal-view"
import { STAFF_INVOICE_STATUS_LABEL } from "@/lib/finance-staff-view"
import {
  INVOICE_KIND_LABEL,
  invoicePeriodLabel,
  invoiceRowProration,
  isPayableRow,
  type InvoiceDetail,
  type InvoicePaymentEntry,
  type InvoiceRow,
} from "@/lib/finance-view"
import { formatCents } from "@/lib/format"

type Loaded = { detail: InvoiceDetail | null }

/**
 * What the Finance role's drawer adds to the client's invoice (ui-guidelines C45, staff variant):
 * the client in the facts, its own actions around Download PDF, payments that open in the drawer
 * and a compact history. Everything else is the client's drawer as is.
 */
export type InvoiceStaffSlots = {
  clientName: string
  /** Header actions before Download PDF (Mark as paid). */
  leadingActions?: ReactNode
  /** Header actions after Download PDF (the "More actions" menu). */
  trailingActions?: ReactNode
  /** Swaps the drawer to one of the invoice's payments; `paymentIds` are all of them, newest first. */
  onOpenPayment: (paymentId: string, paymentIds: string[]) => void
  paymentHref?: (paymentId: string) => string
}

export type InvoicePanelProps = {
  /** The invoice shown; the header and the facts come from it at once, the lines load. */
  row: InvoiceRow
  /** Must be referentially stable (a module-level function or a server action). */
  loadDetail: (invoiceId: string) => Promise<InvoiceDetail | null>
  pdfHref: (invoiceId: string) => string
  /** Whether the viewer can pay at all (a saved method is on file); Pay shows only when true. */
  canPay: boolean
  onPay: (row: InvoiceRow) => void
  stepper?: DrawerStepperProps
  back?: DrawerHeaderProps["back"]
  staff?: InvoiceStaffSlots
}

/**
 * One invoice inside a `DrawerShell` (docs/client-finance.md §2a): number and status, what kind of
 * invoice it is, Pay (only while payable and the viewer can pay) and Download PDF in the fixed
 * header; then the facts, the lines grouped with their subtotals, the total and amount due, and
 * the payment history when there is one. The lines load behind a skeleton; a failed load says the
 * total and that the breakdown is missing, with Try again, so lines are never silently missing.
 * Render it keyed by the invoice id so each invoice starts loading afresh.
 */
export function InvoicePanel({ row, loadDetail, pdfHref, canPay, onPay, stepper, back, staff }: InvoicePanelProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadDetail(row.id)
      .then((detail) => !cancelled && setLoaded({ detail }))
      .catch(() => !cancelled && setLoaded({ detail: null }))
    return () => {
      cancelled = true
    }
  }, [row.id, loadDetail, attempt])

  function retry() {
    setLoaded(null)
    setAttempt((n) => n + 1)
  }

  const detail = loaded?.detail ?? null
  const shown: InvoiceRow = detail ?? row

  return (
    <>
      <DrawerHeader
        stepper={stepper}
        back={back}
        title={shown.number}
        titleTestId="drawer-number"
        status={<InvoiceStatusBadge status={shown.displayStatus} labels={staff ? STAFF_INVOICE_STATUS_LABEL : undefined} />}
        subtitle={`${INVOICE_KIND_LABEL[shown.kind]} invoice`}
        actions={
          <>
            {canPay && isPayableRow(shown) ? (
              <Button onClick={() => onPay(shown)} data-testid="drawer-pay">
                Pay {formatCents(shown.totalCents)}
              </Button>
            ) : null}
            {staff?.leadingActions}
            <DrawerIconAction
              href={pdfHref(shown.id)}
              download
              label="Download PDF"
              icon={<Download />}
              testId="drawer-pdf"
            />
            {staff?.trailingActions}
          </>
        }
      />
      <DrawerBody>
        <Facts row={shown} detail={detail} clientName={staff?.clientName} />
        {detail ? (
          <>
            <Lines detail={detail} />
            {detail.payments.length > 0 ? (
              <Payments
                payments={detail.payments}
                title={staff ? "Payments on this invoice" : "Payments"}
                onOpen={staff?.onOpenPayment}
                href={staff?.paymentHref}
              />
            ) : null}
            {staff ? <History detail={detail} /> : null}
          </>
        ) : loaded ? (
          <DrawerLoadError title="The line items could not be loaded" onRetry={retry} testId="drawer-unavailable">
            <p>The invoice total is {formatCents(shown.totalCents)}, but its breakdown is missing. Nothing has been changed.</p>
          </DrawerLoadError>
        ) : (
          <div className="flex flex-col gap-3" aria-busy data-testid="drawer-loading">
            <Skeleton className="h-3 w-24" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex justify-between gap-6">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        )}
      </DrawerBody>
    </>
  )
}

export type InvoiceDrawerProps = Omit<InvoicePanelProps, "row" | "stepper" | "back"> & {
  /** The invoice to show; `null` closes the drawer. */
  row: InvoiceRow | null
  /** The invoice's place in the list it was opened from; omitted (or a list of one) shows no stepper. */
  stepper?: DrawerStepperProps
  onClose: () => void
}

/** The invoice drawer on its own, for a list of invoices (the person Payments tab). */
export function InvoiceDrawer({ row, onClose, ...panel }: InvoiceDrawerProps) {
  return (
    <DrawerShell open={row !== null} onClose={onClose} data-testid="invoice-drawer">
      {row ? <InvoicePanel key={row.id} row={row} {...panel} /> : null}
    </DrawerShell>
  )
}

/** Who, when and how much is owed, as one compact block. Overdue is already said by the header badge. */
function Facts({ row, detail, clientName }: { row: InvoiceRow; detail: InvoiceDetail | null; clientName?: string }) {
  const name = detail?.person.name ?? row.personName
  const title = detail?.person.title ?? row.personTitle
  const proration = invoiceRowProration(row)
  return (
    <DrawerFacts data-testid="drawer-facts">
      {clientName ? (
        <Fact label="Client" testId="drawer-client">
          {clientName}
        </Fact>
      ) : null}
      <Fact label="For" testId="drawer-person">
        <span>{name}</span>
        {title ? <span className="text-muted-foreground"> · {title}</span> : null}
      </Fact>
      <Fact label="Service period" testId="drawer-period">
        <span className="tabular-nums">{invoicePeriodLabel(row)}</span>
        {proration ? <span className="block text-xs text-muted-foreground">{proration}</span> : null}
      </Fact>
      {row.payDate ? (
        <Fact label="Pay date">
          <span className="tabular-nums">{formatIsoDay(row.payDate)}</span>
        </Fact>
      ) : null}
      {clientName ? (
        <Fact label="Issued" testId="drawer-issued">
          <span className="tabular-nums">{formatIsoDay(row.issueDate)}</span>
        </Fact>
      ) : null}
      <Fact label="Due" testId="drawer-due-date">
        <span className="tabular-nums">{formatIsoDay(row.dueDate)}</span>
      </Fact>
      {row.paidDate ? (
        <Fact label="Paid" testId="drawer-paid-date">
          <span className="tabular-nums">{formatIsoDay(row.paidDate)}</span>
        </Fact>
      ) : null}
      {detail?.voidReason ? (
        <Fact label="Void" testId="drawer-void-reason">
          {detail.voidReason}
        </Fact>
      ) : null}
    </DrawerFacts>
  )
}

/**
 * Every stored line as its own row under its group's subhead, then the total and what is still
 * due. A group shows its subtotal when it has more than one line and is not the invoice's only
 * group (a deposit's subtotal would repeat the total just below it).
 */
function Lines({ detail }: { detail: InvoiceDetail }) {
  const single = detail.groups.length === 1
  return (
    <section aria-label="Line items" className="flex flex-col gap-5" data-testid="drawer-lines">
      {detail.groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-1" data-testid="drawer-group" data-group={group.group}>
          <Subhead
            aside={
              group.lines.length > 1 && !single ? (
                <span className="tabular-nums" data-testid="drawer-subtotal">
                  {formatCents(group.subtotalCents)}
                </span>
              ) : null
            }
          >
            {group.label}
          </Subhead>
          <ul className="flex flex-col">
            {group.lines.map((line) => (
              <li key={line.code} className="flex items-start justify-between gap-4 py-1.5 text-sm" data-testid="drawer-line" data-code={line.code}>
                <div className="flex min-w-0 flex-col">
                  <span>{line.title}</span>
                  {line.basis ? <span className="text-xs text-muted-foreground">{line.basis}</span> : null}
                </div>
                <span className="shrink-0 tabular-nums" data-testid="drawer-line-amount">
                  {formatCents(line.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm" data-testid="drawer-totals">
        <div className="flex items-baseline justify-between gap-4">
          <span className={detail.displayStatus === "paid" ? "font-medium" : "text-muted-foreground"}>Total</span>
          <span className={detail.displayStatus === "paid" ? "font-medium tabular-nums" : "tabular-nums"} data-testid="drawer-total">
            {formatCents(detail.totalCents)}
          </span>
        </div>
        {detail.displayStatus !== "paid" ? (
          <div className="flex items-baseline justify-between gap-4 text-base font-medium">
            <span>{detail.displayStatus === "void" ? "Amount due (void)" : "Amount due"}</span>
            <span className="tabular-nums" data-testid="drawer-due">
              {formatCents(detail.amountDueCents)}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Each payment touching the invoice; with `onOpen` (Finance) a row opens that payment in the drawer. */
function Payments({
  payments,
  title,
  onOpen,
  href,
}: {
  payments: readonly InvoicePaymentEntry[]
  title: string
  onOpen?: (paymentId: string, paymentIds: string[]) => void
  href?: (paymentId: string) => string
}) {
  const ids = payments.map((payment) => payment.paymentId)
  return (
    <section aria-label={title} className="flex flex-col gap-1" data-testid="drawer-payments">
      <Subhead>{title}</Subhead>
      <ul className={cn("flex flex-col", onOpen && "-mx-2")}>
        {payments.map((payment) => {
          const content = (
            <>
              <div className="flex min-w-0 flex-col gap-1">
                <PaymentStatusBadge status={payment.status} className="w-fit" />
                <span className="text-xs text-muted-foreground">
                  {payment.methodLabel} · started {formatIsoDay(payment.initiatedAt)}
                  {payment.status === "settled" && payment.settledAt ? ` · settled ${formatIsoDay(payment.settledAt)}` : ""}
                </span>
                {payment.failureReason ? <span className="text-xs text-muted-foreground">{payment.failureReason}</span> : null}
              </div>
              <MoneyCell cents={payment.amountCents} className="ml-auto shrink-0" />
            </>
          )
          return (
            <li
              key={payment.paymentId}
              className={cn(
                "relative flex items-start justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0",
                onOpen && "px-2 hover:bg-muted/60",
              )}
              data-testid="drawer-payment"
              data-status={payment.status}
              data-payment-id={payment.paymentId}
            >
              {onOpen ? (
                <RowOpener
                  href={href?.(payment.paymentId)}
                  onOpen={() => onOpen(payment.paymentId, ids)}
                  className="flex-1 items-start whitespace-normal"
                  testId="drawer-payment-open"
                >
                  {content}
                </RowOpener>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Finance's compact history: one line per event, oldest first, with its time. */
function History({ detail }: { detail: InvoiceDetail }) {
  const entries = invoiceHistory(detail)
  return (
    <section aria-label="History" className="flex flex-col gap-1" data-testid="drawer-history">
      <Subhead>History</Subhead>
      <ol className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.key} className="flex items-baseline gap-3 py-1 text-sm" data-testid="drawer-history-entry" data-key={entry.key}>
            <span className="w-44 shrink-0 text-xs text-muted-foreground tabular-nums">{entry.at ? formatHistoryWhen(entry.at) : "—"}</span>
            <span className="min-w-0">
              {entry.title}
              {entry.detail ? <span className="text-muted-foreground"> · {entry.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
