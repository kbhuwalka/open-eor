import { PDFDict, PDFName, PDFRef, type PDFDocument, type PDFForm } from "pdf-lib"

import {
  digitsOnly,
  formatBusinessAddress,
  formatUsPhone,
  isoToUs,
  normalizeAlienNumber,
  validateI9Section1,
  validateI9Section2,
  type I9Document,
  type I9Section1Data,
  type I9Section2Data,
} from "@/domain/forms"

import { DocumentInputError } from "./errors"
import { FormFiller, loadOfficialForm, loadPdf } from "./pdf-utils"
import { describeSignatureFields, type GeneratedDocument } from "./signature-fields"

export type FillI9Options = {
  /** Stamped as the modification time; pass it for byte-identical output. */
  now?: Date
}

/**
 * "Document Title 1" is one field with two widgets in the USCIS file: List A on page 1 and the
 * first document of Supplement B (page 4). Drop the page-4 widget so reverification stays blank.
 */
function detachSupplementBTitle(doc: PDFDocument, form: PDFForm): void {
  const field = form.getTextField("Document Title 1")
  const supplementB = doc.getPage(3)
  const kids = field.acroField.Kids()
  if (!kids) return
  for (let i = kids.size() - 1; i >= 0; i--) {
    const ref = kids.get(i)
    if (!(ref instanceof PDFRef)) continue
    const widget = doc.context.lookup(ref, PDFDict)
    if (widget.get(PDFName.of("P")) === supplementB.ref) {
      field.acroField.removeWidget(i)
      supplementB.node.removeAnnot(ref)
    }
  }
}

async function loadI9(base?: Uint8Array): Promise<FormFiller> {
  const doc = base ? await loadPdf(base) : await loadOfficialForm("i-9.pdf")
  const filler = await FormFiller.create(doc)
  if (!base) detachSupplementBTitle(doc, filler.form)
  return filler
}

async function withFields(pdf: Uint8Array, fieldKey: string, signerRole: string, label: string): Promise<GeneratedDocument> {
  return { pdf, fields: await describeSignatureFields(pdf, fieldKey, { signerRole, label }) }
}

async function finish(filler: FormFiller, now: Date | undefined): Promise<Uint8Array> {
  filler.doc.setTitle("Form I-9, Employment Eligibility Verification (edition 01/20/25)")
  filler.doc.setSubject("Employment Eligibility Verification")
  return filler.save(now ?? new Date())
}

/**
 * Fills Section 1 (and Supplement A when a preparer or translator helped) of the official
 * USCIS Form I-9. The signature and date are applied with
 * `applyEsignature(pdf, { fieldKey: "i9.section1.employee", … })`. Throws `DocumentInputError`.
 */
export async function fillI9Section1(
  data: I9Section1Data,
  options: FillI9Options & { today?: string } = {},
): Promise<GeneratedDocument> {
  const errors = validateI9Section1(data, { today: options.today })
  if (Object.keys(errors).length > 0) throw new DocumentInputError("I-9 Section 1", errors)

  const f = await loadI9()

  f.text("Last Name (Family Name)", data.lastName.trim())
  f.text("First Name Given Name", data.firstName.trim())
  f.text("Employee Middle Initial (if any)", data.middleInitial.trim())
  f.text("Employee Other Last Names Used (if any)", data.otherLastNames.trim())
  f.text("Address Street Number and Name", data.address.trim())
  f.text("Apt Number (if any)", data.aptNumber.trim())
  f.text("City or Town", data.city.trim())
  f.select("State", data.state)
  f.text("ZIP Code", data.zip.trim())
  f.text("Date of Birth mmddyyyy", isoToUs(data.dateOfBirth))
  f.text("US Social Security Number", digitsOnly(data.ssn))
  f.text("Employees E-mail Address", data.email.trim(), { max: 9, min: 5.5 })
  f.text("Telephone Number", data.phone.trim() ? formatUsPhone(data.phone) : "")

  const a = data.attestation
  const aNumber = a.uscisNumber.trim() ? normalizeAlienNumber(a.uscisNumber) ?? "" : ""
  f.check("CB_1", a.status === "citizen")
  f.check("CB_2", a.status === "noncitizen_national")
  f.check("CB_3", a.status === "lawful_permanent_resident")
  f.check("CB_4", a.status === "authorized_alien")
  if (a.status === "lawful_permanent_resident") {
    f.text("3 A lawful permanent resident Enter USCIS or ANumber", aNumber, { max: 9, min: 5.5 })
  }
  if (a.status === "authorized_alien") {
    f.text("Exp Date mmddyyyy", isoToUs(a.workAuthExpiresOn), { max: 9, min: 5.5 })
    f.text("USCIS ANumber", aNumber, { max: 9, min: 5.5 })
    f.text("Form I94 Admission Number", a.i94Number.trim().toUpperCase(), { max: 9, min: 5.5 })
    const passport = [a.foreignPassportNumber.trim(), a.foreignPassportCountry.trim()].filter(Boolean).join(", ")
    f.text("Foreign Passport Number and Country of IssuanceRow1", passport, { max: 8, min: 5.5 })
  }

  // Supplement A and B repeat the employee's name from Section 1.
  for (const [last, first, middle] of [
    ["Last Name Family Name from Section 1", "First Name Given Name from Section 1", "Middle initial if any from Section 1"],
    ["Last Name Family Name from Section 1-2", "First Name Given Name from Section 1-2", "Middle initial if any from Section 1-2"],
  ] as const) {
    f.text(last, data.lastName.trim())
    f.text(first, data.firstName.trim())
    f.text(middle, data.middleInitial.trim())
  }

  if (data.preparer) {
    const p = data.preparer
    f.text("Preparer or Translator Last Name (Family Name) 0", p.lastName.trim())
    f.text("Preparer or Translator First Name (Given Name) 0", p.firstName.trim())
    f.text("PT Middle Initial 0", p.middleInitial.trim())
    f.text("Preparer or Translator Address (Street Number and Name) 0", p.address.trim())
    f.text("Preparer or Translator City or Town 0", p.city.trim())
    f.select("Preparer State 0", p.state)
    f.text("Zip Code 0", p.zip.trim())
  }

  return withFields(await finish(f, options.now), "i9.section1.employee", "Employee", "Employee signature")
}

