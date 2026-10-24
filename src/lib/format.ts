import type { WageUnit } from "@/domain/types"

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})

export function formatCents(cents: number): string {
  return usd.format(cents / 100)
}

const UNIT_SUFFIX: Record<WageUnit, string> = { hourly: "hr", monthly: "mo", annual: "yr" }

/** "$65.00 / hr", "$12,500 / mo" or "$150,000 / yr". Whole-dollar amounts drop the cents above hourly. */
export function formatWage(cents: number, unit: WageUnit): string {
  const amount =
    unit === "hourly" ? usd.format(cents / 100) : usd.format(cents / 100).replace(/\.00$/, "")
  return `${amount} / ${UNIT_SUFFIX[unit]}`
}

/** "Oct 25", adding the year when it differs from `now`'s. */
export function formatDay(date: Date, now: Date = new Date()): string {
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

/** "1 day" / "3 days". */
export function formatDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/** Coarse relative time for list views; `now` injected for determinism. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour")
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(days, "day")
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return rtf.format(months, "month")
  return rtf.format(Math.round(months / 12), "year")
}
