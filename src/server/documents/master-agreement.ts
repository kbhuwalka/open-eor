/**
 * The master services (EOR) agreement between Northwind and a client company. Generated with the
 * company's name and agreed service fee, countersigned by Northwind at generation, so only the
 * client's signature is outstanding. Same input and `now` give byte-identical PDFs, which is what
 * lets a Server Action regenerate exactly the document the signer was shown.
 */

import { StandardFonts } from "pdf-lib"

import { isIsoDate, type FieldErrors } from "@/domain/forms"

import { CONTENT_WIDTH, GRAY, INK, MARGIN, PAGE, Writer, drawKeyTerms } from "./agreement"
import { NORTHWIND_ENTITY, longDate, renderTemplate } from "./agreement-template"
import { DocumentInputError } from "./errors"
import { applyEsignature, type SignedDocument } from "./esign"
import { addPlaceholderField, createPdf, saveDeterministic, toWinAnsi } from "./pdf-utils"
import { describeSignatureFields, type GeneratedDocument } from "./signature-fields"

/** Signature fields the master agreement exposes to `applyEsignature`. */
export const MASTER_AGREEMENT_SIGNATURE_KEYS = { client: "sig_client", northwind: "sig_northwind" } as const

export const MASTER_AGREEMENT_TITLE = "Northwind EOR Master Services Agreement"
export const MASTER_AGREEMENT_KIND = "master_agreement"
export const MASTER_AGREEMENT_SIGNER_ROLE = "Client"

export type MasterAgreementInput = {
  client: { name: string }
  /** Service fee as percent points of wages (15 = 15%). */
  markupPct: number
  /** `YYYY-MM-DD`: the date the agreement is made as of. Stable for the life of the draft. */
  effectiveDate: string
  /** Printed under the client signature line. Does not decide who may sign. */
  signerName?: string
  /** Generation and countersignature time. Pass it for byte-identical output. */
  now?: Date
  /** Optional stable id for the signature certificate; derived from the document hash otherwise. */
  agreementId?: string
}

export function validateMasterAgreementInput(input: MasterAgreementInput): FieldErrors {
  const errors: FieldErrors = {}
  if (!input.client?.name?.trim()) errors["client.name"] = "Client name is required."
  if (!Number.isInteger(input.markupPct) || input.markupPct < 0 || input.markupPct > 100) {
    errors.markupPct = "The service fee must be a whole percentage between 0 and 100."
  }
  if (!isIsoDate(input.effectiveDate)) errors.effectiveDate = "Enter a valid effective date."
  return errors
}

type Section = { title: string; paragraphs: string[] }

const PREAMBLE =
  'This Master Services Agreement (the "Agreement") is made as of {{effectiveDate}} between {{northwind.legalName}}, {{northwind.description}} with its principal office at {{northwind.address}} ("Northwind"), and {{client.name}} (the "Client"). It governs every order the Client places with Northwind for employer-of-record services and is also the "Client Services Agreement" referred to in each employment agreement Northwind enters into with a worker.'