type ListRow = { title: string; issuing: string; number: string; expires: string }

const LIST_A_ROWS: readonly ListRow[] = [
  { title: "Document Title 1", issuing: "Issuing Authority 1", number: "Document Number 0 (if any)", expires: "Expiration Date if any" },
  { title: "Document Title 2 If any", issuing: "Issuing Authority_2", number: "Document Number If any_2", expires: "List A.  Document 2. Expiration Date (if any)" },
  {
    title: "List A.   Document Title 3.  If any",
    issuing: "List A. Document 3.  Enter Issuing Authority",
    number: "List A.  Document 3 Number.  If any",
    expires: "Document Number if any_3",
  },
]
const LIST_B_ROW: ListRow = {
  title: "List B Document 1 Title",
  issuing: "List B Issuing Authority 1",
  number: "List B Document Number 1",
  expires: "List B Expiration Date 1",
}
const LIST_C_ROW: ListRow = {
  title: "List C Document Title 1",
  issuing: "List C Issuing Authority 1",
  number: "List C Document Number 1",
  expires: "List C Expiration Date 1",
}

function fillDocument(f: FormFiller, row: ListRow, doc: I9Document): void {
  f.text(row.title, doc.title.trim(), { max: 7.5, min: 5.5 })
  f.text(row.issuing, doc.issuingAuthority.trim(), { max: 8, min: 5.5 })
  f.text(row.number, doc.number.trim(), { max: 9, min: 5.5 })
  f.text(row.expires, isoToUs(doc.expiresOn), { max: 9, min: 5.5 })
}

/**
 * Fills Section 2 (employer review) on page 1 of the I-9. Pass the Section 1 PDF as `base` to
 * add Section 2 to the employee's completed form; without it the blank official form is used.
 * The representative signs with `fieldKey: "i9.section2.employer"`. Throws `DocumentInputError`.
 */
export async function fillI9Section2(
  data: I9Section2Data,
  options: FillI9Options & { base?: Uint8Array; today?: string } = {},
): Promise<GeneratedDocument> {
  const errors = validateI9Section2(data, { today: options.today })
  if (Object.keys(errors).length > 0) throw new DocumentInputError("I-9 Section 2", errors)

  const f = await loadI9(options.base)

  data.listA.forEach((document, i) => fillDocument(f, LIST_A_ROWS[i], document))
  if (data.listB) fillDocument(f, LIST_B_ROW, data.listB)
  if (data.listC) fillDocument(f, LIST_C_ROW, data.listC)

  f.text("Additional Information", data.additionalInformation.trim(), { max: 8, min: 5.5 })
  f.check("CB_Alt", data.alternativeProcedure)
  f.text("FirstDayEmployed mmddyyyy", isoToUs(data.firstDayOfEmployment), { max: 9, min: 5.5 })
  f.text(
    "Last Name First Name and Title of Employer or Authorized Representative",
    `${data.employerRepLastName.trim()}, ${data.employerRepFirstName.trim()}, ${data.employerRepTitle.trim()}`,
    { max: 9, min: 5.5 },
  )
  f.text("Employers Business or Org Name", data.businessName.trim(), { max: 9, min: 5.5 })
  f.text("Employers Business or Org Address", formatBusinessAddress(data.businessAddress), { max: 9, min: 5.5 })

  return withFields(await finish(f, options.now), "i9.section2.employer", "Employer representative", "Employer representative signature")
}
