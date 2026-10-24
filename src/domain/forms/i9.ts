/**
 * USCIS Form I-9 (edition 01/20/25): Section 1 (employee), Supplement A (preparer/translator) and
 * Section 2 (employer review). Data shapes, document-title suggestions and validators.
 * The List A xor (List B + List C) rule is the one in `../work-auth`.
 */

import { isWorkAuthListComboValid } from "../work-auth"
import type { DocumentKind } from "../types"
import { IDENTITY_DOCUMENT_TYPES } from "./identity-document"
import {
  isBlank,
  isIsoDate,
  isPersonName,
  isUsStateCode,
  isValidEmail,
  isValidI94Number,
  isValidSsn,
  isValidUsPhone,
  isValidZip,
  normalizeAlienNumber,
  type FieldErrors,
} from "./primitives"

export const I9_EDITION = "01/20/25"

export const I9_ATTESTATION_STATUSES = [
  "citizen",
  "noncitizen_national",
  "lawful_permanent_resident",
  "authorized_alien",
] as const
export type I9AttestationStatus = (typeof I9_ATTESTATION_STATUSES)[number]

export const I9_ATTESTATION_LABELS: Record<I9AttestationStatus, string> = {
  citizen: "A citizen of the United States",
  noncitizen_national: "A noncitizen national of the United States",
  lawful_permanent_resident: "A lawful permanent resident",
  authorized_alien: "An alien authorized to work",
}

export type I9Attestation = {
  status: I9AttestationStatus
  /** USCIS A-Number (`A123456789`). Required for lawful permanent residents. */
  uscisNumber: string
  /** Form I-94 admission number. */
  i94Number: string
  foreignPassportNumber: string
  foreignPassportCountry: string
  /** Work authorization end date (`YYYY-MM-DD`), "" when it has none. */
  workAuthExpiresOn: string
}

/** Supplement A: the person who helped the employee complete Section 1. */
export type I9PreparerData = {
  lastName: string
  firstName: string
  middleInitial: string
  address: string
  city: string
  state: string
  zip: string
}

export type I9Section1Data = {
  lastName: string
  firstName: string
  middleInitial: string
  otherLastNames: string
  address: string
  aptNumber: string
  city: string
  state: string
  zip: string
  /** `YYYY-MM-DD`. */
  dateOfBirth: string
  /** Optional on the form (required only for E-Verify employers). Sensitive; never log. */
  ssn: string
  email: string
  phone: string
  attestation: I9Attestation
  /** `null` when the employee completed Section 1 without help. */
  preparer: I9PreparerData | null
}

export type I9Section1Draft = Partial<Omit<I9Section1Data, "attestation" | "preparer">> & {
  attestation?: Partial<I9Attestation>
  preparer?: Partial<I9PreparerData> | null
}

export type I9Document = {
  title: string
  issuingAuthority: string
  number: string
  /** `YYYY-MM-DD`, "" when the document does not expire. */
  expiresOn: string
}

export type I9Section2Data = {
  /** One List A document (up to three when a passport and an I-94 travel together). */
  listA: I9Document[]
  listB: I9Document | null
  listC: I9Document | null
  additionalInformation: string
  /** The employer used a DHS-authorised alternative procedure to examine the documents. */
  alternativeProcedure: boolean
  /** `YYYY-MM-DD`. */
  firstDayOfEmployment: string
  employerRepFirstName: string
  employerRepLastName: string
  employerRepTitle: string
  businessName: string
  businessAddress: { street: string; city: string; state: string; zip: string }
}

export type I9Section2Draft = Partial<Omit<I9Section2Data, "listA" | "businessAddress">> & {
  listA?: Partial<I9Document>[]
  businessAddress?: Partial<I9Section2Data["businessAddress"]>
}

