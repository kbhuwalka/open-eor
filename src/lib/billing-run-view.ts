/**
 * The Billing run page's figures and sentences (docs/finance-portal.md §2.4): what Run billing
 * would issue as three figures, the preview grouped by client, the button label and the outcome of
 * a run. Pure: the preview comes from `previewBillingRun`, the outcome from `runBillingAction`.
 */
import type { BillingRunSummary } from "@/app/finance/actions"
import type { BillingPreview, PreviewInvoice } from "@/server/billing-preview"

import { formatIsoDay } from "./finance-format"
import { formatCents } from "./format"

type WouldIssue = BillingPreview["wouldIssue"]
type Figure = { count: number; cents: number }

export type BillingRunFigures = { payroll: Figure; deposit: Figure; total: Figure; payslips: number }

export type BillingClientGroup = {
  companyId: string
  companyName: string
  count: number
  totalCents: number
  /** By person, then invoice number. */
  invoices: PreviewInvoice[]
}

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`

function figureOf(invoices: readonly PreviewInvoice[]): Figure {
  return { count: invoices.length, cents: invoices.reduce((total, invoice) => total + invoice.totalCents, 0) }
}

export function runFigures(would: WouldIssue): BillingRunFigures {
  return {
    payroll: figureOf(would.invoices.filter((invoice) => invoice.kind === "payroll")),
    deposit: figureOf(would.invoices.filter((invoice) => invoice.kind === "deposit")),
    total: { count: would.count, cents: would.totalCents },
    payslips: would.payslipCount,
  }
}

/** One group per client, largest total first (then name). */
export function previewByClient(would: WouldIssue): BillingClientGroup[] {
  const groups = new Map<string, BillingClientGroup>()
  for (const invoice of would.invoices) {
    const group = groups.get(invoice.companyId) ?? { companyId: invoice.companyId, companyName: invoice.companyName, count: 0, totalCents: 0, invoices: [] }
    group.count += 1
    group.totalCents += invoice.totalCents
    group.invoices.push(invoice)
    groups.set(invoice.companyId, group)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      invoices: group.invoices.sort((a, b) => a.personName.localeCompare(b.personName) || a.number.localeCompare(b.number)),
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.companyName.localeCompare(b.companyName))
}

/** "Run billing · 14 invoices"; plain "Run billing" when there is nothing to issue (the button is disabled then). */
export function runButtonLabel(count: number): string {
  return count > 0 ? `Run billing · ${plural(count, "invoice")}` : "Run billing"
}

export function nothingToIssue(today: string): string {
  return `Nothing to issue. Everything due as of ${formatIsoDay(today)} is already billed.`
}

export type RunOutcome = { issued: boolean; headline: string; detail: string | null }

/** The result line of a run; a run that issued nothing (it is idempotent) says so. */
export function describeRun(summary: BillingRunSummary): RunOutcome {
  if (summary.invoices === 0) return { issued: false, headline: nothingToIssue(summary.today), detail: null }
  const kinds = [
    ...(summary.payrollInvoices > 0 ? [plural(summary.payrollInvoices, "payroll invoice")] : []),
    ...(summary.depositInvoices > 0 ? [plural(summary.depositInvoices, "deposit invoice")] : []),
  ]
  return {
    issued: true,
    headline: `Issued ${plural(summary.invoices, "invoice")} totalling ${formatCents(summary.totalCents)}`,
    detail: `${kinds.join(" and ")} · ${plural(summary.payslips, "pay slip")} created`,
  }
}
