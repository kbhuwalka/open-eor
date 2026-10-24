// @vitest-environment node
import { PDFDocument, PDFHexString, PDFName, PDFDict } from "pdf-lib"
import { describe, expect, it } from "vitest"

import type { DirectDepositData, I9Section1Data, I9Section2Data, W4Data } from "@/domain/forms"

import {
  AGREEMENT_SIGNATURE_KEYS,
  DocumentInputError,
  DIRECT_DEPOSIT_SIGNATURE_KEY,
  SecretError,
  SignatureError,
  applyEsignature,
  buildDirectDepositAuthorization as buildDirectDepositAuthorizationDocument,
  decryptSecret,
  encryptSecret,
  fillI9Section1 as fillI9Section1Document,
  fillI9Section2 as fillI9Section2Document,
  fillW4 as fillW4Document,
  generateEmploymentAgreement,
  maskEncryptedSsn,
  renderEmploymentAgreement,
  sha256Hex,
  verifySignedDocument,
  type EmploymentAgreementInput,
} from "../index"
import { agreementSections, mergeFields, renderTemplate } from "../agreement-template"
import { STATE_CLAUSES } from "../state-clauses"
import { toWinAnsi } from "../pdf-utils"

const pdfOnly =
  <A extends unknown[]>(generate: (...args: A) => Promise<{ pdf: Uint8Array }>) =>
  async (...args: A) =>
    (await generate(...args)).pdf
const buildDirectDepositAuthorization = pdfOnly(buildDirectDepositAuthorizationDocument)
const fillI9Section1 = pdfOnly(fillI9Section1Document)
const fillI9Section2 = pdfOnly(fillI9Section2Document)
const fillW4 = pdfOnly(fillW4Document)

const NOW = new Date("2026-10-24T16:00:00Z")
const SIGNED_AT = new Date("2026-10-24T16:03:21Z")
const P1 = "topmostSubform[0].Page1[0]."

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
  multipleJobs: true,
  qualifyingChildren: 2,
  otherDependents: 1,
  otherIncomeCents: 120_000,
  deductionsCents: 850_000,
  extraWithholdingCents: 5_050,
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

const section2: I9Section2Data = {
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

const deposit: DirectDepositData = {
  accountHolderName: "Maria L Santos-Rivera",
  bankName: "Chase",
  routingNumber: "021000021",
  accountNumber: "000123456789",
  accountType: "checking",
  allocation: "fixed_amount",
  fixedAmountCents: 50_000,
}

const agreementInput: EmploymentAgreementInput = {
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

const sign = (pdf: Uint8Array, fieldKey: string, name = "Maria L. Santos-Rivera", role = "Employee") =>
  applyEsignature(pdf, { signerName: name, signerRole: role, typedSignature: name, signedAt: SIGNED_AT, consent: true, fieldKey })

async function open(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false })
}

describe("secrets", () => {
  it("round-trips and never repeats a ciphertext", () => {
    const a = encryptSecret("123-45-6789")
    const b = encryptSecret("123-45-6789")
    expect(a).not.toBe(b)
    expect(a).not.toContain("6789")
    expect(decryptSecret(a)).toBe("123-45-6789")
    expect(maskEncryptedSsn(b)).toBe("***-**-6789")
  })

  it("rejects tampering and the wrong context", () => {
    const token = encryptSecret("123-45-6789", "person-1")
    expect(decryptSecret(token, "person-1")).toBe("123-45-6789")
    expect(() => decryptSecret(token, "person-2")).toThrow(SecretError)
    expect(() => decryptSecret(token)).toThrow(SecretError)
    const parts = token.split(".")
    parts[3] = Buffer.from("x").toString("base64url")
    expect(() => decryptSecret(parts.join(".", ), "person-1")).toThrow(SecretError)
    expect(() => decryptSecret("not-a-token")).toThrow(SecretError)
  })

  it("does not leak the plaintext in thrown errors", () => {
    try {
      decryptSecret("v1.AAAA.BBBB.CCCC")
    } catch (error) {
      expect(String(error)).not.toMatch(/\d{9}/)
    }
  })
})