function sections(): Section[] {
  return [
    {
      title: "Services and Orders",
      paragraphs: [
        "**Orders.** The Client requests each hire by submitting an order through the Northwind portal with the worker's role, work location, pay and start date. An order is accepted when Northwind creates the worker's onboarding record. Each order is governed by this Agreement and the quote frozen into the order; the quote does not change if rates later change.",
        "**Services.** For each worker on an accepted order Northwind will act as the legal employer: it will hire the worker, run payroll, withhold and remit payroll taxes, administer the benefits package chosen on the order, maintain workers' compensation and unemployment insurance registrations, and keep the employment records that applicable law requires.",
      ],
    },
    {
      title: "Employer of Record Relationship",
      paragraphs: [
        "**Employment.** Northwind is the employer of each worker for payroll, tax, benefits and statutory purposes. The Client directs and controls the worker's day-to-day tasks, schedule and the place where work is performed, and is the only party that benefits from the work.",
        "**No other relationship.** Nothing in this Agreement makes the Client an employee, partner or agent of Northwind, or makes Northwind a partner or agent of the Client. Neither party may bind the other.",
        "**Workplace.** The Client will provide a safe workplace and the tools the worker needs, will comply with workplace health and safety laws that apply to the places where it directs work, and will treat Northwind's workers without unlawful discrimination or harassment.",
      ],
    },
    {
      title: "Client Responsibilities",
      paragraphs: [
        "**Accurate information.** The Client will give Northwind complete and accurate information about each role, the pay offered, the work location and the start date, and will tell Northwind promptly about any change, including a change of work location or hours.",
        "**No employment decisions without Northwind.** The Client will not hire, discipline, promote, change the pay of or end the employment of a worker without going through Northwind, so that Northwind can meet its obligations as employer. Northwind may refuse or delay any action that it reasonably believes would violate the law.",
        "**Cooperation.** The Client will cooperate with Northwind's reasonable requests for information in connection with an audit, a claim, an agency inquiry or a legal obligation.",
      ],
    },
    {
      title: "Fees and Payment",
      paragraphs: [
        "**Service fee.** The Client will pay Northwind a service fee of {{markupPct}}% of each worker's wages, in addition to the wages themselves, the employer's share of payroll taxes, the benefits package and the other employment costs shown on the order quote. The fee is calculated on the wage in the order and is frozen into the quote when the order is created.",
        "**Deposit.** Northwind may require a deposit for an order, in the amount stated on the order quote. Northwind holds the deposit as security for the Client's payment obligations and may apply it to amounts that remain unpaid after their due date.",
        "**Invoices.** Northwind will invoice the Client for each payroll period in advance of the pay date. The Client will pay each invoice by the due date shown on it using a payment method on file. Northwind may suspend payroll for a worker whose invoices are overdue, to the extent the law permits, and the Client remains responsible for all wages and taxes that fall due.",
        "**Taxes.** Fees are stated exclusive of sales, use and similar taxes, which the Client will pay where they apply.",
      ],
    },
    {
      title: "Compliance with Laws",
      paragraphs: [
        "**Worker eligibility.** Northwind verifies each worker's identity and authorization to work in the United States by completing Form I-9 and the other onboarding steps before the worker starts. The Client will not allow a worker to begin work before Northwind confirms the worker is ready to start.",
        "**Wages and hours.** Northwind pays at least the minimum wage and overtime that applies at the work location. The Client will keep accurate records of hours worked where Northwind asks for them, and will not ask a worker to work unrecorded time.",
        "**Misclassification and audits.** Each party will comply with the laws that apply to it. If a regulator reclassifies a worker or audits an arrangement, the parties will cooperate and each bears the costs that result from its own breach of law.",
      ],
    },
    {
      title: "Benefits",
      paragraphs: [
        "Each order selects a benefits package. Northwind provides the package under its group plans, subject to the terms of those plans and to the worker's eligibility and elections. Plan terms govern coverage; if a plan and this Agreement disagree about what is covered, the plan controls.",
      ],
    },
    {
      title: "Term and Termination",
      paragraphs: [
        "**Term.** This Agreement starts on the date above and continues until ended under this section. Ending the Agreement does not end an employment relationship by itself: each worker's employment ends as provided in the worker's employment agreement.",
        "**Ending an order.** The Client may cancel an order before the worker starts and may end a worker's assignment at any time through the portal. Northwind will end the employment on the date the law and the worker's agreement allow and will invoice the Client for wages, taxes and benefits through that date.",
        "**Ending the Agreement.** Either party may end this Agreement on thirty days' written notice. Either party may end it immediately if the other materially breaches it and does not fix the breach within ten days of written notice, or becomes insolvent. Fees owed for work done before the end date, and Sections on confidentiality, liability and general terms, survive.",
      ],
    },
    {
      title: "Confidentiality and Data Protection",
      paragraphs: [
        "**Confidential information.** Each party will keep the other's non-public business information confidential, use it only to perform this Agreement and disclose it only to people who need it and are bound to protect it, unless the law requires disclosure.",
        "**Personal data.** Northwind collects workers' personal data, including tax identifiers and bank details, only to run employment and payroll. It protects that data with administrative, technical and physical safeguards and encrypts sensitive values at rest. The Client will use workers' personal data it receives only for legitimate employment purposes.",
      ],
    },
    {
      title: "Liability and Indemnity",
      paragraphs: [
        "**Limit.** Except for the Client's obligation to pay fees and wages, a party's indemnity obligations, breach of confidentiality and wilful misconduct, neither party is liable for indirect, special or consequential damages, and each party's total liability under this Agreement in any twelve months is limited to the fees paid or payable in that period.",
        "**Indemnity.** The Client will defend and indemnify Northwind against third-party claims arising from the Client's instructions to a worker, the Client's workplace or the Client's breach of this Agreement. Northwind will defend and indemnify the Client against third-party claims arising from Northwind's failure to pay wages and payroll taxes that the Client funded or from Northwind's breach of this Agreement.",
      ],
    },
    {
      title: "General",
      paragraphs: [
        "**Governing law.** The laws of the State of Delaware govern this Agreement, without regard to conflict-of-law rules.",
        "**Entire agreement.** This Agreement, together with each accepted order, is the whole agreement about its subject and replaces earlier discussions. Changes must be in writing and accepted by both parties.",
        "**Notices and assignment.** Notices go to the addresses on this Agreement or the portal. Neither party may assign this Agreement without the other's consent, except to a successor to substantially all of its business.",
        "**Electronic signature.** The parties agree that this Agreement may be signed electronically and that a typed signature with the recorded consent is as valid as ink. The signature certificate attached to this Agreement records who signed, when and the document's fingerprint.",
      ],
    },
  ]
}

