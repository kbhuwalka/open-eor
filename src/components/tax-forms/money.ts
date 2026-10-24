/** Dollars typed by a person ("1,200", "$45.50") to whole cents; "" is 0; anything else is NaN so validators reject it. */
export function dollarsToCents(input: string): number {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "")
  if (cleaned === "") return 0
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  const [whole, fraction = ""] = cleaned.split(".")
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
}

export function centsToDollars(cents: number | undefined): string {
  if (cents === undefined || !Number.isFinite(cents) || cents === 0) return ""
  const whole = Math.trunc(cents / 100)
  const rest = cents % 100
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`
}

/** A whole-number count typed by a person; "" is 0; anything else is NaN so validators reject it. */
export function parseCount(input: string): number {
  const trimmed = input.trim()
  if (trimmed === "") return 0
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}
