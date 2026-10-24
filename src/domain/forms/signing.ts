/**
 * E-signature vocabulary shared by the signing UI and the server-side PDF stamping: the ESIGN/UETA
 * disclosure text, typed-name matching and the shape of a signature record.
 */

import { isBlank, type FieldErrors } from "./primitives"

/** Bump when the disclosure text changes; stored on every signature record. */
export const ESIGN_STATEMENT_VERSION = "esign-ueta-v1"

export const ESIGN_CONSENT_LABEL = "I agree to use electronic records and signatures"

/** One sentence under the consent checkbox. */
export const ESIGN_DISCLOSURE_SHORT =
  "By checking this box and adopting a signature, you agree that your typed name is your legal signature and that it has the same effect as signing on paper. You may decline to sign at any time."

/** Printed on the certificate page of every signed document. */
export const ESIGN_CONSENT_STATEMENT =
  "The signer agreed to conduct this transaction electronically and to be legally bound by documents " +
  "signed with an electronic signature. The signer adopted the typed name shown on this page as their " +
  "signature, intending it to have the same legal effect as a handwritten signature, in accordance with " +
  "the federal Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001 et seq.) " +
  "and the Uniform Electronic Transactions Act (UETA) as adopted in the signer's state. The signer was " +
  "able to read the document before signing, may request a paper copy, and may withdraw consent to " +
  "electronic signature before signing by declining to sign."

/** Lower-cases, strips punctuation and collapses whitespace so "María  O'Neil" and "maria o'neil" compare equal. */
export function normalizeSignerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-\u2010-\u2015]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Whether the typed signature is the signer's name (accent, case, punctuation and spacing insensitive). */
export function typedNameMatches(typed: string, expected: string): boolean {
  return normalizeSignerName(typed) !== "" && normalizeSignerName(typed) === normalizeSignerName(expected)
}

/** Validates what the signature panel collects. `expectedName` is optional; when set, the typed name must match it. */
export function validateSignature(
  input: { typedName?: string; consented?: boolean },
  expectedName?: string,
): FieldErrors {
  const errors: FieldErrors = {}
  if (isBlank(input.typedName)) errors.typedName = "Type your full name to sign."
  else if (input.typedName!.trim().split(/\s+/).length < 2 && !expectedName) errors.typedName = "Type your first and last name."
  else if (expectedName && !typedNameMatches(input.typedName!, expectedName)) {
    errors.typedName = `Type your name exactly as shown: ${expectedName}.`
  }
  if (input.consented !== true) errors.consented = "Agree to sign electronically to continue."
  return errors
}

/** One signature, as embedded in the PDF and returned to callers for their audit trail. */
export type SignatureRecord = {
  version: 1
  /** 1-based position in this document's signature chain. */
  sequence: number
  documentId: string
  documentTitle: string
  /** Where on the document the signature was placed (`i9.section1.employee`, `w4.employee`, …). */
  fieldKey: string
  signerName: string
  signerRole: string
  typedSignature: string
  /** ISO 8601, UTC. */
  signedAt: string
  /** ISO 8601, UTC: when the signer ticked the consent box. */
  consentedAt: string
  consentStatementVersion: string
  /** SHA-256 (hex) of the PDF exactly as it was before this signature was applied. */
  preSignatureSha256: string
  /** Number of pages before the certificate page was appended; the certificate is at this index. */
  pagesBefore: number
  /** Seal of the previous record in the chain, `null` for the first. */
  previousSeal: string | null
  /** HMAC-SHA256 (hex) over every other field; detects edits to this record or earlier ones. */
  seal: string
}

export type SignatureFieldKind = "signature" | "date" | "initials"

/**
 * A place on a document where one signer has to act. Rectangles are in PDF points measured from the
 * bottom-left corner of the page (the coordinate system of `pdf-lib` and of AcroForm widgets); `page`
 * is the 0-based page index. Generators return the fields the next signer still has to complete.
 */
export type SignatureField = {
  /** Unique within the document, e.g. `w4.employee:signature`. */
  id: string
  /** 0-based page index. */
  page: number
  x: number
  y: number
  width: number
  height: number
  kind: SignatureFieldKind
  /** Signature and initials fields count toward "Required: N of M"; date fields fill themselves in. */
  required: boolean
  /** Shown on the tag and read by assistive technology, e.g. "Employee signature". */
  label: string
  /** Capacity of the person who completes it; the signing dialog only shows fields for its signer's role. */
  signerRole: string
  /** For a date field: the signature field whose signing fills it in. */
  linkedTo?: string
  /** The `fieldKey` to pass to `applyEsignature` for this signature (signature fields only). */
  fieldKey?: string
}
