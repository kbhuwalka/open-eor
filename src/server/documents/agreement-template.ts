/**
 * Employment agreement template: realistic US at-will language with `{{merge.fields}}`, a
 * fixed-term variant, and a state addendum driven by `STATE_CLAUSES`. Pure text; layout lives in
 * `agreement.ts`. The commercial markup is never part of this document.
 */

import { US_2026 } from "@/domain/cost-rates"
import { formatDollars, isIsoDate } from "@/domain/forms"
import type { BenefitPackage, WageUnit } from "@/domain/types"
import { stateName } from "@/lib/us-states"

import { stateClausesFor } from "./state-clauses"

export const PAY_FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const
export type PayFrequency = (typeof PAY_FREQUENCIES)[number]

const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = {
  weekly: "weekly",
  biweekly: "every two weeks",
  semimonthly: "twice a month",
  monthly: "monthly",
}

export const NORTHWIND_ENTITY = {
  legalName: "Northwind EOR, Inc.",
  description: "a Delaware corporation",
  address: "500 Harbor Way, Suite 400, San Francisco, CA 94105",
} as const

export type EmploymentAgreementInput = {
  employer?: { legalName: string; description?: string; address: string }
  /** The company the worker performs services for. */
  client: { name: string }
  worker: { fullName: string }
  role: { title: string }
  compensation: {
    wageCents: number
    wageUnit: WageUnit
    payFrequency: PayFrequency
    /** Defaults to non-exempt for hourly pay and exempt for salary. */
    flsaStatus?: "exempt" | "non_exempt"
  }
  /** Two-letter code of the state the work is performed in. */
  workState: string
  /** `YYYY-MM-DD`. */
  startDate: string
  /** `YYYY-MM-DD`; a fixed term when present, at-will wording when absent. */
  endDate?: string | null
  benefitsPackage: BenefitPackage
  /** Generation and countersignature time. Pass it for byte-identical output. */
  now?: Date
  /** Optional stable id for the signature certificate; derived from the document hash otherwise. */
  agreementId?: string
}

