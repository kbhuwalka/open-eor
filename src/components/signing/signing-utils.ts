import { typedNameMatches, validateSignature, type FieldErrors, type SignatureField } from "@/domain/forms"

import type { PdfPageSize } from "./pdf-loader"

/** Zone the signing date is shown in; `applyEsignature` stamps the same one. */
export const SIGNING_TIME_ZONE = "America/New_York"

/** `MM/DD/YYYY` in the signing zone, matching the date the server stamps. */
export function formatSigningDate(date: Date, timeZone = SIGNING_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${get("month")}/${get("day")}/${get("year")}`
}

/** "Maria L. Santos-Rivera" gives "MLS": the first letter of each name part, at most three. */
export function defaultInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.match(/\p{L}/u)?.[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase()
}

/** Errors for the adopt form; the typed name must be one of `expected` when any are given. */
export function adoptionErrors(typedName: string, initials: string, expected: readonly string[]): FieldErrors {
  const errors = validateSignature({ typedName, consented: true }, expected.length === 1 ? expected[0] : undefined)
  if (expected.length > 1 && !errors.typedName && !expected.some((name) => typedNameMatches(typedName, name))) {
    errors.typedName = `Type your name as shown: ${expected[0]}.`
  }
  if (initials.trim() === "") errors.initials = "Enter your initials."
  else if (initials.trim().length > 4) errors.initials = "Use at most four letters."
  return errors
}

/** Reading order: page, then top to bottom, then left to right. Also the Tab order of the tags. */
export function sortFields(fields: readonly SignatureField[]): SignatureField[] {
  return [...fields].sort((a, b) => a.page - b.page || b.y + b.height - (a.y + a.height) || a.x - b.x)
}

/** A tag is never smaller than this many PDF points tall, so it stays easy to hit on thin signature lines. */
export const MIN_TAG_HEIGHT = 20

/**
 * Where a field sits on its page as percentages of the page box. PDF coordinates run from the
 * bottom-left; CSS from the top-left. Thin fields grow upward, keeping the bottom edge on the line.
 */
export function fieldBox(field: Pick<SignatureField, "x" | "y" | "width" | "height">, page: PdfPageSize, minHeight = 0) {
  const height = Math.max(field.height, minHeight)
  return {
    left: (field.x / page.width) * 100,
    top: ((page.height - field.y - height) / page.height) * 100,
    width: (field.width / page.width) * 100,
    height: (height / page.height) * 100,
    /** Field height as a percentage of page width, for `cqw` font sizing. */
    heightCqw: (height / page.width) * 100,
  }
}
