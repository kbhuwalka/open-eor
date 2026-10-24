import type { DirectDepositData, I9Section1Data, I9Section2Data, W4Data } from "@/domain/forms"

import type { EmploymentAgreementInput } from "../index"

export const NOW = new Date("2026-10-24T16:00:00Z")
export const SIGNED_AT = new Date("2026-10-24T16:03:21Z")

export const w4: W4Data = {
  firstName: "Maria",
  middleInitial: "L",
  lastName: "Santos-Rivera",
  ssn: "123-45-6789",
  address: "4821 Maple Grove Lane",
  city: "Austin",
  state: "TX",
  zip: "78704",
  filingStatus: "married_jointly_or_qss",
  multipleJobs: true,
  qualifyingChildren: 2,
  otherDependents: 1,
  otherIncomeCents: 120_000,
  deductionsCents: 850_000,
  extraWithholdingCents: 5_050,
  exemptFromWithholding: false,
}

export const section1: I9Section1Data = {
  lastName: "Santos-Rivera",
  firstName: "Maria",
  middleInitial: "L",
  otherLastNames: "Santos",
  address: "4821 Maple Grove Lane",
  aptNumber: "12B",
  city: "Austin",
  state: "TX",
  zip: "78704",
  dateOfBirth: "1991-03-14",
  ssn: "123-45-6789",
  email: "maria@example.com",
  phone: "5125550142",
  attestation: {
    status: "lawful_permanent_resident",
    uscisNumber: "123456789",
    i94Number: "",
    foreignPassportNumber: "",
    foreignPassportCountry: "",
    workAuthExpiresOn: "",
  },
  preparer: { lastName: "Nguyen", firstName: "Pat", middleInitial: "Q", address: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
}

export const section2: I9Section2Data = {
  listA: [],
  listB: { title: "Driver's license", issuingAuthority: "Texas DPS", number: "12345678", expiresOn: "2029-01-01" },
  listC: { title: "Social Security Account Number card (unrestricted)", issuingAuthority: "Social Security Administration", number: "", expiresOn: "" },
  additionalInformation: "",
  alternativeProcedure: false,
  firstDayOfEmployment: "2026-11-02",
  employerRepFirstName: "Sam",
  employerRepLastName: "Ortiz",
  employerRepTitle: "Onboarding Specialist",
  businessName: "Northwind EOR, Inc.",
  businessAddress: { street: "500 Harbor Way, Suite 400", city: "San Francisco", state: "CA", zip: "94105" },
}

export const deposit: DirectDepositData = {
  accountHolderName: "Maria L Santos-Rivera",
  bankName: "Chase",
  routingNumber: "021000021",
  accountNumber: "000123456789",
  accountType: "checking",
  allocation: "fixed_amount",
  fixedAmountCents: 50_000,
}

export const agreementInput: EmploymentAgreementInput = {
  client: { name: "Acme Robotics, Inc." },
  worker: { fullName: "Maria L. Santos-Rivera" },
  role: { title: "Senior Software Engineer" },
  compensation: { wageCents: 15_500_000, wageUnit: "annual", payFrequency: "biweekly" },
  workState: "CA",
  startDate: "2026-11-02",
  endDate: null,
  benefitsPackage: "premium",
  now: NOW,
}
