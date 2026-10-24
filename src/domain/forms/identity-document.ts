/**
 * Identity documents for Form I-9: the acceptable titles per list, what the employee enters when
 * uploading one (title, issuer, number, expiry), and whether a set of uploads is ready for the
 * employer to record in Section 2. Pure: callers inject `today` (`YYYY-MM-DD`).
 */

import { isWorkAuthListComboValid } from "../work-auth"
import type { I9Document } from "./i9"
import { isBlank, isIsoDate, isValidSsn, formatSsn, maskSsn, type FieldErrors } from "./primitives"

export type IdentityListKind = "list_a" | "list_b" | "list_c"

export const IDENTITY_LIST_KINDS: readonly IdentityListKind[] = ["list_a", "list_b", "list_c"]

/** `required`: the document always carries a date; `optional`: some do; `none`: it never expires. */
export type ExpiryRule = "required" | "optional" | "none"

export type IdentityDocumentType = {
  /** As printed in the I-9 Lists of Acceptable Documents. */
  title: string
  /** Fixed issuer when the title implies one; null when the employee names it (a state, a country). */
  authority: string | null
  expiry: ExpiryRule
}

export const IDENTITY_DOCUMENT_TYPES: Record<IdentityListKind, readonly IdentityDocumentType[]> = {
  list_a: [
    { title: "U.S. Passport", authority: "U.S. Department of State", expiry: "required" },
    { title: "U.S. Passport Card", authority: "U.S. Department of State", expiry: "required" },
    { title: "Permanent Resident Card (Form I-551)", authority: "USCIS", expiry: "optional" },
    { title: "Employment Authorization Document (Form I-766)", authority: "USCIS", expiry: "required" },
    { title: "Foreign passport with Form I-94 / I-551 stamp", authority: null, expiry: "required" },
    { title: "Foreign passport with Form I-94 (nonimmigrant, authorized employer)", authority: null, expiry: "required" },
  ],
  list_b: [
    { title: "Driver's license", authority: null, expiry: "required" },
    { title: "State ID card", authority: null, expiry: "optional" },
    { title: "School ID card with photograph", authority: null, expiry: "optional" },
    { title: "Voter registration card", authority: null, expiry: "optional" },
    { title: "U.S. military card or draft record", authority: "U.S. Department of Defense", expiry: "optional" },
    { title: "Native American tribal document", authority: null, expiry: "optional" },
    { title: "Canadian driver's license", authority: null, expiry: "required" },
  ],
  list_c: [
    { title: "Social Security Account Number card (unrestricted)", authority: "Social Security Administration", expiry: "none" },
    { title: "Certification of report of birth (Form FS-545 / DS-1350)", authority: "U.S. Department of State", expiry: "none" },
    { title: "Birth certificate issued by a State, county or municipal authority", authority: null, expiry: "none" },
    { title: "Native American tribal document", authority: null, expiry: "optional" },
    { title: "U.S. Citizen ID Card (Form I-197)", authority: "USCIS", expiry: "optional" },
    { title: "Employment authorization document issued by DHS", authority: "DHS", expiry: "optional" },
  ],
}

export const SSN_CARD_TITLE = "Social Security Account Number card (unrestricted)"

/** What the employee recorded for one uploaded document. Never log `number`. */
export type IdentityDocumentDetails = {
  title: string
  issuingAuthority: string
  number: string
  /** `YYYY-MM-DD`, null when the document has no expiration date. */
  expiresOn: string | null
}

export type IdentityDocumentDraft = {
  title?: string
  issuingAuthority?: string
  number?: string
  expiresOn?: string | null
}

export type ParsedIdentityDocument =
  | { ok: true; details: IdentityDocumentDetails }
  | { ok: false; errors: FieldErrors }

export function identityDocumentType(kind: IdentityListKind, title: string): IdentityDocumentType | null {
  return IDENTITY_DOCUMENT_TYPES[kind].find((t) => t.title === title) ?? null
}

const DOCUMENT_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]*$/

/**
 * Validates an employee's entry for one upload and normalises it: the issuer comes from the title
 * when the title implies one, an SSN prints as `123-45-6789`, and a date on a document that never
 * expires is dropped. Errors are keyed `title`, `issuingAuthority`, `number`, `expiresOn`.
 */