function drawSignatureBlocks(w: Writer, clientName: string, signerName: string | undefined): void {
  w.ensure(190)
  w.y -= 14
  w.page.drawText("SIGNATURES", { x: MARGIN.left, y: w.y, size: 8, font: w.bold, color: GRAY })
  w.y -= 12
  const blockWidth = 230
  const gap = CONTENT_WIDTH - 2 * blockWidth
  const caption = signerName?.trim() ? `${signerName.trim()}, authorized signatory` : "Authorized signatory"
  const columns = [
    { x: MARGIN.left, party: toWinAnsi(NORTHWIND_ENTITY.legalName.toUpperCase()), caption: "Northwind EOR, authorized signatory", key: MASTER_AGREEMENT_SIGNATURE_KEYS.northwind },
    { x: MARGIN.left + blockWidth + gap, party: toWinAnsi(clientName.toUpperCase()), caption, key: MASTER_AGREEMENT_SIGNATURE_KEYS.client },
  ]
  const sigTop = w.y
  for (const col of columns) {
    w.page.drawText(col.party, { x: col.x, y: sigTop, size: 8.5, font: w.bold, color: INK })
    const rect = { x: col.x, y: sigTop - 62, width: blockWidth, height: 46 }
    w.page.drawLine({ start: { x: col.x, y: rect.y }, end: { x: col.x + blockWidth, y: rect.y }, thickness: 0.6, color: INK })
    addPlaceholderField(w.doc, w.page, col.key, rect)
    w.page.drawText(toWinAnsi(col.caption), { x: col.x, y: rect.y - 11, size: 8.5, font: w.body, color: GRAY })
    const dateRect = { x: col.x + 30, y: rect.y - 36, width: 110, height: 14 }
    w.page.drawText("Date:", { x: col.x, y: dateRect.y + 3, size: 9, font: w.body, color: INK })
    w.page.drawLine({ start: { x: dateRect.x, y: dateRect.y }, end: { x: dateRect.x + dateRect.width, y: dateRect.y }, thickness: 0.4, color: GRAY })
    addPlaceholderField(w.doc, w.page, `${col.key}_date`, dateRect)
  }
  w.y = sigTop - 62 - 52
}

