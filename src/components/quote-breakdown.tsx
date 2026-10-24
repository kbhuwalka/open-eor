"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"

import { perUnitCents } from "@/domain/quote"
import type { Quote, QuoteLine, WageUnit } from "@/domain/types"
import { formatCents } from "@/lib/format"
import { SummaryCard, SummaryRow, SUMMARY_ROW } from "@/components/summary-card"
import { cn } from "@/lib/utils"

const MONTH_DAY = { month: "short", day: "numeric" } as const

/** "Mar 1 – Aug 31", with years only when the term crosses a year boundary. */
function termLabel(term: { startDate: string; endDate: string }): string {
  const start = new Date(`${term.startDate}T00:00:00`)
  const end = new Date(`${term.endDate}T00:00:00`)
  const options = start.getFullYear() === end.getFullYear() ? MONTH_DAY : { ...MONTH_DAY, year: "numeric" as const }
  const fmt = (d: Date) => d.toLocaleDateString("en-US", options)
  return `${fmt(start)} – ${fmt(end)}`
}

const ROW = SUMMARY_ROW

function Plain({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <SummaryRow label={label} strong={strong}>
      {formatCents(cents)}
    </SummaryRow>
  )
}

function Category({
  label,
  cents,
  lines,
  unit,
  testId,
}: {
  label: string
  cents: number
  lines: QuoteLine[]
  unit: WageUnit
  testId: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="not-first:border-t not-first:border-border" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(ROW, "w-full text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}
      >
        <span className="flex items-center gap-1.5">
          {label}
          <ChevronRight
            className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </span>
        <span className="tabular-nums">{formatCents(cents)}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border bg-muted/20 py-3 pr-4 pl-4 text-sm text-muted-foreground">
          {lines.map((l) => (
            <div key={l.code} className="flex items-center justify-between gap-4">
              <span>{l.label}</span>
              <span className="tabular-nums">{formatCents(perUnitCents(l.annualCents, unit))}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Cost summary shared by the hire quote, the cost calculator and the stored request:
 * categories that expand to their lines, and a total, in one column shown per hour, month
 * or year. Amounts are derived from the quote's annual cents, so switching frequency never
 * changes the underlying calculation.
 *
 * `benefits="pending"` is the hire flow: benefits are offered but the worker may decline, so
 * their cost is unknown until enrollment. `"potential"` is the calculator: what they would
 * add if the worker enrolls.
 */
export function QuoteBreakdown({
  quote,
  unit,
  benefits,
  packageLabel,
  deposit,
}: {
  quote: Quote
  unit: WageUnit
  benefits: "pending" | "potential"
  packageLabel: string
  /** Show the deposit due on creating an order: one month of the committed total. */
  deposit?: boolean
}) {
  const per = (annualCents: number) => perUnitCents(annualCents, unit)
  const wage = quote.lines.find((l) => l.group === "wage")
  const fee = quote.lines.find((l) => l.group === "service_fee")
  const statutory = quote.lines.filter((l) => l.group === "statutory")
  const benefitLines = quote.lines.filter((l) => l.group === "benefits")
  const { committed, withBenefits } = quote.totals
  const term = quote.term
  const termName = term ? termLabel(term) : ""
  const depositCents = term ? Math.min(committed.monthlyCents, term.committedCents) : committed.monthlyCents

  return (
    <div className="flex flex-col gap-3" data-testid="quote-table">
      <SummaryCard>
        {wage ? <Plain label="Salary" cents={per(wage.annualCents)} /> : null}
        <Category
          testId="category-statutory"
          label="Statutory employer costs"
          cents={per(quote.totals.statutory.annualCents)}
          lines={statutory}
          unit={unit}
        />
        {fee ? <Plain label={`Service fee (${quote.markupPct}%)`} cents={per(fee.annualCents)} /> : null}
        <Plain label="Total" cents={per(committed.annualCents)} strong />
        {term ? <Plain label={`Total for term (${termName})`} cents={term.committedCents} /> : null}
        {benefits === "potential" ? (
          <>
            <Category
              testId="category-benefits"
              label={`Benefits (${packageLabel})`}
              cents={per(quote.totals.benefits.annualCents)}
              lines={benefitLines}
              unit={unit}
            />
            <Plain label="Total with benefits" cents={per(withBenefits.annualCents)} strong />
            {term ? (
              <Plain label={`Total with benefits for term (${termName})`} cents={term.withBenefitsCents} />
            ) : null}
          </>
        ) : null}
      </SummaryCard>

      {benefits === "pending" ? (
        <SummaryCard data-testid="benefits-pending">
          <SummaryRow label={`Benefits (${packageLabel})`}>
            <span className="text-muted-foreground">Determined after enrollment</span>
          </SummaryRow>
        </SummaryCard>
      ) : null}
      {deposit ? (
        <SummaryCard data-testid="deposit">
          <SummaryRow label="Deposit (one month)" strong>
            {formatCents(depositCents)}
          </SummaryRow>
        </SummaryCard>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {term
          ? `Estimate for the fixed term's biweekly pay periods using ${quote.rateSetId.toUpperCase()} rates, shown as an average over the term.`
          : `Estimate for a year of 26 biweekly pay periods using ${quote.rateSetId.toUpperCase()} rates, shown as an average.`}
        {" Some rates are assumptions, and state paid-leave levies are not included."}
        {benefits === "pending"
          ? " Healthcare and retirement are offered to the employee, who may decline; they are billed only if the employee enrolls."
          : ""}
      </p>
    </div>
  )
}
