import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { PaymentDetailActions } from "@/components/finance-portal/payment-actions"
import { DetailSkeleton } from "@/components/finance-portal/skeletons"
import { InvoiceStatusBadge, PaymentStatusBadge } from "@/components/finance/invoice-status-badge"
import { MoneyCell } from "@/components/finance/money-cell"
import { PageHeader } from "@/components/page-header"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getDb } from "@/db"
import { formatIsoDay } from "@/lib/finance-format"
import { decodeIdParam } from "@/lib/finance-portal-view"
import { INVOICE_KIND_LABEL } from "@/lib/finance-view"
import { formatCents } from "@/lib/format"
import { paymentDetail } from "@/server/billing-queries"

type Params = Promise<{ id: string }>

const TH = "text-xs font-medium tracking-wide text-muted-foreground uppercase"

export default function FinancePaymentPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Payment params={params} />
    </Suspense>
  )
}

async function Payment({ params }: { params: Params }) {
  const [{ id }, user] = await Promise.all([params, requirePortalUser("finance")])
  const payment = paymentDetail(getDb(), user, decodeIdParam(id), new Date())
  if (!payment) notFound()
  const hasDeposit = payment.invoiceRows.some((row) => row.kind === "deposit")
  const viewStatus = payment.status === "succeeded" ? "settled" : payment.status

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/finance/payments"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to Payments
      </Link>
      <PageHeader
        title={`Payment ${payment.id}`}
        description={`${payment.companyName} · ${formatCents(payment.totalCents)} · started ${formatIsoDay(payment.initiatedAt)}`}
        actions={<PaymentDetailActions payment={payment} />}
      />

      <div className="flex max-w-3xl flex-col gap-8">
        <SummaryCard data-testid="payment-summary">
          <SummaryRow label="Status">
            <PaymentStatusBadge status={viewStatus} />
          </SummaryRow>
          <SummaryRow label="Client">{payment.companyName}</SummaryRow>
          <SummaryRow label="Method">{payment.methodLabel}</SummaryRow>
          <SummaryRow label="Started">{formatIsoDay(payment.initiatedAt)}</SummaryRow>
          {payment.settledAt ? <SummaryRow label="Settled">{formatIsoDay(payment.settledAt)}</SummaryRow> : null}
          {payment.failedAt ? <SummaryRow label="Failed">{formatIsoDay(payment.failedAt)}</SummaryRow> : null}
          {payment.failureReason ? <SummaryRow label="Reason">{payment.failureReason}</SummaryRow> : null}
          <SummaryRow label="Amount" strong>
            {formatCents(payment.totalCents)}
          </SummaryRow>
        </SummaryCard>

        {payment.status === "initiated" ? (
          <p className="text-sm text-muted-foreground" data-testid="settle-note">
            {hasDeposit
              ? "Settling pays the invoices below and completes the deposit's Confirm deposit step, so onboarding can continue. Marking it failed makes the invoices payable again."
              : "Settling pays the invoices below. Marking it failed makes them payable again."}
          </p>
        ) : null}

        <section className="flex flex-col gap-3" aria-labelledby="covered-heading">
          <h3 id="covered-heading" className="text-lg font-medium">
            Invoices covered
          </h3>
          <div className="overflow-hidden rounded-lg border border-border" data-testid="covered-invoices">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={TH}>Invoice</TableHead>
                  <TableHead className={TH}>Person</TableHead>
                  <TableHead className={TH}>Due</TableHead>
                  <TableHead className={`${TH} text-right`}>Amount</TableHead>
                  <TableHead className={TH}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payment.invoiceRows.map((row) => (
                  <TableRow key={row.id} className="relative" data-testid="covered-row">
                    <TableCell>
                      <div className="flex flex-col items-start">
                        <Link
                          href={`/finance/invoices/${encodeURIComponent(row.id)}`}
                          className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                        >
                          {row.number}
                        </Link>
                        <span className="text-xs text-muted-foreground">{INVOICE_KIND_LABEL[row.kind]}</span>
                      </div>
                    </TableCell>
                    <TableCell>{row.personName}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatIsoDay(row.dueDate)}</TableCell>
                    <TableCell>
                      <MoneyCell cents={row.totalCents} className="font-medium" />
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={row.displayStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  )
}
