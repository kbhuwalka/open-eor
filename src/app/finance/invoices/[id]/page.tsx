import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Download } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { VoidInvoiceButton } from "@/components/finance-portal/invoice-actions"
import { InvoiceHistory } from "@/components/finance-portal/invoice-history"
import { DetailSkeleton } from "@/components/finance-portal/skeletons"
import { InvoiceStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { PageHeader } from "@/components/page-header"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { getDb } from "@/db"
import { formatIsoDay, formatIsoRange } from "@/lib/finance-format"
import { decodeIdParam, invoiceHistory, voidReasonLabel } from "@/lib/finance-portal-view"
import { INVOICE_KIND_LABEL } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { invoiceDetail } from "@/server/billing-queries"

type Params = Promise<{ id: string }>

export default function FinanceInvoicePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Invoice params={params} />
    </Suspense>
  )
}

async function Invoice({ params }: { params: Params }) {
  const [{ id }, user] = await Promise.all([params, requirePortalUser("finance")])
  const invoice = invoiceDetail(getDb(), user, decodeIdParam(id), new Date())
  if (!invoice) notFound()
  const voidable = invoice.displayStatus === "open" || invoice.displayStatus === "overdue"
  const history = invoiceHistory(invoice)

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/finance/invoices"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Invoices
      </Link>
      <PageHeader
        title={invoice.number}
        description={`${INVOICE_KIND_LABEL[invoice.kind]} invoice for ${invoice.personName} · ${invoice.companyName}`}
        actions={
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`/finance/invoices/${encodeURIComponent(invoice.id)}/pdf`} download />}
              data-testid="download-pdf"
            >
              <Download data-icon="inline-start" />
              Download PDF
            </Button>
            {voidable ? (
              <VoidInvoiceButton
                invoiceId={invoice.id}
                number={invoice.number}
                personName={invoice.personName}
                totalCents={invoice.totalCents}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <SummaryCard data-testid="invoice-summary">
            <SummaryRow label="Status">
              <InvoiceStatusBadge status={invoice.displayStatus} />
            </SummaryRow>
            <SummaryRow label="Client">{invoice.companyName}</SummaryRow>
            <SummaryRow label="Person">{invoice.personName}</SummaryRow>
            <SummaryRow label="Issued">{formatIsoDay(invoice.issueDate)}</SummaryRow>
            <SummaryRow label="Due">{formatIsoDay(invoice.dueDate)}</SummaryRow>
            {invoice.periodStart && invoice.periodEnd ? (
              <SummaryRow label="Pay period">{formatIsoRange(invoice.periodStart, invoice.periodEnd)}</SummaryRow>
            ) : null}
            {invoice.payDate ? <SummaryRow label="Pay date">{formatIsoDay(invoice.payDate)}</SummaryRow> : null}
            {invoice.paidDate ? <SummaryRow label="Paid">{formatIsoDay(invoice.paidDate)}</SummaryRow> : null}
            {invoice.displayStatus === "void" ? (
              <SummaryRow label="Void reason">{voidReasonLabel(invoice.voidReason)}</SummaryRow>
            ) : null}
          </SummaryCard>

          <section className="flex flex-col gap-3" aria-labelledby="lines-heading">
            <h3 id="lines-heading" className="text-lg font-medium">
              Line items
            </h3>
            <SummaryCard data-testid="invoice-lines">
              {invoice.lines.map((line) => (
                <SummaryRow
                  key={line.code}
                  label={
                    <span className="flex flex-col">
                      <span>{line.description}</span>
                      <span className="text-xs text-muted-foreground">{line.code}</span>
                    </span>
                  }
                >
                  {formatCents(line.amountCents)}
                </SummaryRow>
              ))}
              <SummaryRow label="Total" strong>
                <span data-testid="invoice-total">{formatCents(invoice.totalCents)}</span>
              </SummaryRow>
            </SummaryCard>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="payments-heading">
            <h3 id="payments-heading" className="text-lg font-medium">
              Payments
            </h3>
            {invoice.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="no-invoice-payments">
                No payments yet.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border text-sm" data-testid="invoice-payments">
                {invoice.payments.map((payment) => (
                  <li key={payment.paymentId} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Link
                        href={`/finance/payments/${encodeURIComponent(payment.paymentId)}`}
                        className="w-fit rounded-sm font-mono text-xs font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {payment.paymentId}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {payment.methodLabel} · started {formatIsoDay(payment.initiatedAt)}
                        {payment.status === "succeeded" && payment.settledAt ? ` · settled ${formatIsoDay(payment.settledAt)}` : ""}
                        {payment.status === "initiated" ? " · awaiting settlement" : ""}
                      </span>
                      {payment.failureReason ? (
                        <span className="text-xs text-status-danger-foreground">Failed: {payment.failureReason}</span>
                      ) : null}
                    </div>
                    <MoneyCell cents={payment.amountCents} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside aria-labelledby="history-heading" className="flex flex-col gap-3">
          <h3 id="history-heading" className="text-lg font-medium">
            Status history
          </h3>
          <InvoiceHistory entries={history} />
        </aside>
      </div>
    </div>
  )
}
