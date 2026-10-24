import Link from "next/link"
import { ArrowLeft, Download, Info } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { buttonVariants } from "@/components/ui/button"
import { formatCents } from "@/lib/format"
import { formatPayDay, formatPayPeriod, moneyBreakdown, type PayslipDetail } from "@/lib/payslip-view"

import type { PayHrefs } from "./hrefs"
import { MoneyBreakdown } from "./money-breakdown"
import { PayslipLinesCard } from "./payslip-lines-card"

function minus(cents: number): string {
  return cents > 0 ? `−${formatCents(cents)}` : formatCents(0)
}

/**
 * One pay slip: earnings, pre-tax deductions, itemized taxes and after-tax deductions, each with
 * this-period and year-to-date columns (main column), and the gross-to-net summary, the money
 * breakdown and the deposit account in the right rail (ui-guidelines L3).
 */
export function PayslipDetailView({ detail, hrefs }: { detail: PayslipDetail; hrefs: PayHrefs }) {
  const segments = moneyBreakdown(detail)
  const { totals } = detail
  return (
    <div className="flex flex-col gap-6" data-testid="payslip-detail">
      <Link
        href={hrefs.list}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
        data-testid="back-to-pay"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to Pay
      </Link>

      <PageHeader
        title="Pay slip"
        description={`Pay period ${formatPayPeriod(detail.payPeriodStart, detail.payPeriodEnd)} · Paid ${formatPayDay(detail.payDate)}`}
        actions={
          <a href={hrefs.pdf(detail.id)} download className={buttonVariants()} data-testid="download-pdf">
            <Download data-icon="inline-start" />
            Download PDF
          </a>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-8">
          <PayslipLinesCard
            testId="earnings"
            title="Earnings"
            lines={detail.earnings}
            total={detail.gross}
            totalLabel="Gross pay"
          />
          {detail.preTaxDeductions.length > 0 ? (
            <PayslipLinesCard
              testId="pre-tax"
              title="Pre-tax deductions"
              lines={detail.preTaxDeductions}
              total={totals.preTaxDeductions}
              totalLabel="Total pre-tax deductions"
              footer={{ label: "Taxable wages", amounts: detail.taxableWages }}
            />
          ) : null}
          <PayslipLinesCard
            testId="taxes"
            title="Taxes withheld"
            lines={detail.taxes}
            total={totals.taxes}
            totalLabel="Total taxes"
          />
          {detail.postTaxDeductions.length > 0 ? (
            <PayslipLinesCard
              testId="post-tax"
              title="After-tax deductions"
              lines={detail.postTaxDeductions}
              total={totals.postTaxDeductions}
              totalLabel="Total after-tax deductions"
            />
          ) : null}
        </div>

        <aside className="flex flex-col gap-8" aria-label="Summary">
          <section aria-labelledby="net-heading" className="flex flex-col gap-3" data-testid="net-summary">
            <h3 id="net-heading" className="text-lg font-medium">
              Net pay
            </h3>
            <SummaryCard>
              <SummaryRow label="Gross pay">{formatCents(detail.gross.currentCents)}</SummaryRow>
              {totals.preTaxDeductions.currentCents > 0 ? (
                <SummaryRow label="Pre-tax deductions">{minus(totals.preTaxDeductions.currentCents)}</SummaryRow>
              ) : null}
              <SummaryRow label="Taxes">{minus(totals.taxes.currentCents)}</SummaryRow>
              {totals.postTaxDeductions.currentCents > 0 ? (
                <SummaryRow label="After-tax deductions">{minus(totals.postTaxDeductions.currentCents)}</SummaryRow>
              ) : null}
              <SummaryRow label="Net pay" strong>
                <span data-testid="net-pay">{formatCents(detail.net.currentCents)}</span>
              </SummaryRow>
              {detail.paymentMethod ? (
                <SummaryRow label="Paid to">
                  <span className="text-muted-foreground" data-testid="paid-to">
                    {detail.paymentMethod}
                  </span>
                </SummaryRow>
              ) : null}
            </SummaryCard>
            {detail.notes.map((note) => (
              <p key={note} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {note}
              </p>
            ))}
          </section>

          <MoneyBreakdown segments={segments} grossCents={detail.gross.currentCents} />
        </aside>
      </div>
    </div>
  )
}
