import type { ReactNode } from "react"

import { SummaryCard, SUMMARY_ROW } from "@/components/summary-card"
import { formatCents } from "@/lib/format"
import type { PayslipAmounts, PayslipLineView } from "@/lib/payslip-view"
import { cn } from "@/lib/utils"

const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5.25rem_5.25rem] items-baseline gap-2 px-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:gap-4 sm:px-4"

function Row({
  label,
  detail,
  amounts,
  strong,
  muted,
  testId,
}: {
  label: ReactNode
  detail?: string
  amounts: PayslipAmounts
  strong?: boolean
  muted?: boolean
  testId?: string
}) {
  return (
    <div
      className={cn(SUMMARY_ROW, COLUMNS, "not-first:border-t not-first:border-border", strong && "bg-muted/30 font-medium", muted && "text-muted-foreground")}
      data-testid={testId}
    >
      <span className="flex flex-col">
        <span>{label}</span>
        {detail ? <span className="text-xs font-normal text-muted-foreground">{detail}</span> : null}
      </span>
      <span className="text-right tabular-nums" data-testid="current">
        {formatCents(amounts.currentCents)}
      </span>
      <span className="text-right tabular-nums" data-testid="ytd">
        {formatCents(amounts.ytdCents)}
      </span>
    </div>
  )
}

/**
 * One section of the pay slip in the SummaryCard style: lines with this-period and year-to-date
 * columns, then a total. `footer` rows (e.g. taxable wages) follow the total.
 */
export function PayslipLinesCard({
  title,
  lines,
  total,
  totalLabel,
  footer,
  testId,
}: {
  title: string
  lines: readonly PayslipLineView[]
  total: PayslipAmounts
  totalLabel: string
  footer?: { label: string; amounts: PayslipAmounts }
  testId: string
}) {
  const headingId = `${testId}-heading`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-testid={testId}>
      <h3 id={headingId} className="text-lg font-medium">
        {title}
      </h3>
      <SummaryCard>
        <div
          className={cn(
            SUMMARY_ROW,
            COLUMNS,
            "bg-muted/60 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase",
          )}
        >
          <span>Item</span>
          <span className="text-right">This period</span>
          <span className="text-right">Year to date</span>
        </div>
        {lines.map((line) => (
          <Row key={line.code} label={line.label} detail={line.detail} amounts={line} testId={`line-${line.code}`} />
        ))}
        {lines.length !== 1 || footer ? <Row label={totalLabel} amounts={total} strong testId={`${testId}-total`} /> : null}
        {footer ? <Row label={footer.label} amounts={footer.amounts} muted testId={`${testId}-footer`} /> : null}
      </SummaryCard>
    </section>
  )
}
