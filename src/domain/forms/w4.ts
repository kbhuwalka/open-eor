/**
 * IRS Form W-4 (2026), Employee's Withholding Certificate: data shape, step map and validator.
 * Federal withholding only; this product collects no state withholding forms.
 */

import {
  isNonNegativeInteger,
  isBlank,
  isPersonName,
  isUsStateCode,
  isValidEin,
  isValidSsn,
  isValidZip,
  isIsoDate,
  type FieldErrors,
} from "./primitives"

export const W4_FILING_STATUSES = [
  "single_or_married_separately",
  "married_jointly_or_qss",
  "head_of_household",
] as const
export type W4FilingStatus = (typeof W4_FILING_STATUSES)[number]

export const W4_FILING_STATUS_LABELS: Record<W4FilingStatus, string> = {
  single_or_married_separately: "Single or Married filing separately",
  married_jointly_or_qss: "Married filing jointly or Qualifying surviving spouse",
  head_of_household: "Head of household",
}

/** Credit per qualifying child under 17 and per other dependent printed on the 2026 form (Step 3). */
export const W4_CHILD_CREDIT_CENTS = 220_000
export const W4_OTHER_DEPENDENT_CREDIT_CENTS = 50_000
/** Edition printed on the form this module fills. */
export const W4_TAX_YEAR = 2026

export type W4Data = {
  /** Step 1(a). */
  firstName: string
  /** Step 1(a), one letter or "". */
  middleInitial: string
  lastName: string
  /** Step 1(b): nine digits, dashes optional. Sensitive; never log. */
  ssn: string
  address: string
  city: string
  /** Two-letter code. */
  state: string
  /** Five digits. */
  zip: string
  /** Step 1(c). */
  filingStatus: W4FilingStatus
  /** Step 2(c): two jobs total (or spouse works) and the worker uses the checkbox method. */
  multipleJobs: boolean
  /** Step 3(a): number of qualifying children under 17. */
  qualifyingChildren: number
  /** Step 3(b): number of other dependents. */
  otherDependents: number
  /** Step 4(a): other income, in cents. */
  otherIncomeCents: number
  /** Step 4(b): deductions, in cents. */
  deductionsCents: number
  /** Step 4(c): extra withholding per pay period, in cents. */
  extraWithholdingCents: number
  /** "Exempt from withholding": Steps 2-4 must then be empty. */
  exemptFromWithholding: boolean
}

export type W4Draft = Partial<W4Data>

/** Employer-only block at the bottom of page 1. */
export type W4EmployerData = {
  nameAndAddress: string
  firstDateOfEmployment: string
  /** `NN-NNNNNNN`. */
  ein: string
}

export const W4_STEPS = [
  { id: "personal", label: "Personal information", fields: ["firstName", "middleInitial", "lastName", "ssn", "address", "city", "state", "zip"] },
  { id: "filing", label: "Filing status", fields: ["filingStatus"] },
  { id: "jobs", label: "Multiple jobs", fields: ["multipleJobs"] },
  { id: "dependents", label: "Dependents", fields: ["qualifyingChildren", "otherDependents"] },
  { id: "adjustments", label: "Other adjustments", fields: ["otherIncomeCents", "deductionsCents", "extraWithholdingCents", "exemptFromWithholding"] },
] as const satisfies readonly { id: string; label: string; fields: readonly (keyof W4Data)[] }[]

export type W4StepId = (typeof W4_STEPS)[number]["id"]

const MAX_CENTS = 99_999_999_00

/** Step 3 amounts in cents: children × $2,200, other dependents × $500, and their sum. */
export function w4DependentAmounts(data: Pick<W4Data, "qualifyingChildren" | "otherDependents">): {
  childrenCents: number
  otherCents: number
  totalCents: number
} {
  const childrenCents = (data.qualifyingChildren || 0) * W4_CHILD_CREDIT_CENTS
  const otherCents = (data.otherDependents || 0) * W4_OTHER_DEPENDENT_CREDIT_CENTS
  return { childrenCents, otherCents, totalCents: childrenCents + otherCents }
}

