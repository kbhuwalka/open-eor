/**
 * The one business day. Northwind bills and pays US employees, so "today", due and overdue,
 * "paid on" and the day a pay slip appears all follow America/New_York, not the server's zone and
 * not UTC (8pm Eastern on the 15th is already the 16th in UTC, and a payment settled then was
 * settled on the 15th). Pure; `now` is injected. Use this for every billing and finance day;
 * `todayIso` (`employment-term.ts`) is the machine-local day and belongs to task due dates only.
 */

export const BUSINESS_TIME_ZONE = "America/New_York"

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** `YYYY-MM-DD` of an instant (a `Date` or an ISO timestamp) in the business time zone. */
export function businessDayOf(instant: Date | string | number): string {
  const date = instant instanceof Date ? instant : new Date(instant)
  return dayFormat.format(date)
}

const hourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
})

/** The hour (0-23) of an instant on the business-day clock. */
export function businessHourOf(instant: Date | string | number): number {
  const date = instant instanceof Date ? instant : new Date(instant)
  return Number(hourFormat.format(date))
}

/** The instant at `hour`:00 on the business day `day` (`YYYY-MM-DD`), whatever the machine's zone. */
export function businessInstant(day: string, hour: number): Date {
  const [y, m, d] = day.split("-").map(Number)
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hour + offsetHours))
    if (businessDayOf(candidate) === day && businessHourOf(candidate) === hour) return candidate
  }
  throw new Error(`No ${hour}:00 on ${day} in ${BUSINESS_TIME_ZONE}`)
}
