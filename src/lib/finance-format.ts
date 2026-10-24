import { businessDayOf } from "@/domain/business-time"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** A `YYYY-MM-DD` day as is; a timestamp as its day in the business time zone (never the UTC date). */
function dayParts(iso: string): string {
  return iso.length > 10 ? businessDayOf(iso) : iso
}

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = dayParts(iso).split("-").map(Number)
  return { y, m, d }
}

/**
 * "Mar 11, 2026" from a `YYYY-MM-DD` day or the day of an ISO timestamp in America/New_York
 * (explicit, so the server and the browser always print the same text). Invoices span years, so the year is always shown.
 */
export function formatIsoDay(iso: string): string {
  const { y, m, d } = parts(iso)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** "Nov 2": a day in a dense row, where the year is clear from the context. */
export function formatIsoShortDay(iso: string): string {
  const { m, d } = parts(iso)
  return `${MONTHS[m - 1]} ${d}`
}

/** "Oct 30" in the year of `today` (a `YYYY-MM-DD` business day), "Jan 4, 2027" in any other year. */
export function formatIsoDayInYear(iso: string, today: string): string {
  return parts(iso).y === parts(today).y ? formatIsoShortDay(iso) : formatIsoDay(iso)
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "2026-10": the month of a day or of a timestamp's business day, sortable as text. */
export function isoMonthKey(iso: string): string {
  return dayParts(iso).slice(0, 7)
}

/** "October 2026" from a day, a timestamp (its business day) or a `YYYY-MM` month key. */
export function formatIsoMonth(iso: string): string {
  const [y, m] = (iso.length === 7 ? iso : dayParts(iso)).split("-").map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/** "Feb 23 – Mar 8, 2026": the year only once when both ends share it. */
export function formatIsoRange(start: string, end: string): string {
  const a = parts(start)
  const b = parts(end)
  const left = `${MONTHS[a.m - 1]} ${a.d}${a.y === b.y ? "" : `, ${a.y}`}`
  return `${left} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`
}