export const I9_SECTION1_STEPS = [
  { id: "personal", label: "Personal information", fields: ["lastName", "firstName", "middleInitial", "otherLastNames", "address", "aptNumber", "city", "state", "zip", "dateOfBirth", "ssn", "email", "phone"] },
  { id: "attestation", label: "Citizenship or immigration status", fields: ["attestation.status", "attestation.uscisNumber", "attestation.i94Number", "attestation.foreignPassportNumber", "attestation.foreignPassportCountry", "attestation.workAuthExpiresOn"] },
  { id: "preparer", label: "Preparer or translator", fields: ["preparer.lastName", "preparer.firstName", "preparer.middleInitial", "preparer.address", "preparer.city", "preparer.state", "preparer.zip"] },
] as const

/** Common titles per list, as printed in the I-9 Lists of Acceptable Documents. */
export const I9_DOCUMENT_TITLES: Record<"listA" | "listB" | "listC", readonly string[]> = {
  listA: IDENTITY_DOCUMENT_TYPES.list_a.map((t) => t.title),
  listB: IDENTITY_DOCUMENT_TYPES.list_b.map((t) => t.title),
  listC: IDENTITY_DOCUMENT_TYPES.list_c.map((t) => t.title),
}

const MIN_WORKING_AGE_YEARS = 14

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-")
  return `${Number(y) + years}-${m}-${d}`
}

export function validateI9Section1(input: I9Section1Draft, ctx: { today?: string } = {}): FieldErrors {
  const errors: FieldErrors = {}
  const { today } = ctx

  if (isBlank(input.lastName)) errors.lastName = "Enter your last name."
  else if (!isPersonName(input.lastName!)) errors.lastName = "Use letters, spaces, hyphens and apostrophes only."

  if (isBlank(input.firstName)) errors.firstName = "Enter your first name."
  else if (!isPersonName(input.firstName!)) errors.firstName = "Use letters, spaces, hyphens and apostrophes only."

  if (!isBlank(input.middleInitial) && !/^\p{L}$/u.test(input.middleInitial!.trim())) {
    errors.middleInitial = "Enter a single letter."
  }
  if (!isBlank(input.otherLastNames) && input.otherLastNames!.trim().length > 50) {
    errors.otherLastNames = "Use 50 characters or fewer."
  }

  if (isBlank(input.address)) errors.address = "Enter your street address."
  if (isBlank(input.city)) errors.city = "Enter your city or town."
  if (isBlank(input.state)) errors.state = "Choose your state."
  else if (!isUsStateCode(input.state)) errors.state = "Choose a valid state."
  if (isBlank(input.zip)) errors.zip = "Enter your ZIP code."
  else if (!isValidZip(input.zip!)) errors.zip = "Enter a five-digit ZIP code."

  if (isBlank(input.dateOfBirth)) errors.dateOfBirth = "Enter your date of birth."
  else if (!isIsoDate(input.dateOfBirth)) errors.dateOfBirth = "Enter a valid date."
  else if (input.dateOfBirth! < "1900-01-01") errors.dateOfBirth = "Enter a valid date of birth."
  else if (today && input.dateOfBirth! > today) errors.dateOfBirth = "Date of birth cannot be in the future."
  else if (today && addYears(input.dateOfBirth!, MIN_WORKING_AGE_YEARS) > today) {
    errors.dateOfBirth = `You must be at least ${MIN_WORKING_AGE_YEARS} years old to work.`
  }

  if (!isBlank(input.ssn) && !isValidSsn(input.ssn!)) errors.ssn = "Enter a valid Social Security number (nine digits)."
  if (!isBlank(input.email) && !isValidEmail(input.email!)) errors.email = "Enter a valid email address."
  if (!isBlank(input.phone) && !isValidUsPhone(input.phone!)) errors.phone = "Enter a valid 10-digit US phone number."

  validateAttestation(input.attestation, errors, today)
  validatePreparer(input.preparer, errors)
  return errors
}