/** Renders the unsigned agreement PDF (no signatures). Exposed for previews and tests. */
export async function renderMasterAgreement(input: MasterAgreementInput): Promise<Uint8Array> {
  const errors = validateMasterAgreementInput(input)
  if (Object.keys(errors).length > 0) throw new DocumentInputError("Master agreement", errors)

  const now = input.now ?? new Date()
  const clientName = input.client.name.trim()
  const doc = await createPdf(`${MASTER_AGREEMENT_TITLE}: ${clientName}`, now)
  doc.setSubject("Master Services Agreement")
  doc.setAuthor(NORTHWIND_ENTITY.legalName)

  const body = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const w = new Writer(doc, body, bold, italic)

  const fields = {
    "northwind.legalName": NORTHWIND_ENTITY.legalName,
    "northwind.description": NORTHWIND_ENTITY.description,
    "northwind.address": NORTHWIND_ENTITY.address,
    "client.name": clientName,
    markupPct: String(input.markupPct),
    effectiveDate: longDate(input.effectiveDate),
  }

  w.y -= 4
  w.page.drawText("Master Services Agreement", { x: MARGIN.left, y: w.y - 16, size: 22, font: bold, color: INK })
  w.y -= 34
  w.paragraph(`${NORTHWIND_ENTITY.legalName}  ·  employer of record services`, { font: sans, size: 9, color: GRAY, gap: 14 })

  drawKeyTerms(w, [
    ["Client", clientName],
    ["Provider", NORTHWIND_ENTITY.legalName],
    ["Effective date", fields.effectiveDate],
    ["Service fee", `${input.markupPct}% of wages`],
    ["Term", "Until ended by either party"],
    ["Governing law", "State of Delaware"],
  ])

  w.paragraph(renderTemplate(PREAMBLE, fields))
  sections().forEach((section, index) => {
    w.heading(`${index + 1}.  ${section.title}`)
    for (const paragraph of section.paragraphs) w.paragraph(renderTemplate(paragraph, fields))
  })

  w.ensure(190)
  w.paragraph("Signed by the parties on the dates shown below.", { font: italic, gap: 2 })
  drawSignatureBlocks(w, clientName, input.signerName)

  w.pages.forEach((page, i) => {
    page.drawText("NORTHWIND EOR  ·  MASTER SERVICES AGREEMENT", { x: MARGIN.left, y: PAGE.height - 44, size: 7.5, font: sans, color: GRAY })
    page.drawLine({ start: { x: MARGIN.left, y: PAGE.height - 50 }, end: { x: PAGE.width - MARGIN.right, y: PAGE.height - 50 }, thickness: 0.4, color: GRAY })
    const label = `Page ${i + 1} of ${w.pages.length}`
    page.drawText(toWinAnsi(clientName), { x: MARGIN.left, y: 40, size: 7.5, font: sans, color: GRAY })
    page.drawText(label, { x: PAGE.width - MARGIN.right - sans.widthOfTextAtSize(label, 7.5), y: 40, size: 7.5, font: sans, color: GRAY })
  })

  return saveDeterministic(doc, now)
}

/**
 * The finished agreement, countersigned by Northwind at `input.now`. Only the client's signature
 * is missing: pass the returned `pdf` to `applyEsignature` with `fields` taken from the returned
 * `fields` (the signing dialog's rectangles) and `fieldKey: MASTER_AGREEMENT_SIGNATURE_KEYS.client`.
 */
export async function generateMasterAgreement(input: MasterAgreementInput): Promise<SignedDocument & GeneratedDocument> {
  const now = input.now ?? new Date()
  const pdf = await renderMasterAgreement({ ...input, now })
  const countersigned = await applyEsignature(pdf, {
    signerName: "Northwind EOR",
    signerRole: "Provider (automatic countersignature)",
    typedSignature: "Northwind EOR",
    signedAt: now,
    consent: true,
    fieldKey: MASTER_AGREEMENT_SIGNATURE_KEYS.northwind,
    documentTitle: `${MASTER_AGREEMENT_TITLE}: ${input.client.name.trim()}`,
    ...(input.agreementId ? { documentId: input.agreementId } : {}),
  })
  const fields = await describeSignatureFields(countersigned.pdf, MASTER_AGREEMENT_SIGNATURE_KEYS.client, {
    signerRole: MASTER_AGREEMENT_SIGNER_ROLE,
    label: "Client signature",
  })
  return { ...countersigned, fields }
}
