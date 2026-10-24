/**
 * Integer-cent arithmetic for payroll. Rates are published as percentages with up to six
 * decimals, so they are scaled to integers and every product is done in BigInt: no float ever
 * touches a half-cent boundary, and annual amounts of any size cannot overflow 2^53.
 */

/** Scale applied to a percentage: 1% is 1_000_000 units, so a rate keeps six decimals exactly. */
export const RATE_SCALE = 1_000_000
/** Denominator for `cents * scaledRate`: 100 (percent) times {@link RATE_SCALE}. */
export const RATE_DENOMINATOR = 100 * RATE_SCALE

export function scaledRate(ratePct: number): number {
  return Math.round(ratePct * RATE_SCALE)
}

/** `numerator / denominator` rounded half up (away from zero for positives), as a safe integer. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= BigInt(0)) throw new RangeError("denominator must be positive")
  const negative = numerator < BigInt(0)
  const absolute = negative ? -numerator : numerator
  const quotient = (absolute * BigInt(2) + denominator) / (denominator * BigInt(2))
  return Number(negative ? -quotient : quotient)
}

/** `cents * ratePct / 100`, rounded half up to a whole cent. */
export function pctOfCents(cents: number, ratePct: number): number {
  return divRoundHalfUp(BigInt(cents) * BigInt(scaledRate(ratePct)), BigInt(RATE_DENOMINATOR))
}

/** Round cents to whole dollars (half up), returned as cents. */
export function roundCentsToDollar(cents: number): number {
  return divRoundHalfUp(BigInt(cents), BigInt(100)) * 100
}

export function assertCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be an integer number of cents, got ${value}`)
  }
}

export function assertNonNegativeCents(value: number, name: string): void {
  assertCents(value, name)
  if (value < 0) throw new RangeError(`${name} must not be negative, got ${value}`)
}

export function dollars(amount: number): number {
  return Math.round(amount * 100)
}
