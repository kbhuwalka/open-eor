/**
 * Field-level building blocks shared by the W-4, I-9 and direct-deposit validators.
 * Pure: no clocks, no I/O. Callers inject `today` (`YYYY-MM-DD`) where a rule is time-relative.
 */

import { isIsoDate } from "../employment-term"

export { isIsoDate }

/** Field-level errors keyed by field path (`ssn`, `attestation.uscisNumber`). Empty means valid. */
export type FieldErrors = Record<string, string>

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0
}

/** Keeps only the errors whose key is one of `fields` (for per-step validation in a wizard). */
export function pickErrors(errors: FieldErrors, fields: readonly string[]): FieldErrors {
  const wanted = new Set(fields)
  return Object.fromEntries(Object.entries(errors).filter(([key]) => wanted.has(key)))
}

export const US_STATE_CODES = [
  "AK", "AL", "AR", "AS", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "GU", "HI", "IA", "ID", "IL",
  "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MP", "MS", "MT", "NC", "ND", "NE", "NH",
  "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VI",
  "VT", "WA", "WI", "WV", "WY",
] as const

export function isUsStateCode(value: unknown): boolean {
  return typeof value === "string" && (US_STATE_CODES as readonly string[]).includes(value)
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "")
}

export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "")
}

const NAME = /^\p{L}[\p{L}\p{M}'’ .-]*$/u

/** Letters, spaces, hyphens, apostrophes and periods; starts with a letter. */
export function isPersonName(value: string, maxLength = 40): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength && NAME.test(trimmed)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(value: string): boolean {
  return EMAIL.test(value.trim()) && value.trim().length <= 254
}

/** A 10-digit US number, optionally prefixed with country code 1. Area and exchange code cannot start with 0 or 1. */
export function isValidUsPhone(value: string): boolean {
  let digits = digitsOnly(value)
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)
}

export function formatUsPhone(value: string): string {
  let digits = digitsOnly(value)
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  if (digits.length !== 10) return value.trim()
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/** Five-digit ZIP code (the official forms have room for five digits). */
export function isValidZip(value: string): boolean {
  return /^\d{5}$/.test(value.trim())
}

/**
 * Social Security number: nine digits, with or without dashes. Rejects the area numbers the SSA
 * never issues (000, 666, 900-999), group 00 and serial 0000.
 */
export function isValidSsn(value: string): boolean {
  const compact = value.trim()
  if (!/^(\d{9}|\d{3}-\d{2}-\d{4})$/.test(compact)) return false
  const digits = digitsOnly(compact)
  const area = Number(digits.slice(0, 3))
  if (area === 0 || area === 666 || area >= 900) return false
  if (digits.slice(3, 5) === "00") return false
  if (digits.slice(5) === "0000") return false
  return true
}

/** `123-45-6789` from any valid SSN spelling; the input unchanged when it is not nine digits. */
export function formatSsn(value: string): string {
  const digits = digitsOnly(value)
  if (digits.length !== 9) return value
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

/** `***-**-6789`. Anything that does not hold four trailing digits masks completely. */
export function maskSsn(value: string): string {
  const digits = digitsOnly(value)
  if (digits.length < 4) return "***-**-****"
  return `***-**-${digits.slice(-4)}`
}

/**
 * ABA routing transit number: nine digits, a Federal Reserve prefix, and the 3-7-1 weighted
 * checksum (3·d1 + 7·d2 + d3 + 3·d4 + 7·d5 + d6 + 3·d7 + 7·d8 + d9) divisible by 10.
 */
export function isValidAbaRouting(value: string): boolean {
  if (!/^\d{9}$/.test(value.trim())) return false
  const d = value.trim().split("").map(Number)
  const prefix = d[0] * 10 + d[1]
  const fedPrefix =
    (prefix >= 0 && prefix <= 12) || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72) || prefix === 80
  if (!fedPrefix || /^0+$/.test(value.trim())) return false
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])
  return sum % 10 === 0
}

/** Bank account numbers run 4 to 17 digits. */
export function isValidAccountNumber(value: string): boolean {
  return /^\d{4,17}$/.test(value.trim())
}

/** `••••6789` style mask for account numbers. */
export function maskAccountNumber(value: string): string {
  const digits = digitsOnly(value)
  if (digits.length <= 4) return "****"
  return `****${digits.slice(-4)}`
}

/** USCIS A-Number: `A` plus 7-9 digits (the `A` is optional on input). */
export function normalizeAlienNumber(value: string): string | null {
  const compact = value.trim().replace(/[\s-]/g, "").toUpperCase()
  const match = /^A?(\d{7,9})$/.exec(compact)
  if (!match) return null
  return `A${match[1].padStart(9, "0")}`
}

/** Form I-94 admission number: 11 characters, digits and letters. */
export function isValidI94Number(value: string): boolean {
  return /^[A-Za-z0-9]{11}$/.test(value.trim())
}

/** Employer identification number: `NN-NNNNNNN`. */
export function isValidEin(value: string): boolean {
  return /^\d{2}-?\d{7}$/.test(value.trim())
}

export function formatEin(value: string): string {
  const digits = digitsOnly(value)
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : value
}

/** `MM/DD/YYYY` from `YYYY-MM-DD` (what the paper forms print); "" for anything else. */
export function isoToUs(iso: string): string {
  if (!isIsoDate(iso)) return ""
  const [y, m, d] = iso.split("-")
  return `${m}/${d}/${y}`
}

/** `YYYY-MM-DD` from `MM/DD/YYYY`; null when it is not a real day. */
export function usToIso(us: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(us.trim())
  if (!match) return null
  const iso = `${match[3]}-${match[1]}-${match[2]}`
  return isIsoDate(iso) ? iso : null
}

/** Whole US dollars from cents, no symbol: `1,234` or `1,234.56`. */
export function formatDollars(cents: number): string {
  const whole = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return rest === 0 ? grouped : `${grouped}.${rest.toString().padStart(2, "0")}`
}

export function isNonNegativeInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
}
