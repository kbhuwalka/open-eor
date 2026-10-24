import type { I9Section1Data } from "@/domain/forms"
import type { EmploymentAgreementInput } from "@/server/documents"

export const SAMPLE_EMPLOYEE_NAME = "Maria L. Santos-Rivera"

/** Fixed so the agreement the viewer shows is byte-identical to the one that gets signed. */
export const SAMPLE_AGREEMENT_INPUT: EmploymentAgreementInput = {
  client: { name: "Acme Robotics, Inc." },
  worker: { fullName: SAMPLE_EMPLOYEE_NAME },
  role: { title: "Field Service Engineer" },
  compensation: { wageCents: 9_500_000, wageUnit: "annual", payFrequency: "biweekly" },
  workState: "CA",
  startDate: "2026-11-16",
  endDate: null,
  benefitsPackage: "standard",
  now: new Date("2026-10-24T15:00:00Z"),
}

export const SAMPLE_SECTION1: I9Section1Data = {
  lastName: "Santos-Rivera",
  firstName: "Maria",
  middleInitial: "L",
  otherLastNames: "",
  address: "200 Main St",
  aptNumber: "4B",
  city: "Austin",
  state: "TX",
  zip: "78701",
  dateOfBirth: "1990-03-14",
  ssn: "123-45-6789",
  email: "maria.santos@example.com",
  phone: "(512) 555-0143",
  attestation: {
    status: "citizen",
    uscisNumber: "",
    i94Number: "",
    foreignPassportNumber: "",
    foreignPassportCountry: "",
    workAuthExpiresOn: "",
  },
  preparer: null,
}
