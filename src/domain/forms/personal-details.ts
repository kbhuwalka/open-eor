/**
 * Personal details the employee gives Northwind for payroll and emergencies: legal name, birth
 * date, Social Security number, phone, home address and an optional emergency contact. The same
 * validator runs in the form and in the Server Action; the task handler (`personal_details`) is the
 * last gate. Pure: callers inject `today`.
 */

import {
  digitsOnly,
  isBlank,
  isIsoDate,
  isPersonName,
  isUsStateCode,
  isValidSsn,
  isValidUsPhone,
  isValidZip,
  type FieldErrors,
} from "./primitives"

export type PersonalDetailsData = {
  legalName: string
  /** `YYYY-MM-DD`. Sensitive: stored encrypted. */
  dateOfBirth: string
  /** Nine digits, dashes optional. Sensitive: stored encrypted, masked everywhere in the UI. */
  ssn: string
  phone: string
  address: { line1: string; line2: string; city: string; state: string; zip: string }
  /** Both optional as a group: leave all three blank for none. */
  emergencyContact: { name: string; relationship: string; phone: string }
}

export type PersonalDetailsDraft = {
  legalName?: string
  dateOfBirth?: string
  ssn?: string
  phone?: string
  address?: Partial<PersonalDetailsData["address"]>
  emergencyContact?: Partial<PersonalDetailsData["emergencyContact"]>
}

export const PERSONAL_DETAILS_MIN_AGE = 16

const MS_PER_YEAR = 365.25 * 86_400_000

function ageOn(birthIso: string, todayIso: string): number {
  return (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${birthIso}T00:00:00Z`)) / MS_PER_YEAR
}

export function validatePersonalDetails(input: PersonalDetailsDraft, ctx: { today: string }): FieldErrors {
  const errors: FieldErrors = {}

  if (isBlank(input.legalName)) errors.legalName = "Enter your full legal name."
  else if (!isPersonName(input.legalName!, 120) || input.legalName!.trim().split(/\s+/).length < 2) {
    errors.legalName = "Enter your first and last name as they appear on your ID."
  }

  if (isBlank(input.dateOfBirth)) errors.dateOfBirth = "Enter your date of birth."
  else if (!isIsoDate(input.dateOfBirth!)) errors.dateOfBirth = "Enter a real date, like 03/14/1992."
  else if (input.dateOfBirth! >= ctx.today) errors.dateOfBirth = "Your date of birth must be in the past."
  else if (ageOn(input.dateOfBirth!, ctx.today) < PERSONAL_DETAILS_MIN_AGE) {
    errors.dateOfBirth = `You must be at least ${PERSONAL_DETAILS_MIN_AGE} to be employed.`
  } else if (ageOn(input.dateOfBirth!, ctx.today) > 110) errors.dateOfBirth = "Check the year of your birth date."

  if (isBlank(input.ssn)) errors.ssn = "Enter your Social Security number."
  else if (!isValidSsn(input.ssn!)) errors.ssn = "A Social Security number has nine digits. Check it against your card."

  if (isBlank(input.phone)) errors.phone = "Enter a phone number."
  else if (!isValidUsPhone(input.phone!)) errors.phone = "Enter a 10-digit US phone number."

  const address = input.address ?? {}
  if (isBlank(address.line1)) errors["address.line1"] = "Enter your street address."
  else if (address.line1!.trim().length > 80) errors["address.line1"] = "Use 80 characters or fewer."
  if (!isBlank(address.line2) && address.line2!.trim().length > 40) errors["address.line2"] = "Use 40 characters or fewer."
  if (isBlank(address.city)) errors["address.city"] = "Enter your city."
  else if (address.city!.trim().length > 60) errors["address.city"] = "Use 60 characters or fewer."
  if (isBlank(address.state)) errors["address.state"] = "Choose your state."
  else if (!isUsStateCode(address.state)) errors["address.state"] = "Choose a state from the list."
  if (isBlank(address.zip)) errors["address.zip"] = "Enter your ZIP code."
  else if (!isValidZip(address.zip!)) errors["address.zip"] = "A ZIP code has five digits."

  const emergency = input.emergencyContact ?? {}
  const anyEmergency = !isBlank(emergency.name) || !isBlank(emergency.relationship) || !isBlank(emergency.phone)
  if (anyEmergency) {
    if (isBlank(emergency.name)) errors["emergencyContact.name"] = "Enter your contact's name."
    else if (!isPersonName(emergency.name!, 120)) errors["emergencyContact.name"] = "Use letters, spaces, hyphens and apostrophes only."
    if (isBlank(emergency.relationship)) errors["emergencyContact.relationship"] = "Say how they are related to you."
    else if (emergency.relationship!.trim().length > 60) errors["emergencyContact.relationship"] = "Use 60 characters or fewer."
    if (isBlank(emergency.phone)) errors["emergencyContact.phone"] = "Enter your contact's phone number."
    else if (!isValidUsPhone(emergency.phone!)) errors["emergencyContact.phone"] = "Enter a 10-digit US phone number."
  }
  return errors
}

export const PERSONAL_DETAILS_SECTIONS = [
  { id: "identity", fields: ["legalName", "dateOfBirth", "ssn"] },
  { id: "contact", fields: ["phone", "address.line1", "address.line2", "address.city", "address.state", "address.zip"] },
  {
    id: "emergency",
    fields: ["emergencyContact.name", "emergencyContact.relationship", "emergencyContact.phone"],
  },
] as const

/** `415-555-0100`: the stored form of a US number (the task handler accepts digits and dashes, not parentheses). */
export function storedPhone(value: string): string {
  let digits = digitsOnly(value)
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : value.trim()
}

/** The payload the `personal_details` task handler takes. */
export function personalDetailsPayload(data: PersonalDetailsData) {
  const emergencyContact = data.emergencyContact ?? { name: "", relationship: "", phone: "" }
  const hasEmergency = !isBlank(emergencyContact.name)
  return {
    legalName: data.legalName.trim().replace(/\s+/g, " "),
    phone: storedPhone(data.phone),
    dateOfBirth: data.dateOfBirth,
    ssn: data.ssn.trim(),
    address: {
      line1: data.address.line1.trim(),
      ...(isBlank(data.address.line2) ? {} : { line2: data.address.line2.trim() }),
      city: data.address.city.trim(),
      state: data.address.state,
      zip: data.address.zip.trim(),
    },
    ...(hasEmergency
      ? {
          emergencyContact: {
            name: emergencyContact.name.trim(),
            relationship: emergencyContact.relationship.trim(),
            phone: storedPhone(emergencyContact.phone),
          },
        }
      : {}),
  }
}
