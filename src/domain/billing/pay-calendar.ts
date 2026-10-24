/**
 * The pay calendar as data, and the pure functions that read it. Employees are paid biweekly:
 * a fixed 14-day period, a pay date a fixed number of days after the period ends, and an
 * invoice issued and due ahead of the pay date. Dates are plain `YYYY-MM-DD` days.
 *
 * Nothing here knows about rates or invoices, so the quote (`../quote`) and invoicing both
 * import it without a cycle.
 */

import { addBusinessDays, toIsoDate } from "../business-days"
import { addDaysIso, isIsoDate } from "../employment-term"
import { HOURS_PER_YEAR } from "../wage"

export type PayCalendar = {
  /** Stored on every invoice so a bill names the calendar it was cut from. */
  id: string
  /** First day of any one pay period; every other period is a whole number of periods away. */
  anchorPeriodStart: string
  periodDays: number
  /** Pay date = last day of the period + this many calendar days. */
  payDateOffsetDays: number
  /** Invoice issue date = pay date + this many calendar days (negative: before). */
  invoiceIssueOffsetDays: number
  /** Invoice due date = pay date + this many business days (negative: before). */
  invoiceDueOffsetBusinessDays: number
  /** A deposit invoice is due this many business days after it is issued. */
  depositDueOffsetBusinessDays: number
}

/**
 * Biweekly, Monday to Sunday, paid on the Friday after the period closes (end + 5 days).
 * The anchor is chosen so 2026 has 26 pay dates (first: Fri Jan 2) and 2027 has 27 (first:
 * Fri Jan 1, last: Fri Dec 31).
 */
export const DEFAULT_PAY_CALENDAR: PayCalendar = {
  id: "us-biweekly-v1",
  anchorPeriodStart: "2025-12-15",
  periodDays: 14,
  payDateOffsetDays: 5,
  invoiceIssueOffsetDays: -7,
  invoiceDueOffsetBusinessDays: -2,
  depositDueOffsetBusinessDays: 5,
}

export type PayPeriod = {
  /** Whole periods since the anchor period (0), negative before it. The period's identity. */
  index: number
  /** First and last day of the period; both inclusive. */
  start: string
  end: string
  payDate: string
  issueDate: string
  dueDate: string
  /** The year of the pay date: wages are taxed in the year they are paid. */
  taxYear: number
  /** Position of this pay date among the pay dates of `taxYear`, from 0. */
  indexInTaxYear: number
}

const DAY_MS = 86_400_000

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS)
}

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b)
}

function assertCalendar(calendar: PayCalendar): void {
  if (!isIsoDate(calendar.anchorPeriodStart) || !Number.isInteger(calendar.periodDays) || calendar.periodDays < 1) {
    throw new RangeError(`Invalid pay calendar ${calendar.id}`)
  }
}

/** Pay periods in a year: whole periods that fit in 365 days (26 for a 14-day period). */
export function periodsPerYear(calendar: PayCalendar = DEFAULT_PAY_CALENDAR): number {
  return Math.floor(365 / calendar.periodDays)
}

/** Hours an hourly employee is paid for in a full period: 2,080 ÷ 26 = 80 for biweekly. */
export function hoursPerPeriod(calendar: PayCalendar = DEFAULT_PAY_CALENDAR): number {
  return HOURS_PER_YEAR / periodsPerYear(calendar)
}

function payDateOfIndex(index: number, calendar: PayCalendar): string {
  return addDaysIso(
    calendar.anchorPeriodStart,
    index * calendar.periodDays + calendar.periodDays - 1 + calendar.payDateOffsetDays,
  )
}

/** Index of the first period whose pay date is on or after `iso`. */
function firstIndexPaidOnOrAfter(iso: string, calendar: PayCalendar): number {
  const payOffsetFromStart = calendar.periodDays - 1 + calendar.payDateOffsetDays
  const days = diffDays(calendar.anchorPeriodStart, iso) - payOffsetFromStart
  // `+ 0` turns -0 (the ceiling of a small negative fraction) into 0.
  return Math.ceil(days / calendar.periodDays) + 0
}

