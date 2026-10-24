import { describe, expect, it } from "vitest"

import {
  I9_DOCUMENT_TITLES,
  maskDocumentNumber,
  parseIdentityDocumentDetails,
  reviewedDocumentNumber,
  SSN_CARD_TITLE,
  section2Readiness,
  validateI9Section2,
  type IdentityDocumentDetails,
} from "../index"

const TODAY = "2026-10-24"

const passport: IdentityDocumentDetails = {
  title: "U.S. Passport",
  issuingAuthority: "U.S. Department of State",
  number: "583920174",
  expiresOn: "2031-05-15",
}

describe("parseIdentityDocumentDetails", () => {
  it("takes the issuer from a title that implies one", () => {
    const parsed = parseIdentityDocumentDetails(
      "list_a",
      { title: "U.S. Passport", issuingAuthority: "Somebody else", number: " 583920174 ", expiresOn: "2031-05-15" },
      { today: TODAY },
    )
    expect(parsed).toEqual({ ok: true, details: passport })
  })

  it("asks for the issuer when the title does not name one", () => {
    const parsed = parseIdentityDocumentDetails(
      "list_b",
      { title: "Driver's license", number: "D1234567", expiresOn: "2029-01-31" },
      { today: TODAY },
    )
    expect(parsed).toEqual({ ok: false, errors: { issuingAuthority: "Enter who issued the document." } })

    const withIssuer = parseIdentityDocumentDetails(
      "list_b",
      { title: "Driver's license", issuingAuthority: "Texas DPS", number: "D1234567", expiresOn: "2029-01-31" },
      { today: TODAY },
    )
    expect(withIssuer.ok && withIssuer.details.issuingAuthority).toBe("Texas DPS")
  })

  it("only accepts titles from the chosen list", () => {
    const parsed = parseIdentityDocumentDetails("list_c", { title: "U.S. Passport", number: "1" }, { today: TODAY })
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.errors.title).toBe("Choose a document from the list.")
  })

  it("requires a number and an expiry the document carries", () => {
    const parsed = parseIdentityDocumentDetails("list_a", { title: "U.S. Passport" }, { today: TODAY })
    expect(!parsed.ok && parsed.errors).toEqual({
      number: "Enter the document number.",
      expiresOn: "Enter the expiration date.",
    })
  })

  it("lets a document that may not expire go without a date", () => {
    const parsed = parseIdentityDocumentDetails(
      "list_b",
      { title: "State ID card", issuingAuthority: "Ohio BMV", number: "SX123456", expiresOn: "" },
      { today: TODAY },
    )
    expect(parsed.ok && parsed.details.expiresOn).toBeNull()
  })

  it("rejects an expired document", () => {
    const parsed = parseIdentityDocumentDetails(
      "list_a",
      { ...passport, expiresOn: "2026-10-23" },
      { today: TODAY },
    )
    expect(!parsed.ok && parsed.errors.expiresOn).toBe("This document has expired. Upload a current one.")
  })

  it("checks a Social Security card number and drops any date", () => {
    const bad = parseIdentityDocumentDetails(
      "list_c",
      { title: "Social Security Account Number card (unrestricted)", number: "000-12-3456" },
      { today: TODAY },
    )
    expect(!bad.ok && bad.errors.number).toBe("Enter a valid Social Security number (nine digits).")

    const good = parseIdentityDocumentDetails(
      "list_c",
      { title: "Social Security Account Number card (unrestricted)", number: "123456789", expiresOn: "2030-01-01" },
      { today: TODAY },
    )
    expect(good).toEqual({
      ok: true,
      details: {
        title: "Social Security Account Number card (unrestricted)",
        issuingAuthority: "Social Security Administration",
        number: "123-45-6789",
        expiresOn: null,
      },
    })
  })

  it("rejects punctuation in a document number", () => {
    const parsed = parseIdentityDocumentDetails("list_a", { ...passport, number: "58392;0174" }, { today: TODAY })
    expect(!parsed.ok && parsed.errors.number).toBe("Use letters, digits, spaces and hyphens only.")
  })
})

describe("maskDocumentNumber", () => {
  it("keeps only the last four characters", () => {
    expect(maskDocumentNumber("583920174")).toBe("•••• 0174")
    expect(maskDocumentNumber("123-45-6789")).toBe("•••• 6789")
    expect(maskDocumentNumber("123")).toBe("••••")
  })
})

describe("reviewedDocumentNumber", () => {
  const ssnCard = { title: SSN_CARD_TITLE, number: "123-45-6789" }
  const license = { title: "Driver's license", number: "D4471920" }

  it("always masks a Social Security card's number as an SSN, even for the specialist who signs", () => {
    expect(reviewedDocumentNumber(ssnCard, true)).toBe("***-**-6789")
    expect(reviewedDocumentNumber(ssnCard, false)).toBe("***-**-6789")
  })

  it("shows other numbers in full only while the specialist can sign", () => {
    expect(reviewedDocumentNumber(license, true)).toBe("D4471920")
    expect(reviewedDocumentNumber(license, false)).toBe("•••• 1920")
  })
})

describe("section2Readiness", () => {
  const ssnCard: IdentityDocumentDetails = {
    title: I9_DOCUMENT_TITLES.listC[0],
    issuingAuthority: "Social Security Administration",
    number: "123-45-6789",
    expiresOn: null,
  }
  const license: IdentityDocumentDetails = {
    title: "Driver's license",
    issuingAuthority: "Texas DPS",
    number: "D1234567",
    expiresOn: "2029-01-31",
  }

  it("is ready with a List A document and fills Section 2 lists", () => {
    const ready = section2Readiness([{ id: "a", kind: "list_a", details: passport }], TODAY)
    expect(ready).toEqual({
      state: "ready",
      listA: [{ ...passport, expiresOn: "2031-05-15" }],
      listB: null,
      listC: null,
    })
  })

  it("is ready with List B and List C, and the result passes Section 2 validation", () => {
    const ready = section2Readiness(
      [
        { id: "b", kind: "list_b", details: license },
        { id: "c", kind: "list_c", details: ssnCard },
      ],
      TODAY,
    )
    if (ready.state !== "ready") throw new Error(ready.state)
    expect(ready.listC?.expiresOn).toBe("")
    const errors = validateI9Section2(
      {
        listA: ready.listA,
        listB: ready.listB,
        listC: ready.listC,
        firstDayOfEmployment: "2026-11-02",
        employerRepFirstName: "Dana",
        employerRepLastName: "Whitfield",
        employerRepTitle: "Onboarding Specialist",
        businessName: "Northwind",
        businessAddress: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
      },
      { today: TODAY },
    )
    expect(errors).toEqual({})
  })

  it("reports what stops Section 2, in order", () => {
    expect(section2Readiness([], TODAY)).toEqual({ state: "no_documents" })
    expect(section2Readiness([{ id: "b", kind: "list_b", details: license }], TODAY)).toEqual({
      state: "invalid_combo",
    })
    expect(
      section2Readiness(
        [
          { id: "b", kind: "list_b", details: null },
          { id: "c", kind: "list_c", details: ssnCard },
        ],
        TODAY,
      ),
    ).toEqual({ state: "missing_details", documentIds: ["b"] })
    expect(section2Readiness([{ id: "a", kind: "list_a", details: passport }], "2031-05-16")).toEqual({
      state: "expired",
      documentIds: ["a"],
    })
  })
})