export type AgreementSection = {
  /** Numbered heading. */
  title: string
  paragraphs: string[]
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function longDate(iso: string): string {
  if (!isIsoDate(iso)) throw new Error(`Invalid date: ${iso}`)
  const [y, m, d] = iso.split("-").map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

function money(cents: number, unit: WageUnit): string {
  const wholeDollars = cents % 100 === 0 && unit !== "hourly"
  const amount = wholeDollars ? formatDollars(cents) : (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const per = unit === "hourly" ? "hour" : unit === "annual" ? "year" : "month"
  return `$${amount} per ${per}`
}

export type MergeFields = Record<string, string>

export function mergeFields(input: EmploymentAgreementInput, effectiveDate: string): MergeFields {
  const employer: NonNullable<EmploymentAgreementInput["employer"]> = input.employer ?? NORTHWIND_ENTITY
  const flsa = input.compensation.flsaStatus ?? (input.compensation.wageUnit === "hourly" ? "non_exempt" : "exempt")
  const pkg = US_2026.packages[input.benefitsPackage]
  return {
    "employer.legalName": employer.legalName,
    "employer.description": employer.description ?? NORTHWIND_ENTITY.description,
    "employer.address": employer.address,
    "client.name": input.client.name,
    "worker.fullName": input.worker.fullName,
    "role.title": input.role.title,
    "compensation.amount": money(input.compensation.wageCents, input.compensation.wageUnit),
    "compensation.payFrequency": PAY_FREQUENCY_LABEL[input.compensation.payFrequency],
    "compensation.flsa": flsa === "non_exempt" ? "non-exempt, which means Employee is eligible for overtime pay" : "exempt from overtime pay under applicable law",
    "workState.name": stateName(input.workState),
    state: stateName(input.workState),
    "benefits.label": pkg.label,
    "benefits.description": pkg.description,
    startDate: longDate(input.startDate),
    endDate: input.endDate ? longDate(input.endDate) : "",
    effectiveDate: longDate(effectiveDate),
  }
}

export function renderTemplate(text: string, fields: MergeFields): string {
  return text.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    const value = fields[key]
    if (value === undefined) throw new Error(`Unknown merge field {{${key}}}`)
    return value
  })
}

const PREAMBLE =
  'This Employment Agreement (the "Agreement") is made as of {{effectiveDate}} between {{employer.legalName}}, {{employer.description}} with its principal office at {{employer.address}} (the "Company" or "Northwind"), and {{worker.fullName}} ("Employee").'

const RECITAL =
  'Northwind provides employer-of-record services. Employee will perform services for {{client.name}} (the "Client") under a services agreement between Northwind and the Client (the "Client Services Agreement"), while Northwind acts as Employee\'s legal employer. The parties agree as follows.'

const AT_WILL_TERM =
  'Employment begins on {{startDate}} (the "Start Date") and continues until ended by either party. Employment is at will: either Employee or the Company may end it at any time, with or without cause or notice, subject to applicable law. Nothing in this Agreement, in any Company or Client policy, or in any statement by a Company or Client representative changes the at-will nature of employment, and only a written agreement signed by an authorized officer of the Company can do so.'

const FIXED_TERM =
  'Employment begins on {{startDate}} (the "Start Date") and ends on {{endDate}} (the "End Date"), unless extended by a written amendment signed by both parties or ended earlier under Section 9. Employment does not continue after the End Date without a signed extension, and the fixed term does not guarantee employment through the End Date where this Agreement permits earlier termination.'

const AT_WILL_TERMINATION =
  'Either party may end employment at any time, with or without cause or advance notice. Employee is asked to give at least two weeks\' written notice of resignation so the Company and the Client can arrange a transition. The Company will pay all wages earned through the last day of employment, and accrued paid time off where the law or Company policy requires, on or before the date applicable law requires. Employment also ends if the Client Services Agreement ends and no other assignment is available, in which case the Company will give as much notice as it reasonably can.'

const FIXED_TERMINATION =
  'During the fixed term, the Company may end employment before the End Date for cause (including serious misconduct, material breach of this Agreement, or inability to lawfully work in the United States) or because the Client Services Agreement ends. Employee may resign before the End Date on at least two weeks\' written notice. The Company will pay all wages earned through the last day of employment, and accrued paid time off where the law or Company policy requires, on or before the date applicable law requires.'

export function agreementSections(input: EmploymentAgreementInput, effectiveDate: string): AgreementSection[] {
  const fields = mergeFields(input, effectiveDate)
  const fixed = Boolean(input.endDate)
  const state = stateClausesFor(input.workState)

  const sections: AgreementSection[] = [
    {
      title: "Position and Duties",
      paragraphs: [
        'Employee is employed as {{role.title}}. Employee will perform the duties of that position and other lawful duties the Company or the Client reasonably assigns that are consistent with it. The Client directs Employee\'s day-to-day work, and Employee will follow the Client\'s reasonable workplace instructions, safety rules and security requirements, together with Company policies. Employee will devote working time to the Client\'s assignment and will not take other work that conflicts with it.',
      ],
    },
    { title: "Term of Employment", paragraphs: [fixed ? FIXED_TERM : AT_WILL_TERM] },
    {
      title: "Compensation",
      paragraphs: [
        'The Company will pay Employee {{compensation.amount}} (the "Base Pay"), paid {{compensation.payFrequency}} through the Company\'s payroll, less taxes and deductions the law requires or Employee authorizes. Employee\'s position is classified as {{compensation.flsa}}. Pay is delivered by direct deposit where Employee has set it up, and each payment is accompanied by an itemized wage statement. Base Pay is reviewed only if the Client and the Company agree to change it in writing.',
        'Where Employee is non-exempt, Employee must record all hours worked, must not work unrecorded or unapproved overtime, and will be paid overtime and meal and rest-period premiums as federal and state law require.',
      ],
    },
    {
      title: "Benefits",
      paragraphs: [
        'Employee is eligible for the {{benefits.label}} benefits package: {{benefits.description}} Enrollment is offered during onboarding, and plan terms in the governing plan documents control. Employee is also covered by the benefits the law provides for every employee, including workers\' compensation, unemployment insurance, Social Security and Medicare, and paid leave required in the work state. The Company may change its benefit plans under their terms and applicable law.',
      ],
    },
    {
      title: "Work Location and Employer of Record",
      paragraphs: [
        'Employee will perform services in {{workState.name}} and will tell the Company before changing the state in which Employee works, because the Company must register for payroll taxes and provide the correct benefits and notices there. {{employer.legalName}} is Employee\'s sole employer for payroll, tax withholding, benefits administration, workers\' compensation and employment-law compliance. The Client is not Employee\'s employer, may not alter this Agreement, and may not promise Employee compensation or benefits on the Company\'s behalf.',
      ],
    },
    {
      title: "Conditions of Employment",
      paragraphs: [
        'Employment is conditioned on Employee\'s ability to lawfully work in the United States. On or before the Start Date, Employee must complete Section 1 of Form I-9 and a federal Form W-4, and within three business days after the Start Date must present original, unexpired documents of Employee\'s choice that establish identity and work authorization. The Company will not ask for specific documents or more documents than the law requires. Employee must also keep the Company informed of address, tax and banking details used for payroll.',
      ],
    },
    {
      title: "Confidentiality",
      paragraphs: [
        '"Confidential Information" means non-public information that Employee learns through employment about the Company, the Client or their customers, including business plans, financial information, pricing, source code, product designs, data, personnel information and trade secrets. During and after employment Employee will use Confidential Information only to perform the job, will not disclose it to anyone without authorization, and will protect it with the same care Employee gives the most sensitive of Employee\'s own information, and no less than reasonable care. Confidential Information does not include information that is public through no fault of Employee, that Employee knew lawfully before employment, or that Employee learns lawfully from a third party free to share it. If the law or a court compels disclosure, Employee will give prompt notice, where permitted, so the Company or the Client can seek protection.',
        '**Protected rights.** Nothing in this Agreement or any policy limits Employee\'s right to discuss or disclose wages, hours or working conditions; to file a charge or complaint with, communicate with, or take part in an investigation by the Equal Employment Opportunity Commission, the National Labor Relations Board, the Occupational Safety and Health Administration, the Securities and Exchange Commission, the Department of Labor or any other government agency, without notice to the Company; or to engage in other activity protected by law. Under the Defend Trade Secrets Act (18 U.S.C. section 1833(b)), an individual is not liable under any federal or state trade secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a complaint or other document filed under seal in a lawsuit or other proceeding.',
      ],
    },
    {
      title: "Invention and Work Product Assignment",
      paragraphs: [
        '"Work Product" means all inventions, software, designs, writings, data, improvements and other works that Employee creates, alone or with others, within the scope of employment or using Confidential Information or the Company\'s or the Client\'s resources. Employee assigns to the Company all right, title and interest in Work Product, including all intellectual property rights, and acknowledges that the Company may further assign those rights to the Client under the Client Services Agreement. Work Product that is copyrightable is a "work made for hire" to the extent the law allows. Employee will promptly disclose Work Product, sign documents and take other reasonable steps, at the Company\'s expense, to perfect and enforce these rights, and appoints the Company as attorney-in-fact for that limited purpose if Employee is unavailable.',
        'Employee lists in a written notice to the Company, before the Start Date, any inventions Employee owns that predate employment ("Prior Inventions"). If Employee lists none, Employee represents that there are none. Prior Inventions are excluded from this Section, but if Employee includes one in Work Product, Employee grants the Company and the Client a non-exclusive, perpetual, worldwide, royalty-free, transferable license to use it as part of that Work Product. This Section does not apply to the extent a state law listed in the State-Specific Provisions below limits assignment.',
      ],
    },
    { title: "Termination", paragraphs: [fixed ? FIXED_TERMINATION : AT_WILL_TERMINATION] },
    {
      title: "Return of Property",
      paragraphs: [
        'When employment ends, or earlier on request, Employee will return all Company and Client property, including devices, credentials, documents and copies of Confidential Information, in any form, and will not keep any of it. Employee will permanently delete Confidential Information from personal devices and accounts after returning a copy to the Company.',
      ],
    },
    {
      title: "General Terms",
      paragraphs: [
        '**Equal opportunity.** The Company is an equal opportunity employer and prohibits discrimination and harassment based on any characteristic protected by federal, state or local law. Employee may report concerns to the Company at any time without fear of retaliation.',
        '**Governing law.** This Agreement is governed by the laws of the State of {{workState.name}} and applicable federal law, without regard to conflict-of-law rules. The parties will bring any dispute that is not subject to a mandatory forum under applicable law in the state or federal courts located in that state.',
        '**Entire agreement; changes.** This Agreement, with the Company\'s written policies and benefit plan documents, is the entire agreement between the parties about its subject and replaces all earlier offers, discussions and understandings. Any change must be in writing and signed by Employee and an authorized officer of the Company. Company policies may change from time to time, but a policy never changes the at-will relationship or overrides this Agreement.',
        '**Severability; survival; assignment.** If a provision is unenforceable, it is enforced to the fullest extent the law allows and the rest of the Agreement remains in effect. Sections 7, 8, 10 and 11 survive the end of employment. The Company may assign this Agreement to a successor or an affiliate that assumes its obligations; Employee may not assign it.',
        '**Electronic signature and counterparts.** The parties agree to sign this Agreement electronically. An electronic signature has the same legal effect as a handwritten one under the federal E-SIGN Act and the Uniform Electronic Transactions Act, and the Agreement may be signed in counterparts. The Company has countersigned this Agreement automatically on its generation; the Agreement becomes binding when Employee signs.',
      ],
    },
  ]

  if (state.length > 0) {
    sections.push({
      title: "State-Specific Provisions for {{workState.name}}",
      paragraphs: [
        'The following provisions apply because Employee works in {{workState.name}}. If one conflicts with another term of this Agreement, the provision in this Section controls.',
        ...state.map((clause) => `**${clause.title}.** ${clause.text}`),
      ],
    })
  }

  return [
    { title: "", paragraphs: [PREAMBLE, RECITAL] },
    ...sections,
  ].map((section) => ({
    title: renderTemplate(section.title, fields),
    paragraphs: section.paragraphs.map((p) => renderTemplate(p, fields)),
  }))
}
