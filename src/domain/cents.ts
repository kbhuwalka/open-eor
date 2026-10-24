/**
 * Integer-cent helpers shared by the quote, the cost rates and invoicing. Every amount in the
 * billing domain is a whole number of cents; these are the only places a fraction is rounded.
 */

/** Scale applied to a percentage so rates with up to six decimals stay exact integers. */
const RATE_SCALE = 1_000_000
const RATE_DENOMINATOR = 100 * RATE_SCALE

/** `cents × ratePct / 100`, rounded half up to a whole cent. */
export function pctOf(cents: number, ratePct: number): number {
  return Math.round((cents * Math.round(ratePct * RATE_SCALE)) / RATE_DENOMINATOR)
}

/** `cents × numerator / denominator`, rounded half up to a whole cent. */
export function prorateCents(cents: number, numerator: number, denominator: number): number {
  if (numerator === denominator) return cents
  return Math.round((cents * numerator) / denominator)
}

/**
 * The part of `amountCents` that falls under an annual cap, given amounts already counted this
 * year (`ytdCents`). Used for every per-year wage base: Social Security, FUTA, SUTA and the
 * 401(a)(17) compensation limit.
 */
export function amountUnderCap(amountCents: number, ytdCents: number, capCents: number): number {
  const before = Math.min(ytdCents, capCents)
  const after = Math.min(ytdCents + amountCents, capCents)
  return Math.max(0, after - before)
}
