import { describe, expect, it } from "vitest"

import {
  formatDollars,
  formatSsn,
  formatUsPhone,
  hasErrors,
  isValidAbaRouting,
  isValidSsn,
  isoToUs,
  maskAccountNumber,
  maskSsn,
  normalizeAlienNumber,
  pickErrors,
  usToIso,
  validateDirectDeposit,
  validateI9Section1,
  validateI9Section2,
  validateW4,
  validateW4Employer,
  w4DependentAmounts,
  w4WithDefaults,
  type DirectDepositData,
  type I9Section1Data,
  type I9Section2Data,
  type W4Data,
} from "../index"

const TODAY = "2026-10-24"

const w4: W4Data = {
  firstName: "Maria",
  middleInitial: "L",
  lastName: "Santos-Rivera",
  ssn: "123-45-6789",
  address: "4821 Maple Grove Lane",
  city: "Austin",
  state: "TX",
  zip: "78704",
  filingStatus: "married_jointly_or_qss",
  multipleJobs: false,
  qualifyingChildren: 2,
  otherDependents: 1,
  otherIncomeCents: 120_000,
  deductionsCents: 0,
  extraWithholdingCents: 5_000,
  exemptFromWithholding: false,
}

const section1: I9Section1Data = {
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
  phone: "(512) 555-0142",
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

const doc = { title: "U.S. Passport", issuingAuthority: "U.S. Department of State", number: "566123456", expiresOn: "2031-05-01" }

const section2: I9Section2Data = {
  listA: [doc],
  listB: null,
  listC: null,
  additionalInformation: "",
  alternativeProcedure: false,
  firstDayOfEmployment: "2026-11-02",
  employerRepFirstName: "Sam",
  employerRepLastName: "Ortiz",
  employerRepTitle: "Onboarding Specialist",
  businessName: "Northwind EOR, Inc.",
  businessAddress: { street: "500 Harbor Way, Suite 400", city: "San Francisco", state: "CA", zip: "94105" },
}

const deposit: DirectDepositData = {
  accountHolderName: "Maria L Santos-Rivera",
  bankName: "Chase",
  routingNumber: "021000021",
  accountNumber: "000123456789",
  accountType: "checking",
  allocation: "entire_net_pay",
  fixedAmountCents: 0,
}

describe("primitives", () => {
  it("validates SSNs and rejects numbers the SSA never issues", () => {
    expect(isValidSsn("123-45-6789")).toBe(true)
    expect(isValidSsn("123456789")).toBe(true)
    for (const bad of ["000-12-3456", "666-12-3456", "900-12-3456", "123-00-4567", "123-45-0000", "12-345-6789", "123-45-678", "abc-de-fghi", ""]) {
      expect(isValidSsn(bad), bad).toBe(false)
    }
  })

  it("formats and masks SSNs without keeping more than four digits", () => {
    expect(formatSsn("123456789")).toBe("123-45-6789")
    expect(maskSsn("123-45-6789")).toBe("***-**-6789")
    expect(maskSsn("123456789")).toBe("***-**-6789")
    expect(maskSsn("12")).toBe("***-**-****")
    expect(maskSsn("123-45-6789")).not.toContain("123")
  })

  it("checks the ABA routing checksum", () => {
    for (const ok of ["021000021", "011401533", "121000248", "026009593", "322271627"]) {
      expect(isValidAbaRouting(ok), ok).toBe(true)
    }
    expect(isValidAbaRouting("021000022")).toBe(false)
    expect(isValidAbaRouting("123456789")).toBe(false)
    expect(isValidAbaRouting("000000000")).toBe(false)
    expect(isValidAbaRouting("02100002")).toBe(false)
    expect(isValidAbaRouting("0210000211")).toBe(false)
  })

  it("normalizes A-Numbers and converts dates", () => {
    expect(normalizeAlienNumber("a 123-456-789")).toBe("A123456789")
    expect(normalizeAlienNumber("1234567")).toBe("A001234567")
    expect(normalizeAlienNumber("12345")).toBeNull()
    expect(isoToUs("2026-02-09")).toBe("02/09/2026")
    expect(isoToUs("2026-02-30")).toBe("")
    expect(usToIso("02/09/2026")).toBe("2026-02-09")
    expect(usToIso("13/09/2026")).toBeNull()
  })

  it("formats money, phone and account masks", () => {
    expect(formatDollars(220_000)).toBe("2,200")
    expect(formatDollars(123_456)).toBe("1,234.56")
    expect(formatDollars(0)).toBe("0")
    expect(formatUsPhone("5125550142")).toBe("(512) 555-0142")
    expect(maskAccountNumber("000123456789")).toBe("****6789")
  })

  it("picks errors by field list", () => {
    expect(pickErrors({ a: "x", b: "y" }, ["b"])).toEqual({ b: "y" })
    expect(hasErrors({})).toBe(false)
  })
})

describe("validateW4", () => {
  it("accepts a complete form", () => {
    expect(validateW4(w4)).toEqual({})
  })

  it("reports every missing required field with a field-level message", () => {
    const errors = validateW4({})
    expect(Object.keys(errors).sort()).toEqual(
      ["address", "city", "filingStatus", "firstName", "lastName", "ssn", "state", "zip"].sort(),
    )
  })

  it("rejects a bad SSN, ZIP, state, name and negative amounts", () => {
    const errors = validateW4({
      ...w4,
      ssn: "000-00-0000",
      zip: "7870",
      state: "ZZ",
      firstName: "R2D2",
      extraWithholdingCents: -5,
      qualifyingChildren: 1.5,
    })
    expect(Object.keys(errors).sort()).toEqual(["extraWithholdingCents", "firstName", "qualifyingChildren", "ssn", "state", "zip"])
  })

  it("requires Steps 2-4 to be empty when exempt", () => {
    const errors = validateW4({ ...w4, exemptFromWithholding: true })
    expect(Object.keys(errors).sort()).toEqual(["extraWithholdingCents", "otherDependents", "otherIncomeCents", "qualifyingChildren"])
    expect(
      validateW4({
        ...w4,
        exemptFromWithholding: true,
        qualifyingChildren: 0,
        otherDependents: 0,
        otherIncomeCents: 0,
        extraWithholdingCents: 0,
      }),
    ).toEqual({})
  })

  it("computes Step 3 amounts from the 2026 form", () => {
    expect(w4DependentAmounts(w4)).toEqual({ childrenCents: 440_000, otherCents: 50_000, totalCents: 490_000 })
  })

  it("fills defaults for the blanks a wizard leaves open", () => {
    const filled = w4WithDefaults({ firstName: " Ana ", lastName: "Lee" })
    expect(filled.firstName).toBe("Ana")
    expect(filled.qualifyingChildren).toBe(0)
    expect(filled.filingStatus).toBe("single_or_married_separately")
  })

  it("validates the employer-only block", () => {
    expect(validateW4Employer({ nameAndAddress: "Northwind EOR, Inc.", firstDateOfEmployment: "2026-11-02", ein: "12-3456789" })).toEqual({})
    expect(Object.keys(validateW4Employer({ ein: "123" })).sort()).toEqual(["ein", "firstDateOfEmployment", "nameAndAddress"])
  })
})

describe("validateI9Section1", () => {
  it("accepts a citizen", () => {
    expect(validateI9Section1(section1, { today: TODAY })).toEqual({})
  })

  it("lets SSN, email and phone stay blank but checks them when present", () => {
    expect(validateI9Section1({ ...section1, ssn: "", email: "", phone: "" }, { today: TODAY })).toEqual({})
    const errors = validateI9Section1({ ...section1, ssn: "111", email: "nope", phone: "12" }, { today: TODAY })
    expect(Object.keys(errors).sort()).toEqual(["email", "phone", "ssn"])
  })

  it("rejects impossible, future and underage birth dates", () => {
    expect(validateI9Section1({ ...section1, dateOfBirth: "1991-02-30" }, { today: TODAY }).dateOfBirth).toMatch(/valid date/)
    expect(validateI9Section1({ ...section1, dateOfBirth: "2027-01-01" }, { today: TODAY }).dateOfBirth).toMatch(/future/)
    expect(validateI9Section1({ ...section1, dateOfBirth: "2015-01-01" }, { today: TODAY }).dateOfBirth).toMatch(/at least 14/)
    expect(validateI9Section1({ ...section1, dateOfBirth: "" }, { today: TODAY }).dateOfBirth).toMatch(/Enter/)
  })

  it("requires a status", () => {
    expect(validateI9Section1({ ...section1, attestation: {} }, { today: TODAY })["attestation.status"]).toBeDefined()
  })

  it("requires an A-Number for a lawful permanent resident", () => {
    const base = { ...section1, attestation: { ...section1.attestation, status: "lawful_permanent_resident" as const } }
    expect(validateI9Section1(base, { today: TODAY })["attestation.uscisNumber"]).toMatch(/Enter your USCIS/)
    expect(
      validateI9Section1({ ...base, attestation: { ...base.attestation, uscisNumber: "12" } }, { today: TODAY })["attestation.uscisNumber"],
    ).toMatch(/valid A-Number/)
    expect(validateI9Section1({ ...base, attestation: { ...base.attestation, uscisNumber: "A123456789" } }, { today: TODAY })).toEqual({})
  })

  it("requires one identifier for an alien authorized to work, and pairs passport with country", () => {
    const base = { ...section1, attestation: { ...section1.attestation, status: "authorized_alien" as const, workAuthExpiresOn: "2027-06-30" } }
    expect(validateI9Section1(base, { today: TODAY })["attestation.uscisNumber"]).toMatch(/one of/)
    expect(validateI9Section1({ ...base, attestation: { ...base.attestation, i94Number: "12345678901" } }, { today: TODAY })).toEqual({})
    expect(
      validateI9Section1({ ...base, attestation: { ...base.attestation, foreignPassportNumber: "P1234567" } }, { today: TODAY })[
        "attestation.foreignPassportCountry"
      ],
    ).toBeDefined()
    expect(
      validateI9Section1({ ...base, attestation: { ...base.attestation, foreignPassportNumber: "P1234567", foreignPassportCountry: "India" } }, { today: TODAY }),
    ).toEqual({})
    expect(
      validateI9Section1({ ...base, attestation: { ...base.attestation, i94Number: "bad" } }, { today: TODAY })["attestation.i94Number"],
    ).toBeDefined()
  })

  it("rejects an expired or invalid work authorization date", () => {
    const base = {
      ...section1,
      attestation: { ...section1.attestation, status: "authorized_alien" as const, uscisNumber: "A123456789", workAuthExpiresOn: "2026-01-01" },
    }
    expect(validateI9Section1(base, { today: TODAY })["attestation.workAuthExpiresOn"]).toMatch(/expired/)
    expect(validateI9Section1({ ...base, attestation: { ...base.attestation, workAuthExpiresOn: "2026-13-01" } }, { today: TODAY })["attestation.workAuthExpiresOn"]).toMatch(/valid date/)
  })

  it("validates a preparer only when one assisted", () => {
    const errors = validateI9Section1({ ...section1, preparer: { lastName: "", firstName: "Pat" } }, { today: TODAY })
    expect(Object.keys(errors).sort()).toEqual(["preparer.address", "preparer.city", "preparer.lastName", "preparer.state", "preparer.zip"])
    expect(
      validateI9Section1(
        { ...section1, preparer: { lastName: "Nguyen", firstName: "Pat", middleInitial: "", address: "1 Main St", city: "Austin", state: "TX", zip: "78701" } },
        { today: TODAY },
      ),
    ).toEqual({})
  })
})

describe("validateI9Section2", () => {
  const listB = { title: "Driver's license", issuingAuthority: "Texas DPS", number: "12345678", expiresOn: "2029-01-01" }
  const listC = { title: "Social Security Account Number card (unrestricted)", issuingAuthority: "Social Security Administration", number: "", expiresOn: "" }

  it("accepts List A alone", () => {
    expect(validateI9Section2(section2, { today: TODAY })).toEqual({})
  })

  it("accepts List B plus List C", () => {
    expect(validateI9Section2({ ...section2, listA: [], listB, listC }, { today: TODAY })).toEqual({})
  })

  it("rejects List A mixed with B or C, a lone B or C, and nothing", () => {
    expect(validateI9Section2({ ...section2, listB }, { today: TODAY }).documents).toMatch(/not a mix/)
    expect(validateI9Section2({ ...section2, listC }, { today: TODAY }).documents).toMatch(/not a mix/)
    expect(validateI9Section2({ ...section2, listA: [], listB }, { today: TODAY }).documents).toMatch(/not a mix/)
    expect(validateI9Section2({ ...section2, listA: [], listC }, { today: TODAY }).documents).toMatch(/not a mix/)
    expect(validateI9Section2({ ...section2, listA: [] }, { today: TODAY }).documents).toMatch(/Record a List A/)
  })

  it("requires title and authority per document and refuses expired documents", () => {
    const errors = validateI9Section2(
      { ...section2, listA: [{ title: "", issuingAuthority: "", number: "", expiresOn: "2020-01-01" }] },
      { today: TODAY },
    )
    expect(Object.keys(errors).sort()).toEqual(["listA.0.expiresOn", "listA.0.issuingAuthority", "listA.0.title"])
  })

  it("requires the employer block", () => {
    const errors = validateI9Section2({ listA: [doc] }, { today: TODAY })
    expect(Object.keys(errors).sort()).toEqual([
      "businessAddress.city",
      "businessAddress.state",
      "businessAddress.street",
      "businessAddress.zip",
      "businessName",
      "employerRepFirstName",
      "employerRepLastName",
      "employerRepTitle",
      "firstDayOfEmployment",
    ])
  })
})

describe("validateDirectDeposit", () => {
  it("accepts a valid account", () => {
    expect(validateDirectDeposit(deposit)).toEqual({})
  })

  it("rejects a routing number that fails the checksum and a short account number", () => {
    const errors = validateDirectDeposit({ ...deposit, routingNumber: "021000022", accountNumber: "12" })
    expect(Object.keys(errors).sort()).toEqual(["accountNumber", "routingNumber"])
    expect(errors.routingNumber).toMatch(/not valid/)
  })

  it("needs an amount for a fixed deposit", () => {
    expect(validateDirectDeposit({ ...deposit, allocation: "fixed_amount", fixedAmountCents: 0 }).fixedAmountCents).toBeDefined()
    expect(validateDirectDeposit({ ...deposit, allocation: "fixed_amount", fixedAmountCents: 50_000 })).toEqual({})
  })

  it("flags every missing field on an empty draft", () => {
    expect(Object.keys(validateDirectDeposit({})).sort()).toEqual(
      ["accountHolderName", "accountNumber", "accountType", "allocation", "bankName", "routingNumber"],
    )
  })
})
