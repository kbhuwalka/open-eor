/**
 * Business-day arithmetic for start-date notice (domain §9.2). Weekends are
 * skipped; public holidays are out of scope for the demo. Dates are plain
 * calendar days in `YYYY-MM-DD`, so there is no time-zone drift.
 */

import { DomainError } from "./types"

/** A hire must start at least this many business days after the request. */
export const MIN_START_NOTICE_BUSINESS_DAYS = 5

const pad = (n: number) => String(n).padStart(2, "0")

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * `from` plus `n` business days (Mon–Fri). `from` itself is day zero. A negative `n` counts
 * backwards: two business days before a Monday is the previous Thursday.
 */
export function addBusinessDays(from: Date, n: number): Date {
  const result = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const step = n < 0 ? -1 : 1
  let remaining = Math.abs(n)
  while (remaining > 0) {
    result.setDate(result.getDate() + step)
    if (!isWeekend(result)) remaining -= 1
  }
  return result
}

/** Earliest allowed start date (ISO) for a request made at `now`. */
export function earliestStartDate(now: Date): string {
  return toIsoDate(addBusinessDays(now, MIN_START_NOTICE_BUSINESS_DAYS))
}

/** Throws `START_DATE_TOO_SOON` when `startDate` is before the earliest allowed day. */
export function assertStartDateAllowed(startDate: string, now: Date): void {
  const earliest = earliestStartDate(now)
  if (startDate < earliest) {
    throw new DomainError("START_DATE_TOO_SOON", { earliest, startDate })
  }
}