export function parseIdentityDocumentDetails(
  kind: IdentityListKind,
  draft: IdentityDocumentDraft,
  ctx: { today: string },
): ParsedIdentityDocument {
  const errors: FieldErrors = {}
  const type = isBlank(draft.title) ? null : identityDocumentType(kind, draft.title!.trim())
  if (isBlank(draft.title)) errors.title = "Choose the document."
  else if (!type) errors.title = "Choose a document from the list."

  const authority = type?.authority ?? draft.issuingAuthority?.trim() ?? ""
  if (type && type.authority === null) {
    if (authority === "") errors.issuingAuthority = "Enter who issued the document."
    else if (authority.length > 60) errors.issuingAuthority = "Use 60 characters or fewer."
  }

  const rawNumber = draft.number?.trim() ?? ""
  let number = rawNumber
  if (rawNumber === "") errors.number = "Enter the document number."
  else if (type?.title === SSN_CARD_TITLE) {
    if (isValidSsn(rawNumber)) number = formatSsn(rawNumber)
    else errors.number = "Enter a valid Social Security number (nine digits)."
  } else if (rawNumber.length > 40) errors.number = "Use 40 characters or fewer."
  else if (!DOCUMENT_NUMBER.test(rawNumber)) errors.number = "Use letters, digits, spaces and hyphens only."

  const rawExpiry = draft.expiresOn?.trim() ?? ""
  let expiresOn: string | null = null
  if (type && type.expiry !== "none") {
    if (rawExpiry === "") {
      if (type.expiry === "required") errors.expiresOn = "Enter the expiration date."
    } else if (!isIsoDate(rawExpiry)) errors.expiresOn = "Enter a valid date."
    else if (rawExpiry < ctx.today) errors.expiresOn = "This document has expired. Upload a current one."
    else expiresOn = rawExpiry
  }

  if (Object.keys(errors).length > 0 || !type) return { ok: false, errors }
  return { ok: true, details: { title: type.title, issuingAuthority: authority, number, expiresOn } }
}

/** `•••• 6789`: enough for the employee to recognise their own document. */
export function maskDocumentNumber(number: string): string {
  const compact = number.replace(/[\s-]/g, "")
  if (compact.length <= 4) return "••••"
  return `•••• ${compact.slice(-4)}`
}

/**
 * The number as the specialist's review shows it. A Social Security card's number is the SSN, so it
 * is always `***-**-6789`, like every SSN staff see; any other number is in full while the
 * specialist can still sign (they compare it with the document) and `•••• 6789` afterwards.
 */
export function reviewedDocumentNumber(details: Pick<IdentityDocumentDetails, "title" | "number">, canSign: boolean): string {
  if (details.title === SSN_CARD_TITLE) return maskSsn(details.number)
  return canSign ? details.number : maskDocumentNumber(details.number)
}

export function toI9Document(details: IdentityDocumentDetails): I9Document {
  return {
    title: details.title,
    issuingAuthority: details.issuingAuthority,
    number: details.number,
    expiresOn: details.expiresOn ?? "",
  }
}

export type ReviewedUpload = {
  id: string
  kind: IdentityListKind
  details: IdentityDocumentDetails | null
}

/**
 * Whether the active uploads can go straight onto Section 2. Checked in order: nothing uploaded,
 * not an acceptable List A / List B + C combination, an upload without the employee's details
 * (uploaded before details were asked for), an expired document.
 */
export type Section2Readiness =
  | { state: "ready"; listA: I9Document[]; listB: I9Document | null; listC: I9Document | null }
  | { state: "no_documents" }
  | { state: "invalid_combo" }
  | { state: "missing_details"; documentIds: string[] }
  | { state: "expired"; documentIds: string[] }

export function section2Readiness(uploads: readonly ReviewedUpload[], today: string): Section2Readiness {
  if (uploads.length === 0) return { state: "no_documents" }
  if (!isWorkAuthListComboValid(uploads.map((u) => u.kind))) return { state: "invalid_combo" }
  const missing = uploads.filter((u) => u.details === null).map((u) => u.id)
  if (missing.length > 0) return { state: "missing_details", documentIds: missing }
  const expired = uploads
    .filter((u) => u.details!.expiresOn !== null && u.details!.expiresOn < today)
    .map((u) => u.id)
  if (expired.length > 0) return { state: "expired", documentIds: expired }

  const of = (kind: IdentityListKind) => uploads.filter((u) => u.kind === kind).map((u) => toI9Document(u.details!))
  return { state: "ready", listA: of("list_a"), listB: of("list_b")[0] ?? null, listC: of("list_c")[0] ?? null }
}