export function validateW4(input: W4Draft): FieldErrors {
  const errors: FieldErrors = {}

  if (isBlank(input.firstName)) errors.firstName = "Enter your first name."
  else if (!isPersonName(input.firstName!)) errors.firstName = "Use letters, spaces, hyphens and apostrophes only."

  if (!isBlank(input.middleInitial) && !/^\p{L}$/u.test(input.middleInitial!.trim())) {
    errors.middleInitial = "Enter a single letter."
  }

  if (isBlank(input.lastName)) errors.lastName = "Enter your last name."
  else if (!isPersonName(input.lastName!)) errors.lastName = "Use letters, spaces, hyphens and apostrophes only."

  if (isBlank(input.ssn)) errors.ssn = "Enter your Social Security number."
  else if (!isValidSsn(input.ssn!)) errors.ssn = "Enter a valid Social Security number (nine digits)."

  if (isBlank(input.address)) errors.address = "Enter your street address."
  else if (input.address!.trim().length > 60) errors.address = "Use 60 characters or fewer."

  if (isBlank(input.city)) errors.city = "Enter your city or town."
  if (isBlank(input.state)) errors.state = "Choose your state."
  else if (!isUsStateCode(input.state)) errors.state = "Choose a valid state."

  if (isBlank(input.zip)) errors.zip = "Enter your ZIP code."
  else if (!isValidZip(input.zip!)) errors.zip = "Enter a five-digit ZIP code."

  if (input.filingStatus === undefined) errors.filingStatus = "Choose a filing status."
  else if (!(W4_FILING_STATUSES as readonly string[]).includes(input.filingStatus)) {
    errors.filingStatus = "Choose a valid filing status."
  }

  const exempt = input.exemptFromWithholding === true
  const countField = (key: "qualifyingChildren" | "otherDependents", label: string) => {
    const value = input[key]
    if (value === undefined) return
    if (!isNonNegativeInteger(value, 99)) errors[key] = `Enter ${label} as a whole number from 0 to 99.`
    else if (exempt && value > 0) errors[key] = "Leave this at 0 when claiming exemption from withholding."
  }
  countField("qualifyingChildren", "the number of children")
  countField("otherDependents", "the number of dependents")

  const moneyField = (key: "otherIncomeCents" | "deductionsCents" | "extraWithholdingCents") => {
    const value = input[key]
    if (value === undefined) return
    if (!isNonNegativeInteger(value, MAX_CENTS)) errors[key] = "Enter a dollar amount of $0 or more."
    else if (exempt && value > 0) errors[key] = "Leave this at $0 when claiming exemption from withholding."
  }
  moneyField("otherIncomeCents")
  moneyField("deductionsCents")
  moneyField("extraWithholdingCents")

  if (exempt && input.multipleJobs === true) {
    errors.multipleJobs = "Leave this unchecked when claiming exemption from withholding."
  }

  return errors
}

/** Fills the blanks a wizard leaves open so a complete `W4Data` can be built from a valid draft. */
export function w4WithDefaults(input: W4Draft): W4Data {
  return {
    firstName: (input.firstName ?? "").trim(),
    middleInitial: (input.middleInitial ?? "").trim(),
    lastName: (input.lastName ?? "").trim(),
    ssn: input.ssn ?? "",
    address: (input.address ?? "").trim(),
    city: (input.city ?? "").trim(),
    state: input.state ?? "",
    zip: (input.zip ?? "").trim(),
    filingStatus: input.filingStatus ?? "single_or_married_separately",
    multipleJobs: input.multipleJobs ?? false,
    qualifyingChildren: input.qualifyingChildren ?? 0,
    otherDependents: input.otherDependents ?? 0,
    otherIncomeCents: input.otherIncomeCents ?? 0,
    deductionsCents: input.deductionsCents ?? 0,
    extraWithholdingCents: input.extraWithholdingCents ?? 0,
    exemptFromWithholding: input.exemptFromWithholding ?? false,
  }
}

export function validateW4Employer(input: Partial<W4EmployerData>): FieldErrors {
  const errors: FieldErrors = {}
  if (isBlank(input.nameAndAddress)) errors.nameAndAddress = "Enter the employer's name and address."
  if (isBlank(input.firstDateOfEmployment)) errors.firstDateOfEmployment = "Enter the first date of employment."
  else if (!isIsoDate(input.firstDateOfEmployment)) errors.firstDateOfEmployment = "Enter a valid date."
  if (isBlank(input.ein)) errors.ein = "Enter the employer identification number."
  else if (!isValidEin(input.ein!)) errors.ein = "Enter a valid EIN (NN-NNNNNNN)."
  return errors
}
