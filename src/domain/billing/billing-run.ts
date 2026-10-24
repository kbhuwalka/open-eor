/**
 * The billing run: a pure planner that returns the invoices that SHOULD exist and do not yet.
 * It never writes; the caller persists the result. Running it again with those invoices added to
 * `existingInvoices` returns nothing (idempotent), and the same inputs always give the same
 * invoices and numbers (deterministic).
 */

import { buildQuote } from "../quote"
import {
  DECLINED_ELECTIONS,
  type BillingCompany,
  type BillingHire,
  type Invoice,
} from "./types"
import {
  employmentEndDate,
  formatInvoiceNumber,
  generateDepositInvoice,
  generatePayrollInvoice,
  depositInvoiceId,
  nextInvoiceSequence,
  payrollInvoiceId,
} from "./invoice"
import { getRateSet } from "../cost-rates"
import { resolveElection, type ElectionsForHire } from "./elections"
import {
  DEFAULT_PAY_CALENDAR,
  payPeriodByIndex,
  payPeriodContaining,
  type PayCalendar,
} from "./pay-calendar"

export type BillingRunInput = {
  companies: readonly BillingCompany[]
  /** Hires to bill: payroll-ready people, including ones with a last working day. */
  hires: readonly BillingHire[]
  /**
   * Benefit elections by `hireId`: one state for every period, or an election history resolved per
   * pay period (`resolveElection`). A hire without an entry, or with no election in force for a
   * period, is billed as not enrolled.
   */
  elections: Readonly<Record<string, ElectionsForHire>>
  existingInvoices: readonly Invoice[]
  /** The day the run is for (ISO). Invoices whose issue date is after it are not generated yet. */
  today: string
  payCalendar?: PayCalendar
}

/**
 * Year-to-date gross pay for a person: the salary lines of their earlier, non-void payroll
 * invoices in the same tax year. This is the only source of year-to-date wages invoicing uses.
 */
export function ytdWageFromInvoices(
  invoices: readonly Invoice[],
  hireId: string,
  taxYear: number,
  beforePeriodIndex: number,
): number {
  let total = 0
  for (const invoice of invoices) {
    if (invoice.kind !== "payroll" || invoice.status === "void" || invoice.hireId !== hireId) continue
    const period = invoice.period
    if (!period || period.taxYear !== taxYear || period.index >= beforePeriodIndex) continue
    for (const line of invoice.lines) {
      if (line.code === "SALARY") total += line.amountCents
    }
  }
  return total
}

/** What a person deferred to the 401(k) on earlier payroll invoices of the same tax year (the `deferralCents` the lines were charged with). */
export function ytdDeferralFromInvoices(
  invoices: readonly Invoice[],
  hireId: string,
  taxYear: number,
  beforePeriodIndex: number,
): number {
  let total = 0
  for (const invoice of invoices) {
    if (invoice.kind !== "payroll" || invoice.status === "void" || invoice.hireId !== hireId) continue
    const period = invoice.period
    if (!period || period.taxYear !== taxYear || period.index >= beforePeriodIndex) continue
    for (const line of invoice.lines) {
      const deferred = line.code === "RETIREMENT" ? line.inputs.deferralCents : undefined
      if (typeof deferred === "number") total += deferred
    }
  }
  return total
}

type Planned = {
  hire: BillingHire
  kind: "deposit" | "payroll"
  periodIndex: number
  issueDate: string
}

/**
 * The invoices due as of `today`:
 *
 * - one deposit per hire, issued on `hiredOn`;
 * - one payroll invoice per active person per pay period, from the period holding their start
 *   date until the period holding their last employed day (term end or last working day), or
 *   until the latest period whose issue date has come. The first and last periods are prorated
 *   by days employed;
 * - only those whose issue date is on or before `today`, and not already in `existingInvoices`
 *   (matched by invoice id, void ones included).
 *
 * Hires of a company that is not in `companies` are skipped. Invoice numbers continue each
 * issue year's sequence after the highest existing number.
 */
export function billingRun(input: BillingRunInput): Invoice[] {
  const calendar = input.payCalendar ?? DEFAULT_PAY_CALENDAR
  const companyIds = new Set(input.companies.map((company) => company.id))
  const existingIds = new Set(input.existingInvoices.map((invoice) => invoice.id))

  const planned: Planned[] = []
  for (const hire of input.hires) {
    if (!companyIds.has(hire.companyId)) continue
    if (hire.hiredOn <= input.today && !existingIds.has(depositInvoiceId(hire.hireId))) {
      planned.push({ hire, kind: "deposit", periodIndex: -1, issueDate: hire.hiredOn })
    }
    const end = employmentEndDate(hire)
    if (end !== null && end < hire.startDate) continue
    for (let index = payPeriodContaining(hire.startDate, calendar).index; ; index++) {
      const period = payPeriodByIndex(index, calendar)
      if (period.issueDate > input.today || (end !== null && period.start > end)) break
      if (existingIds.has(payrollInvoiceId(hire.hireId, index))) continue
      planned.push({ hire, kind: "payroll", periodIndex: index, issueDate: period.issueDate })
    }
  }

  planned.sort(
    (a, b) =>
      a.issueDate.localeCompare(b.issueDate) ||
      a.hire.companyId.localeCompare(b.hire.companyId) ||
      a.hire.hireId.localeCompare(b.hire.hireId) ||
      a.periodIndex - b.periodIndex,
  )

  const all: Invoice[] = [...input.existingInvoices]
  const generated: Invoice[] = []
  const nextSequence = new Map<number, number>()
  const numberFor = (issueDate: string): string => {
    const year = Number(issueDate.slice(0, 4))
    const sequence = nextSequence.get(year) ?? nextInvoiceSequence(
      input.existingInvoices.map((invoice) => invoice.number),
      year,
    )
    nextSequence.set(year, sequence + 1)
    return formatInvoiceNumber(year, sequence)
  }

  for (const item of planned) {
    const { hire } = item
    const company = { id: hire.companyId }
    const number = numberFor(item.issueDate)
    let invoice: Invoice
    if (item.kind === "deposit") {
      const quote =
        hire.quote ??
        buildQuote({
          wageCents: hire.wageCents,
          wageUnit: hire.wageUnit,
          stateCode: hire.stateCode,
          package: hire.package,
          markupPct: hire.markupPct,
          rates: getRateSet(hire.rateSetId) ?? undefined,
          payCalendar: calendar,
          ...(hire.termEndDate ? { term: { startDate: hire.startDate, endDate: hire.termEndDate } } : {}),
        })
      invoice = generateDepositInvoice({ company, hireId: hire.hireId, quote, issueDate: item.issueDate, payCalendar: calendar, number })
    } else {
      const period = payPeriodByIndex(item.periodIndex, calendar)
      invoice = generatePayrollInvoice({
        company,
        hire,
        period,
        ytdWageCents: ytdWageFromInvoices(all, hire.hireId, period.taxYear, period.index),
        ytdDeferralCents: ytdDeferralFromInvoices(all, hire.hireId, period.taxYear, period.index),
        payCalendar: calendar,
        elections: resolveElection(input.elections[hire.hireId] ?? DECLINED_ELECTIONS, period) ?? DECLINED_ELECTIONS,
        number,
      })
    }
    all.push(invoice)
    generated.push(invoice)
  }
  return generated
}