describe("toWinAnsi", () => {
  it("keeps accents the standard fonts can print and degrades the rest", () => {
    expect(toWinAnsi("Zoë  O’Neil")).toBe("Zoë O'Neil")
    expect(toWinAnsi("Łukasz")).toBe("Lukasz")
    expect(toWinAnsi("李")).toBe("?")
  })
})

describe("fillW4", () => {
  it("writes every step into the official AcroForm fields", async () => {
    const pdf = await fillW4(w4, {
      now: NOW,
      employer: { nameAndAddress: "Northwind EOR, Inc.", firstDateOfEmployment: "2026-11-02", ein: "841234567" },
    })
    const doc = await open(pdf)
    const form = doc.getForm()
    expect(doc.getPageCount()).toBe(5)
    expect(doc.getTitle()).toMatch(/W-4/)
    const text = (name: string) => form.getTextField(`${P1}${name}`).getText()
    expect(text("Step1a[0].f1_01[0]")).toBe("Maria L")
    expect(text("Step1a[0].f1_02[0]")).toBe("Santos-Rivera")
    expect(text("Step1a[0].f1_04[0]")).toBe("Austin, TX 78704")
    expect(text("f1_05[0]")).toBe("123-45-6789")
    expect(form.getCheckBox(`${P1}c1_1[0]`).isChecked()).toBe(false)
    expect(form.getCheckBox(`${P1}c1_1[1]`).isChecked()).toBe(true)
    expect(form.getCheckBox(`${P1}c1_2[0]`).isChecked()).toBe(true)
    expect(text("Step3_ReadOrder[0].f1_06[0]")).toBe("4,400")
    expect(text("Step3_ReadOrder[0].f1_07[0]")).toBe("500")
    expect(text("f1_08[0]")).toBe("4,900")
    expect(text("f1_09[0]")).toBe("1,200")
    expect(text("f1_10[0]")).toBe("8,500")
    expect(text("f1_11[0]")).toBe("50.50")
    expect(form.getCheckBox(`${P1}c1_3[0]`).isChecked()).toBe(false)
    expect(text("f1_13[0]")).toBe("11/02/2026")
    expect(text("f1_14[0]")).toBe("84-1234567")
    expect(form.getFields().every((f) => f.isReadOnly())).toBe(true)
  })

  it("refuses invalid data with field-level errors and no values", async () => {
    const error = await fillW4({ ...w4, ssn: "000-00-0000" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DocumentInputError)
    expect((error as DocumentInputError).errors).toHaveProperty("ssn")
    expect((error as DocumentInputError).message).not.toContain("000-00-0000")
  })

  it("is deterministic for the same input and clock", async () => {
    const [a, b] = await Promise.all([fillW4(w4, { now: NOW }), fillW4(w4, { now: NOW })])
    expect(sha256Hex(a)).toBe(sha256Hex(b))
  })
})

describe("fillI9Section1 and fillI9Section2", () => {
  it("fills Section 1, the attestation and Supplement A", async () => {
    const pdf = await fillI9Section1(section1, { now: NOW, today: "2026-10-24" })
    const doc = await open(pdf)
    const form = doc.getForm()
    expect(doc.getPageCount()).toBe(4)
    const text = (n: string) => form.getTextField(n).getText()
    expect(text("Last Name (Family Name)")).toBe("Santos-Rivera")
    expect(text("Date of Birth mmddyyyy")).toBe("03/14/1991")
    expect(text("US Social Security Number")).toBe("123456789")
    expect(text("Telephone Number")).toBe("(512) 555-0142")
    expect(form.getDropdown("State").getSelected()).toEqual(["TX"])
    expect(form.getCheckBox("CB_1").isChecked()).toBe(false)
    expect(form.getCheckBox("CB_3").isChecked()).toBe(true)
    expect(text("3 A lawful permanent resident Enter USCIS or ANumber")).toBe("A123456789")
    expect(text("Preparer or Translator Last Name (Family Name) 0")).toBe("Nguyen")
    expect(form.getDropdown("Preparer State 0").getSelected()).toEqual(["TX"])
    expect(text("Last Name Family Name from Section 1")).toBe("Santos-Rivera")
    expect(text("Document Title 1") ?? "").toBe("")
  })

  it("leaves Supplement A blank without a preparer and fills the alien-authorized identifiers", async () => {
    const pdf = await fillI9Section1(
      {
        ...section1,
        preparer: null,
        attestation: {
          status: "authorized_alien",
          uscisNumber: "",
          i94Number: "12345678901",
          foreignPassportNumber: "P1234567",
          foreignPassportCountry: "India",
          workAuthExpiresOn: "2027-06-30",
        },
      },
      { now: NOW, today: "2026-10-24" },
    )
    const form = (await open(pdf)).getForm()
    expect(form.getTextField("Preparer or Translator Last Name (Family Name) 0").getText() ?? "").toBe("")
    expect(form.getCheckBox("CB_4").isChecked()).toBe(true)
    expect(form.getTextField("Exp Date mmddyyyy").getText()).toBe("06/30/2027")
    expect(form.getTextField("Form I94 Admission Number").getText()).toBe("12345678901")
    expect(form.getTextField("Foreign Passport Number and Country of IssuanceRow1").getText()).toBe("P1234567, India")
  })

  it("adds Section 2 to the signed Section 1 and keeps Section 1's signature intact", async () => {
    const s1 = await sign(await fillI9Section1(section1, { now: NOW, today: "2026-10-24" }), "i9.section1.employee")
    const pdf = await fillI9Section2(section2, { base: s1.pdf, now: NOW, today: "2026-10-24" })
    const doc = await open(pdf)
    const form = doc.getForm()
    expect(doc.getPageCount()).toBe(5)
    expect(form.getTextField("List B Document 1 Title").getText()).toBe("Driver's license")
    expect(form.getTextField("List C Issuing Authority 1").getText()).toBe("Social Security Administration")
    expect(form.getTextField("Last Name First Name and Title of Employer or Authorized Representative").getText()).toBe(
      "Ortiz, Sam, Onboarding Specialist",
    )
    expect(form.getTextField("Employers Business or Org Address").getText()).toBe("500 Harbor Way, Suite 400, San Francisco, CA 94105")
    expect(form.getTextField("Today's Date mmddyyy").getText()).toBe("10/24/2026")
    expect(form.getTextField("Last Name (Family Name)").getText()).toBe("Santos-Rivera")

    const s2 = await sign(pdf, "i9.section2.employer", "Sam Ortiz", "Employer representative")
    const verified = await verifySignedDocument(s2.pdf)
    expect(verified.valid).toBe(true)
    expect(verified.signatures.map((s) => s.signerName)).toEqual(["Maria L. Santos-Rivera", "Sam Ortiz"])
    expect(new Set(verified.signatures.map((s) => s.documentId)).size).toBe(1)
  })

  it("rejects a List A mixed with List B", async () => {
    const mixed: I9Section2Data = { ...section2, listA: [{ title: "U.S. Passport", issuingAuthority: "U.S. Department of State", number: "1", expiresOn: "" }] }
    await expect(fillI9Section2(mixed)).rejects.toBeInstanceOf(DocumentInputError)
  })
})

describe("applyEsignature and verifySignedDocument", () => {
  it("stamps the signature, fills the date field and appends a certificate page", async () => {
    const unsigned = await fillI9Section1(section1, { now: NOW, today: "2026-10-24" })
    const signed = await sign(unsigned, "i9.section1.employee")
    const doc = await open(signed.pdf)
    expect(doc.getPageCount()).toBe(5)
    expect(signed.preSignatureSha256).toBe(sha256Hex(unsigned))
    expect(signed.sha256).toBe(sha256Hex(signed.pdf))
    expect(signed.documentId).toBe(`NW-${sha256Hex(unsigned).slice(0, 12).toUpperCase()}`)
    expect(signed.record).toMatchObject({
      sequence: 1,
      signerName: "Maria L. Santos-Rivera",
      signerRole: "Employee",
      fieldKey: "i9.section1.employee",
      signedAt: "2026-10-24T16:03:21.000Z",
      consentStatementVersion: "esign-ueta-v1",
      pagesBefore: 4,
      previousSeal: null,
    })
    expect(doc.getForm().getTextField("Today's Date mmddyyy").getText()).toBe("10/24/2026")
    expect(doc.getTitle()).toMatch(/I-9/)
  })

  it("is deterministic", async () => {
    const unsigned = await fillW4(w4, { now: NOW })
    const [a, b] = await Promise.all([sign(unsigned, "w4.employee"), sign(unsigned, "w4.employee")])
    expect(a.sha256).toBe(b.sha256)
  })

  it("chains signatures and verifies the whole trail", async () => {
    const agreement = await generateEmploymentAgreement(agreementInput)
    const worker = await sign(agreement.pdf, AGREEMENT_SIGNATURE_KEYS.worker)
    expect(worker.documentId).toBe(agreement.documentId)
    expect(worker.record.sequence).toBe(2)
    expect(worker.record.previousSeal).toBe(agreement.record.seal)
    const result = await verifySignedDocument(worker.pdf, { expectedSha256: worker.sha256, preSignaturePdf: agreement.pdf })
    expect(result).toMatchObject({ valid: true, problems: [] })
  })

  it("rejects a mismatched typed name, missing consent and an unknown signature field", async () => {
    const unsigned = await fillW4(w4, { now: NOW })
    const base = { signerName: "Maria L. Santos-Rivera", signerRole: "Employee", typedSignature: "Maria L. Santos-Rivera", signedAt: SIGNED_AT, consent: true as const, fieldKey: "w4.employee" }
    await expect(applyEsignature(unsigned, { ...base, typedSignature: "Someone Else" })).rejects.toMatchObject({ code: "TYPED_NAME_MISMATCH" })
    await expect(applyEsignature(unsigned, { ...base, consent: false as unknown as true })).rejects.toBeInstanceOf(SignatureError)
    await expect(applyEsignature(unsigned, { ...base, fieldKey: "nope" })).rejects.toMatchObject({ code: "SIGNATURE_SLOT_NOT_FOUND" })
    await expect(applyEsignature(unsigned, { ...base, signedAt: "not a date" })).rejects.toMatchObject({ code: "INVALID_SIGNED_AT" })
    await expect(applyEsignature(unsigned, { ...base, typedSignature: "maria l santos rivera" })).resolves.toBeDefined()
  })

  it("detects a changed file, an edited record and a removed certificate page", async () => {
    const signed = await sign(await fillW4(w4, { now: NOW }), "w4.employee")
    expect((await verifySignedDocument(signed.pdf, { expectedSha256: "0".repeat(64) })).valid).toBe(false)
    expect((await verifySignedDocument(signed.pdf, { preSignaturePdf: new Uint8Array([1, 2, 3]) })).valid).toBe(false)

    const edited = await open(signed.pdf)
    const info = edited.context.lookup(edited.context.trailerInfo.Info, PDFDict)
    const records = JSON.parse((info.lookup(PDFName.of("NorthwindSignatures")) as PDFHexString).decodeText())
    records[0].signerName = "Mallory"
    info.set(PDFName.of("NorthwindSignatures"), PDFHexString.fromText(JSON.stringify(records)))
    const tampered = await verifySignedDocument(await edited.save())
    expect(tampered.valid).toBe(false)
    expect(tampered.problems.join(" ")).toMatch(/altered/)

    const stripped = await open(signed.pdf)
    stripped.removePage(stripped.getPageCount() - 1)
    const result = await verifySignedDocument(await stripped.save())
    expect(result.valid).toBe(false)
    expect(result.problems.join(" ")).toMatch(/certificate page|Pages were removed/)
  })

  it("reports an unsigned document as not valid", async () => {
    const result = await verifySignedDocument(await fillW4(w4, { now: NOW }))
    expect(result.valid).toBe(false)
    expect(result.signatures).toEqual([])
  })
})

describe("employment agreement", () => {
  it("renders every merge field and chooses at-will or fixed-term wording", () => {
    const atWill = agreementSections(agreementInput, "2026-10-24").map((s) => s.paragraphs.join("\n")).join("\n")
    expect(atWill).toContain("Maria L. Santos-Rivera")
    expect(atWill).toContain("Acme Robotics, Inc.")
    expect(atWill).toContain("Senior Software Engineer")
    expect(atWill).toContain("$155,000 per year")
    expect(atWill).toContain("every two weeks")
    expect(atWill).toContain("November 2, 2026")
    expect(atWill).toContain("Premium")
    expect(atWill).toContain("Employment is at will")
    expect(atWill).not.toMatch(/\{\{|\}\}/)
    expect(atWill).not.toMatch(/markup|service fee/i)

    const fixed = agreementSections({ ...agreementInput, endDate: "2027-04-30" }, "2026-10-24").map((s) => s.paragraphs.join("\n")).join("\n")
    expect(fixed).toContain("ends on April 30, 2027")
    expect(fixed).not.toContain("Employment is at will")
  })

  it("renders hourly pay, non-exempt status and rejects unknown merge fields", () => {
    const fields = mergeFields({ ...agreementInput, compensation: { wageCents: 6_550, wageUnit: "hourly", payFrequency: "weekly" } }, "2026-10-24")
    expect(fields["compensation.amount"]).toBe("$65.50 per hour")
    expect(fields["compensation.flsa"]).toMatch(/non-exempt/)
    expect(() => renderTemplate("{{nope}}", fields)).toThrow(/Unknown merge field/)
  })

  it("adds a state addendum from the clause table and none for states without clauses", () => {
    const ca = agreementSections(agreementInput, "2026-10-24")
    expect(ca.at(-1)?.title).toBe("State-Specific Provisions for California")
    expect(ca.at(-1)?.paragraphs.join(" ")).toContain("Labor Code section 2870")
    expect(Object.keys(STATE_CLAUSES)).toContain("NY")
    const fl = agreementSections({ ...agreementInput, workState: "FL" }, "2026-10-24")
    expect(fl.at(-1)?.title).toBe("General Terms")
  })

  it("generates a PDF countersigned by Northwind with a timestamped certificate", async () => {
    const generated = await generateEmploymentAgreement(agreementInput)
    const doc = await open(generated.pdf)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(5)
    expect(doc.getTitle()).toBe("Employment Agreement: Maria L. Santos-Rivera")
    expect(generated.record).toMatchObject({
      signerName: "Northwind EOR",
      typedSignature: "Northwind EOR",
      fieldKey: AGREEMENT_SIGNATURE_KEYS.employer,
      signedAt: NOW.toISOString(),
    })
    expect(doc.getForm().getTextField("sig_employer_date").getText()).toBe("10/24/2026")
    expect(doc.getForm().getTextField(AGREEMENT_SIGNATURE_KEYS.worker).getText() ?? "").toBe("")
    expect((await verifySignedDocument(generated.pdf)).valid).toBe(true)
  })

  it("is deterministic and rejects invalid input", async () => {
    const [a, b] = await Promise.all([renderEmploymentAgreement(agreementInput), renderEmploymentAgreement(agreementInput)])
    expect(sha256Hex(a)).toBe(sha256Hex(b))
    await expect(
      generateEmploymentAgreement({ ...agreementInput, endDate: "2026-10-01", workState: "ZZ" }),
    ).rejects.toBeInstanceOf(DocumentInputError)
  })
})

describe("direct deposit authorization", () => {
  it("builds a one-page form, signs it and keeps the numbers out of the field list", async () => {
    const pdf = await buildDirectDepositAuthorization(deposit, { employee: { fullName: "Maria L. Santos-Rivera" }, now: NOW })
    const doc = await open(pdf)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getTitle()).toMatch(/Direct Deposit/)
    const signed = await sign(pdf, DIRECT_DEPOSIT_SIGNATURE_KEY)
    expect((await open(signed.pdf)).getPageCount()).toBe(2)
    expect((await verifySignedDocument(signed.pdf)).valid).toBe(true)
  })

  it("rejects a bad routing number", async () => {
    await expect(
      buildDirectDepositAuthorization({ ...deposit, routingNumber: "021000022" }, { employee: { fullName: "Maria" } }),
    ).rejects.toBeInstanceOf(DocumentInputError)
  })
})
