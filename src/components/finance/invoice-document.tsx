import type { ReactNode } from "react"
import { cn } from "cn"

import { InvoiceStatusBadge, PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import type { InvoiceDetail } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { DEPOSIT_NOTE, invoiceAmountSummary } from "@/lib/invoice-lines"

export type InvoiceDocumentProps = {
  invoice: InvoiceDetail
  /**
   * Buttons shown above the paper (Download PDF, Pay, a Finance action). They are left out of a
   * printout, so the page prints as the document alone.
   */
  actions?: ReactNode
  className?: string
}

const LABEL = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums" data-testid={testId}>
        {children}
      </dd>
    </div>
  )
}

/**
 * One invoice laid out as a document: issuer and bill-to, who it is for, the service period, the
 * amount due, line items grouped with their basis and subtotals, payments and notes. Presentational
 * and server-renderable: it takes one `InvoiceDetail` (from `loadInvoiceDocument` or
 * `toInvoiceDetail`) and prints exactly what is in it, so the figures are the stored ones. The
 * client page and the Finance portal both render it; they differ only in `actions`.
 */
export function InvoiceDocument({ invoice, actions, className }: InvoiceDocumentProps) {
  const { person, period, client, issuer } = invoice
  const isVoid = invoice.displayStatus === "void"
  const summary = invoiceAmountSummary({
    status: invoice.displayStatus,
    totalCents: invoice.totalCents,
    paidCents: invoice.paidCents,
    inProgressCents: invoice.inProgressCents,
    dueDate: invoice.dueDate,
    paidDate: invoice.paidDate ?? null,
    voidReason: invoice.voidReason,
  })
  const multiColumn = invoice.groups.some((group) => group.lines.some((line) => line.quantity || line.rate))

  return (
    <article
      aria-label={`Invoice ${invoice.number}`}
      className={cn("flex flex-col gap-4", className)}
      data-testid="invoice-document"
      data-status={invoice.displayStatus}
      data-kind={invoice.kind}
    >
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 print:hidden" data-testid="invoice-actions">
          {actions}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card text-sm print:rounded-none print:border-0">
        <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 p-4 sm:p-8">
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold tracking-tight" data-testid="invoice-issuer">
              {issuer.name}
            </p>
            {issuer.addressLines.map((line) => (
              <p key={line} className="text-xs text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <h2 className="text-2xl font-semibold tracking-tight">Invoice</h2>
            <p className="font-mono text-xs text-muted-foreground" data-testid="invoice-number">
              {invoice.number}
            </p>
            <InvoiceStatusBadge status={invoice.displayStatus} />
          </div>
        </header>

        <section
          aria-label={summary.label}
          className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-y border-border bg-muted/40 px-4 py-5 sm:px-8"
          data-testid="invoice-amount"
        >
          <div className="flex flex-col gap-1">
            <span className={LABEL}>{summary.label}</span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums" data-testid="invoice-amount-due">
              {formatCents(summary.amountCents)}
            </span>
          </div>
          <p
            className={cn("text-sm font-medium", invoice.displayStatus === "overdue" && "text-status-danger-foreground")}
            data-testid="invoice-amount-note"
          >
            {summary.note}
          </p>
        </section>

        <div className="grid gap-6 p-4 sm:p-8 md:grid-cols-3">
          <section className="flex flex-col gap-1" aria-label="Bill to" data-testid="invoice-bill-to">
            <h3 className={LABEL}>Bill to</h3>
            <p className="font-medium">{client.name}</p>
            {client.addressLines.map((line) => (
              <p key={line} className="text-muted-foreground">
                {line}
              </p>
            ))}
          </section>

          <section className="flex flex-col gap-1" aria-label="For" data-testid="invoice-for">
            <h3 className={LABEL}>For</h3>
            <p className="font-medium" data-testid="invoice-person-name">
              {person.name}
            </p>
            {person.title ? <p className="text-muted-foreground">{person.title}</p> : null}
            {person.workState ? <p className="text-muted-foreground">Work location: {person.workState}</p> : null}
            {person.endDate ? (
              <p className="text-muted-foreground">
                {person.endKind === "terminated" ? "Last day worked" : "Fixed term ends"}: {formatIsoDay(person.endDate)}
              </p>
            ) : null}
            {period?.prorationNote ? (
              <p className="font-medium" data-testid="invoice-proration">
                {period.prorationNote}
              </p>
            ) : null}
          </section>

          <dl className="flex flex-col gap-1.5" aria-label="Invoice details">
            <Fact label="Issue date">{formatIsoDay(invoice.issueDate)}</Fact>
            <Fact label="Due date" testId="invoice-due-date">
              {formatIsoDay(invoice.dueDate)}
            </Fact>
            {period ? (
              <>
                <Fact label="Service period" testId="invoice-period">
                  {formatIsoRange(period.start, period.end)}
                </Fact>
                <Fact label="Pay date">{formatIsoDay(period.payDate)}</Fact>
                <Fact label="Tax year">{period.taxYear}</Fact>
              </>
            ) : (
              <Fact label="Service period" testId="invoice-period">
                None (security deposit)
              </Fact>
            )}
          </dl>
        </div>

        <section aria-label="Line items" className="border-t border-border" data-testid="invoice-lines">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="border-b border-border text-left">
                <th scope="col" className={cn(LABEL, "h-10 px-4 font-medium sm:px-8")}>
                  Description
                </th>
                {multiColumn ? (
                  <>
                    <th scope="col" className={cn(LABEL, "hidden h-10 px-3 text-right font-medium sm:table-cell")}>
                      Quantity
                    </th>
                    <th scope="col" className={cn(LABEL, "hidden h-10 px-3 text-right font-medium sm:table-cell")}>
                      Rate
                    </th>
                  </>
                ) : null}
                <th scope="col" className={cn(LABEL, "h-10 px-4 text-right font-medium sm:px-8")}>
                  Amount
                </th>
              </tr>
            </thead>
            {invoice.groups.map((group) => (
              <tbody key={group.group} data-testid="invoice-group" data-group={group.group} className="break-inside-avoid">
                <tr className="border-b border-border">
                  <th scope="rowgroup" colSpan={2} className={cn("px-4 pt-4 pb-2 text-left text-sm font-medium sm:px-8", multiColumn && "sm:hidden")}>
                    {group.label}
                  </th>
                  {multiColumn ? (
                    <th scope="rowgroup" colSpan={4} className="hidden px-4 pt-4 pb-2 text-left text-sm font-medium sm:table-cell sm:px-8">
                      {group.label}
                    </th>
                  ) : null}
                </tr>
                {group.lines.map((line) => (
                  <tr key={line.code} className="border-b border-border/60 align-top" data-testid="invoice-line" data-code={line.code}>
                    <td className="px-4 py-3 sm:px-8">
                      <p>{line.title}</p>
                      {line.basis ? (
                        <p className="mt-0.5 text-xs text-muted-foreground" data-testid="invoice-line-basis">
                          {line.basis}
                        </p>
                      ) : null}
                    </td>
                    {multiColumn ? (
                      <>
                        <td className="hidden px-3 py-3 text-right whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">{line.quantity}</td>
                        <td className="hidden px-3 py-3 text-right whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">{line.rate}</td>
                      </>
                    ) : null}
                    <td className="px-4 py-3 text-right tabular-nums sm:px-8" data-testid="invoice-line-amount">
                      {formatCents(line.amountCents)}
                    </td>
                  </tr>
                ))}
                {group.lines.length > 1 ? (
                  <tr className="border-b border-border" data-testid="invoice-group-subtotal">
                    <td className={cn("px-4 py-2 text-right text-muted-foreground sm:px-8", multiColumn && "sm:hidden")}>
                      {group.label} subtotal
                    </td>
                    {multiColumn ? (
                      <td colSpan={3} className="hidden px-4 py-2 text-right text-muted-foreground sm:table-cell sm:px-8">
                        {group.label} subtotal
                      </td>
                    ) : null}
                    <td className="px-4 py-2 text-right font-medium tabular-nums sm:px-8">{formatCents(group.subtotalCents)}</td>
                  </tr>
                ) : null}
              </tbody>
            ))}
          </table>

          <dl className="ml-auto flex w-full flex-col gap-2 px-4 py-5 sm:w-96 sm:px-8 print:break-inside-avoid" data-testid="invoice-totals">
            <div className="flex items-baseline justify-between gap-4 text-base font-medium">
              <dt>Total</dt>
              <dd className="tabular-nums" data-testid="invoice-total">
                {formatCents(invoice.totalCents)}
              </dd>
            </div>
            {invoice.paidCents > 0 ? (
              <div className="flex items-baseline justify-between gap-4 text-muted-foreground">
                <dt>Payments received</dt>
                <dd className="tabular-nums">−{formatCents(invoice.paidCents)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 text-base font-medium">
              <dt>{isVoid ? "Amount due (void)" : "Amount due"}</dt>
              <dd className="tabular-nums" data-testid="invoice-balance">
                {formatCents(invoice.amountDueCents)}
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-label="Payments"
          className="flex flex-col gap-3 border-t border-border p-4 sm:p-8 print:break-inside-avoid"
          data-testid="invoice-payments"
        >
          <h3 className="text-base font-medium">Payments</h3>
          {invoice.payments.length === 0 ? (
            <p className="text-muted-foreground" data-testid="invoice-no-payments">
              {isVoid ? "This invoice is void, so no payment is expected." : "No payments yet."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {invoice.payments.map((payment) => (
                <li
                  key={payment.paymentId}
                  className="flex items-start justify-between gap-4 px-4 py-3"
                  data-testid="invoice-payment"
                  data-status={payment.status}
                >
                  <div className="flex flex-col gap-1">
                    <PaymentStatusBadge status={payment.status} className="w-fit" />
                    <span className="text-xs text-muted-foreground">
                      {payment.methodLabel} · started {formatIsoDay(payment.initiatedAt)}
                      {payment.settledAt && payment.status === "settled" ? ` · settled ${formatIsoDay(payment.settledAt)}` : ""}
                    </span>
                    {payment.failureReason ? (
                      <span className="text-xs text-status-danger-foreground">Reason: {payment.failureReason}</span>
                    ) : null}
                  </div>
                  <span className={cn("shrink-0 tabular-nums", payment.status === "failed" && "text-muted-foreground")}>
                    {formatCents(payment.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="flex flex-col gap-2 border-t border-border bg-muted/30 p-4 text-xs text-muted-foreground sm:p-8 print:break-inside-avoid" data-testid="invoice-notes">
          {isVoid ? (
            <p data-testid="invoice-void-reason">
              This invoice was voided: {invoice.voidReason}. No payment is due and it should not be paid.
            </p>
          ) : invoice.displayStatus === "paid" ? (
            <p>Thank you. This invoice is paid in full and no further payment is due.</p>
          ) : invoice.displayStatus === "processing" ? (
            <p>A payment for this invoice is processing. No further action is needed unless it fails.</p>
          ) : null}
          {invoice.kind === "deposit" ? <p data-testid="invoice-deposit-note">{DEPOSIT_NOTE}</p> : null}
          <p>
            Payable to {issuer.name}
            {issuer.addressLines.length > 0 ? `, ${issuer.addressLines.join(", ")}` : ""}. Amounts are in US dollars.
          </p>
        </footer>
      </div>
    </article>
  )
}

/** Same shape as the document, for the Suspense fallback (L2a). */
export function InvoiceDocumentSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy data-testid="invoice-skeleton">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex justify-between gap-8 p-4 sm:p-8">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-20 w-full rounded-none" />
        <div className="grid gap-6 p-4 sm:p-8 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4 border-t border-border p-4 sm:p-8">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex justify-between gap-6">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