function validateAttestation(
  attestation: Partial<I9Attestation> | undefined,
  errors: FieldErrors,
  today: string | undefined,
): void {
  const status = attestation?.status
  if (status === undefined) {
    errors["attestation.status"] = "Choose the statement that describes you."
    return
  }
  if (!(I9_ATTESTATION_STATUSES as readonly string[]).includes(status)) {
    errors["attestation.status"] = "Choose a valid option."
    return
  }

  const uscis = attestation?.uscisNumber
  const i94 = attestation?.i94Number
  const passport = attestation?.foreignPassportNumber
  const country = attestation?.foreignPassportCountry

  if (status === "lawful_permanent_resident") {
    if (isBlank(uscis)) errors["attestation.uscisNumber"] = "Enter your USCIS A-Number."
    else if (normalizeAlienNumber(uscis!) === null) {
      errors["attestation.uscisNumber"] = "Enter a valid A-Number (the letter A and 7 to 9 digits)."
    }
    return
  }

  if (status === "authorized_alien") {
    const exp = attestation?.workAuthExpiresOn
    if (!isBlank(exp)) {
      if (!isIsoDate(exp)) errors["attestation.workAuthExpiresOn"] = "Enter a valid date."
      else if (today && exp! < today) {
        errors["attestation.workAuthExpiresOn"] = "Your work authorization has already expired."
      }
    }
    if (!isBlank(uscis) && normalizeAlienNumber(uscis!) === null) {
      errors["attestation.uscisNumber"] = "Enter a valid A-Number (the letter A and 7 to 9 digits)."
    }
    if (!isBlank(i94) && !isValidI94Number(i94!)) {
      errors["attestation.i94Number"] = "A Form I-94 admission number has 11 letters and digits."
    }
    if (!isBlank(passport) && isBlank(country)) {
      errors["attestation.foreignPassportCountry"] = "Enter the country that issued the passport."
    }
    if (!isBlank(country) && isBlank(passport)) {
      errors["attestation.foreignPassportNumber"] = "Enter the foreign passport number."
    }
    const hasAny = !isBlank(uscis) || !isBlank(i94) || !isBlank(passport)
    if (!hasAny) {
      errors["attestation.uscisNumber"] =
        "Enter one of: a USCIS A-Number, a Form I-94 admission number, or a foreign passport number and country."
    }
  }
}

function validatePreparer(preparer: Partial<I9PreparerData> | null | undefined, errors: FieldErrors): void {
  if (preparer === null || preparer === undefined) return
  if (isBlank(preparer.lastName)) errors["preparer.lastName"] = "Enter the preparer's last name."
  else if (!isPersonName(preparer.lastName!)) errors["preparer.lastName"] = "Use letters, spaces, hyphens and apostrophes only."
  if (isBlank(preparer.firstName)) errors["preparer.firstName"] = "Enter the preparer's first name."
  else if (!isPersonName(preparer.firstName!)) errors["preparer.firstName"] = "Use letters, spaces, hyphens and apostrophes only."
  if (!isBlank(preparer.middleInitial) && !/^\p{L}$/u.test(preparer.middleInitial!.trim())) {
    errors["preparer.middleInitial"] = "Enter a single letter."
  }
  if (isBlank(preparer.address)) errors["preparer.address"] = "Enter the preparer's street address."
  if (isBlank(preparer.city)) errors["preparer.city"] = "Enter the preparer's city or town."
  if (isBlank(preparer.state)) errors["preparer.state"] = "Choose the preparer's state."
  else if (!isUsStateCode(preparer.state)) errors["preparer.state"] = "Choose a valid state."
  if (isBlank(preparer.zip)) errors["preparer.zip"] = "Enter the preparer's ZIP code."
  else if (!isValidZip(preparer.zip!)) errors["preparer.zip"] = "Enter a five-digit ZIP code."
}

