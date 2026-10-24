/**
 * Employment term (domain §10): a hire is indefinite (no end date) or runs for a fixed term that
 * ends on an inclusive `end_date`. Pure; `now` is injected. Dates are plain calendar days in
 * `YYYY-MM-DD`, so there is no time-zone drift.
 */

import { toIsoDate } from "./business-days"
import { DomainError } from "./types"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day written as `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

function parseIsoDay(value: string): Date {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** Today's local calendar day. */
export function todayIso(now: Date): string {
  return toIsoDate(now)
}

/** `iso` plus `days` calendar days (negative to go back). */
export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDay(iso)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

/**
 * The end date is inclusive, so a fixed-term person is active through it and has ended once the
 * local date is after it. An indefinite term (`null`) never ends.
 */
export function isTermEnded(endDate: string | null | undefined, now: Date): boolean {
  return typeof endDate === "string" && endDate < todayIso(now)
}

/** Throws `END_DATE_BEFORE_START` unless `endDate` is a real day after `startDate`. */
export function assertEndDateAfterStart(startDate: string | null | undefined, endDate: string | null): void {
  if (endDate === null) return
  if (!isIsoDate(endDate) || (startDate && endDate <= startDate)) {
    throw new DomainError("END_DATE_BEFORE_START", { startDate: startDate ?? null, endDate })
  }
}

/** Throws `END_DATE_NOT_FUTURE` unless a new term ends after today. `null` (indefinite) is allowed. */
export function assertEndDateInFuture(endDate: string | null, now: Date): void {
  if (endDate === null) return
  if (!isIsoDate(endDate) || endDate <= todayIso(now)) {
    throw new DomainError("END_DATE_NOT_FUTURE", { endDate, today: todayIso(now) })
  }
}

/** Throws `LAST_DAY_AFTER_END_DATE` when a termination is dated after a fixed term's end. */
export function assertLastDayWithinTerm(effectiveOn: string, endDate: string | null): void {
  if (endDate !== null && effectiveOn > endDate) {
    throw new DomainError("LAST_DAY_AFTER_END_DATE", { effectiveOn, endDate })
  }
}

/** Default last working day for a termination: two weeks out, but never past a fixed term's end. */
export function defaultLastWorkingDay(now: Date, endDate: string | null): string {
  const twoWeeks = addDaysIso(todayIso(now), 14)
  return endDate !== null && endDate < twoWeeks ? endDate : twoWeeks
}
