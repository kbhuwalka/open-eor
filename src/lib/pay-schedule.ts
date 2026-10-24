import { DEFAULT_PAY_CALENDAR, payPeriodByIndex, payPeriodContaining, type PayCalendar } from "@/domain/billing/pay-calendar"

import { payDayOf } from "./payslip-view"

/**
 * The next pay date strictly after today for someone employed from `startDate` (inclusive) until
 * `endDate` (inclusive, `null` = open ended). A new hire's first pay date is the pay date of the
 * period that contains their start date, so it is known as soon as the start date is. Returns
 * `null` when employment has ended before any later period begins.
 */
export function nextPayDateAfter(
  now: Date,
  employment: { startDate: string; endDate: string | null },
  calendar: PayCalendar = DEFAULT_PAY_CALENDAR,
): string | null {
  const today = payDayOf(now)
  const current = payPeriodContaining(today, calendar).index
  // The previous period can still be unpaid early in this one (pay date = end + 5 days).
  const limit = current + 1
  for (let index = Math.max(payPeriodContaining(employment.startDate, calendar).index, current - 1); index <= limit; index += 1) {
    const period = payPeriodByIndex(index, calendar)
    if (employment.endDate !== null && period.start > employment.endDate) return null
    if (period.payDate > today) return period.payDate
  }
  return null
}