function validateDocument(
  doc: Partial<I9Document> | null | undefined,
  prefix: string,
  errors: FieldErrors,
  today: string | undefined,
): void {
  if (!doc) return
  if (isBlank(doc.title)) errors[`${prefix}.title`] = "Enter the document title."
  else if (doc.title!.trim().length > 80) errors[`${prefix}.title`] = "Use 80 characters or fewer."
  if (isBlank(doc.issuingAuthority)) errors[`${prefix}.issuingAuthority`] = "Enter the issuing authority."
  else if (doc.issuingAuthority!.trim().length > 60) errors[`${prefix}.issuingAuthority`] = "Use 60 characters or fewer."
  if (!isBlank(doc.number) && doc.number!.trim().length > 40) errors[`${prefix}.number`] = "Use 40 characters or fewer."
  if (!isBlank(doc.expiresOn)) {
    if (!isIsoDate(doc.expiresOn)) errors[`${prefix}.expiresOn`] = "Enter a valid date."
    else if (today && doc.expiresOn! < today) errors[`${prefix}.expiresOn`] = "Expired documents are not acceptable."
  }
}

/** Kinds present in a Section 2 draft, in the shape `isWorkAuthListComboValid` expects. */
export function i9ListKinds(input: Pick<I9Section2Draft, "listA" | "listB" | "listC">): DocumentKind[] {
  const kinds: DocumentKind[] = []
  if (input.listA && input.listA.length > 0) kinds.push("list_a")
  if (input.listB) kinds.push("list_b")
  if (input.listC) kinds.push("list_c")
  return kinds
}

export function validateI9Section2(input: I9Section2Draft, ctx: { today?: string } = {}): FieldErrors {
  const errors: FieldErrors = {}
  const { today } = ctx

  const kinds = i9ListKinds(input)
  if (kinds.length === 0) {
    errors.documents = "Record a List A document, or a List B and a List C document."
  } else if (!isWorkAuthListComboValid(kinds)) {
    errors.documents = "Use one List A document, or one List B and one List C document, but not a mix."
  }

  if ((input.listA?.length ?? 0) > 3) errors.listA = "A form has room for three List A documents."
  input.listA?.forEach((doc, i) => validateDocument(doc, `listA.${i}`, errors, today))
  validateDocument(input.listB, "listB", errors, today)
  validateDocument(input.listC, "listC", errors, today)

  if (isBlank(input.firstDayOfEmployment)) errors.firstDayOfEmployment = "Enter the first day of employment."
  else if (!isIsoDate(input.firstDayOfEmployment)) errors.firstDayOfEmployment = "Enter a valid date."

  if (isBlank(input.employerRepLastName)) errors.employerRepLastName = "Enter the representative's last name."
  else if (!isPersonName(input.employerRepLastName!)) errors.employerRepLastName = "Use letters, spaces, hyphens and apostrophes only."
  if (isBlank(input.employerRepFirstName)) errors.employerRepFirstName = "Enter the representative's first name."
  else if (!isPersonName(input.employerRepFirstName!)) errors.employerRepFirstName = "Use letters, spaces, hyphens and apostrophes only."
  if (isBlank(input.employerRepTitle)) errors.employerRepTitle = "Enter the representative's title."
  if (isBlank(input.businessName)) errors.businessName = "Enter the employer's business name."

  const address = input.businessAddress
  if (isBlank(address?.street)) errors["businessAddress.street"] = "Enter the business street address."
  if (isBlank(address?.city)) errors["businessAddress.city"] = "Enter the business city."
  if (isBlank(address?.state)) errors["businessAddress.state"] = "Choose the business state."
  else if (!isUsStateCode(address?.state)) errors["businessAddress.state"] = "Choose a valid state."
  if (isBlank(address?.zip)) errors["businessAddress.zip"] = "Enter the business ZIP code."
  else if (!isValidZip(address!.zip!)) errors["businessAddress.zip"] = "Enter a five-digit ZIP code."

  if (!isBlank(input.additionalInformation) && input.additionalInformation!.length > 600) {
    errors.additionalInformation = "Use 600 characters or fewer."
  }
  return errors
}

/** One-line print of the I-9 Section 2 business address. */
export function formatBusinessAddress(a: I9Section2Data["businessAddress"]): string {
  return `${a.street.trim()}, ${a.city.trim()}, ${a.state} ${a.zip.trim()}`
}
