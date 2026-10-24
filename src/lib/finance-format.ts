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

/** "Feb 23 – Mar 8, 2026": the year only once when both ends share it. */
export function formatIsoRange(start: string, end: string): string {
  const a = parts(start)
  const b = parts(end)
  const left = `${MONTHS[a.m - 1]} ${a.d}${a.y === b.y ? "" : `, ${a.y}`}`
  return `${left} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`
}