/** The period with this index. */
export function payPeriodByIndex(index: number, calendar: PayCalendar = DEFAULT_PAY_CALENDAR): PayPeriod {
  assertCalendar(calendar)
  const start = addDaysIso(calendar.anchorPeriodStart, index * calendar.periodDays)
  const end = addDaysIso(start, calendar.periodDays - 1)
  const payDate = payDateOfIndex(index, calendar)
  const taxYear = Number(payDate.slice(0, 4))
  return {
    index,
    start,
    end,
    payDate,
    issueDate: addDaysIso(payDate, calendar.invoiceIssueOffsetDays),
    dueDate: toIsoDate(addBusinessDays(localDate(payDate), calendar.invoiceDueOffsetBusinessDays)),
    taxYear,
    indexInTaxYear: index - firstIndexPaidOnOrAfter(`${taxYear}-01-01`, calendar),
  }
}

/** The period that contains `date`. */
export function payPeriodContaining(date: string, calendar: PayCalendar = DEFAULT_PAY_CALENDAR): PayPeriod {
  assertCalendar(calendar)
  return payPeriodByIndex(floorDiv(diffDays(calendar.anchorPeriodStart, date), calendar.periodDays), calendar)
}

/** Every period that has at least one day in `[start, end]` (both inclusive), oldest first. */
export function payPeriodsBetween(
  start: string,
  end: string,
  calendar: PayCalendar = DEFAULT_PAY_CALENDAR,
): PayPeriod[] {
  if (end < start) return []
  const first = payPeriodContaining(start, calendar).index
  const last = payPeriodContaining(end, calendar).index
  const periods: PayPeriod[] = []
  for (let index = first; index <= last; index++) periods.push(payPeriodByIndex(index, calendar))
  return periods
}

/**
 * The periods paid in calendar `year`, oldest first. The tax year of wages is the year of the pay
 * date, so a period that ends in December and is paid in January belongs to the next year. A year
 * has 26 pay dates, or 27 when the first falls early enough in January.
 */
export function periodsForTaxYear(year: number, calendar: PayCalendar = DEFAULT_PAY_CALENDAR): PayPeriod[] {
  assertCalendar(calendar)
  const first = firstIndexPaidOnOrAfter(`${year}-01-01`, calendar)
  const next = firstIndexPaidOnOrAfter(`${year + 1}-01-01`, calendar)
  const periods: PayPeriod[] = []
  for (let index = first; index < next; index++) periods.push(payPeriodByIndex(index, calendar))
  return periods
}

/**
 * Calendar days of `period` on which someone employed over `[startDate, endDate]` (inclusive;
 * `null` = no end) is employed. A full period is `calendar.periodDays`, and a partial first or
 * last period is paid in proportion: days employed ÷ `periodDays`.
 */
export function daysEmployedInPeriod(period: PayPeriod, startDate: string, endDate: string | null): number {
  const from = startDate > period.start ? startDate : period.start
  const to = endDate !== null && endDate < period.end ? endDate : period.end
  return Math.max(0, diffDays(from, to) + 1)
}

/**
 * Gross pay for one FULL pay period given the annual wage: annual ÷ periods per year. Hourly
 * pay is 80 hours of the hourly rate, because annualised hourly pay is rate × 2,080.
 *
 * The division is spread by cumulative rounding over the periods of a tax year
 * (`floor((n+1) × annual / 26) − floor(n × annual / 26)` for the n-th pay date of the year), so
 * the periods differ by at most a cent and the first 26 pay dates of any tax year sum to the
 * annual wage exactly. A 27th pay date repeats the first period's amount.
 */
export function scheduledGrossCents(
  annualWageCents: number,
  indexInTaxYear: number,
  perYear: number = periodsPerYear(),
): number {
  const position = ((indexInTaxYear % perYear) + perYear) % perYear
  return Math.floor(((position + 1) * annualWageCents) / perYear) - Math.floor((position * annualWageCents) / perYear)
}
