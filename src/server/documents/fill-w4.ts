import {
  formatDollars,
  formatEin,
  formatSsn,
  isoToUs,
  validateW4,
  validateW4Employer,
  w4DependentAmounts,
  type W4Data,
  type W4EmployerData,
} from "@/domain/forms"

import { DocumentInputError } from "./errors"
import { FormFiller, loadOfficialForm } from "./pdf-utils"
import { describeSignatureFields, type GeneratedDocument } from "./signature-fields"

const P1 = "topmostSubform[0].Page1[0]."

const FILING_STATUS_FIELD = {
  single_or_married_separately: `${P1}c1_1[0]`,
  married_jointly_or_qss: `${P1}c1_1[1]`,
  head_of_household: `${P1}c1_1[2]`,
} as const

export type FillW4Options = {
  /** The employer-only block (name and address, first date of employment, EIN). */
  employer?: W4EmployerData
  /** Stamped as the modification time; pass it for byte-identical output. */
  now?: Date
}

function dollars(cents: number): string {
  return cents > 0 ? formatDollars(cents) : ""
}

/**
 * Fills the official 2026 IRS Form W-4 (page 1, Steps 1-4 and the employer block). Step 5 is signed
 * with `applyEsignature(pdf, { fieldKey: "w4.employee", … })`; `fields` describes where. Throws `DocumentInputError`.
 */
export async function fillW4(data: W4Data, options: FillW4Options = {}): Promise<GeneratedDocument> {
  const errors = validateW4(data)
  if (Object.keys(errors).length > 0) throw new DocumentInputError("W-4", errors)
  if (options.employer) {
    const employerErrors = validateW4Employer(options.employer)
    if (Object.keys(employerErrors).length > 0) throw new DocumentInputError("W-4 employer", employerErrors)
  }

  const doc = await loadOfficialForm("fw4.pdf")
  const f = await FormFiller.create(doc, 9)

  const firstAndInitial = data.middleInitial.trim() ? `${data.firstName.trim()} ${data.middleInitial.trim()}` : data.firstName.trim()
  f.text(`${P1}Step1a[0].f1_01[0]`, firstAndInitial)
  f.text(`${P1}Step1a[0].f1_02[0]`, data.lastName.trim())
  f.text(`${P1}Step1a[0].f1_03[0]`, data.address.trim())
  f.text(`${P1}Step1a[0].f1_04[0]`, `${data.city.trim()}, ${data.state} ${data.zip.trim()}`)
  f.text(`${P1}f1_05[0]`, formatSsn(data.ssn))
  f.check(FILING_STATUS_FIELD[data.filingStatus], true)

  f.check(`${P1}c1_2[0]`, data.multipleJobs)

  const credits = w4DependentAmounts(data)
  f.text(`${P1}Step3_ReadOrder[0].f1_06[0]`, dollars(credits.childrenCents))
  f.text(`${P1}Step3_ReadOrder[0].f1_07[0]`, dollars(credits.otherCents))
  f.text(`${P1}f1_08[0]`, dollars(credits.totalCents))
  f.text(`${P1}f1_09[0]`, dollars(data.otherIncomeCents))
  f.text(`${P1}f1_10[0]`, dollars(data.deductionsCents))
  f.text(`${P1}f1_11[0]`, dollars(data.extraWithholdingCents))
  f.check(`${P1}c1_3[0]`, data.exemptFromWithholding)

  if (options.employer) {
    f.text(`${P1}f1_12[0]`, options.employer.nameAndAddress, { max: 8, min: 6 })
    f.text(`${P1}f1_13[0]`, isoToUs(options.employer.firstDateOfEmployment))
    f.text(`${P1}f1_14[0]`, formatEin(options.employer.ein))
  }

  doc.setTitle("Form W-4 (2026), Employee's Withholding Certificate")
  doc.setSubject("Employee's Withholding Certificate")
  const pdf = await f.save(options.now ?? new Date())
  return { pdf, fields: await describeSignatureFields(pdf, "w4.employee", { signerRole: "Employee", label: "Employee signature" }) }
}
