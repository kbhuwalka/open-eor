import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { formatCents, formatDay, formatWage } from "@/lib/format"
import { parseDay } from "@/lib/task-view"
import { stateName } from "@/lib/us-states"
import type { CaseOrderView } from "@/server/onboarding-portal/case-detail"

import { StatusPill, type PillTone } from "./status-pill"

const INVOICE_TONE: Record<string, PillTone> = { paid: "success", open: "neutral", processing: "info", overdue: "danger", void: "neutral" }
const KIND_LABEL: Record<string, string> = { deposit: "Deposit", payroll: "Payroll" }
const titleCase = (value: string) => (value.charAt(0).toUpperCase() + value.slice(1)).replace(/_/g, " ")

/** The order as placed: terms from the frozen snapshot, the quote, the deposit and the invoices raised so far. */
export function CaseOrderTab({ order, now }: { order: CaseOrderView; now: Date }) {
  const day = (iso: string | null, fallback: string) => (iso ? formatDay(parseDay(iso), now) : fallback)
  return (
    <div className="flex flex-col gap-8" data-testid="case-order">
      <section className="flex flex-col gap-3" aria-labelledby="terms-heading">
        <h3 id="terms-heading" className="text-base font-semibold">Terms</h3>
        <SummaryCard>
          <SummaryRow label="Work location">{stateName(order.stateCode)}</SummaryRow>
          <SummaryRow label="Pay">{formatWage(order.wageCents, order.wageUnit)}</SummaryRow>
          <SummaryRow label="Benefits package">{order.package}</SummaryRow>
          <SummaryRow label="Start date">{day(order.startDate, "Not set")}</SummaryRow>
          <SummaryRow label="End date">{day(order.endDate, "Indefinite")}</SummaryRow>
        </SummaryCard>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="quote-heading">
        <h3 id="quote-heading" className="text-base font-semibold">Quote</h3>
        {order.quoteTotals ? (
          <SummaryCard data-testid="order-quote">
            {order.quoteLines.map((line) => (
              <SummaryRow key={line.code} label={line.label}>{`${formatCents(line.monthlyCents)} / mo`}</SummaryRow>
            ))}
            <SummaryRow label="Committed monthly cost" strong>{formatCents(order.quoteTotals.committedMonthlyCents)}</SummaryRow>
            <SummaryRow label="With benefits" strong>{formatCents(order.quoteTotals.withBenefitsMonthlyCents)}</SummaryRow>
            <SummaryRow label="Northwind fee">{`${order.quoteTotals.markupPct}% of wage`}</SummaryRow>
          </SummaryCard>
        ) : (
          <p className="text-sm text-muted-foreground">No quote was frozen with this order.</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="money-heading">
        <h3 id="money-heading" className="text-base font-semibold">Deposit and invoices</h3>
        <SummaryCard>
          <SummaryRow label="Deposit">
            {order.deposit.amountCents === null ? order.deposit.label : `${formatCents(order.deposit.amountCents)} · ${order.deposit.label}`}
          </SummaryRow>
        </SummaryCard>
        {order.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-invoices">No invoices yet.</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border text-sm" data-testid="order-invoices">
            {order.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 not-first:border-t not-first:border-border" data-testid="order-invoice">
                <span className="flex flex-col">
                  <span className="font-medium">{invoice.number}</span>
                  <span className="text-xs text-muted-foreground">
                    {KIND_LABEL[invoice.kind] ?? titleCase(invoice.kind)} · due {day(invoice.dueDate, "")}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{formatCents(invoice.totalCents)}</span>
                  <StatusPill tone={INVOICE_TONE[invoice.status] ?? "neutral"}>{titleCase(invoice.status)}</StatusPill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
