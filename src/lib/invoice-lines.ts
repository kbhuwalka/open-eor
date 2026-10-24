/**
 * What an invoice line says, in words, derived from the numbers it was calculated from
 * (docs/client-finance.md §8). Pure and shared by the invoice page, the drawer and the PDF, so all
 * three print the same thing.
 *
 * Nothing here knows a rate: every percentage, wage base and amount in the text is read from the
 * line's stored `inputs` (billing-and-invoicing.md I2) and formatted. A line whose inputs are
 * missing or of an unexpected shape still gets its title, just without the basis.
 */

import { HEALTH_TIER_LABELS, type HealthTier } from "@/domain/cost-rates"
import type {
  InvoiceDisplayStatus,
  InvoiceLine,
  InvoiceLineCode,
  InvoiceLineGroup,
  InvoicePeriod,
} from "@/domain/billing/types"
import { formatIsoDay } from "@/lib/finance-format"
import { formatCents } from "@/lib/format"

export type LineDescription = {
  /** Customer-facing name of the charge. */
  title: string
  /** One sentence on how the amount was worked out; `null` when the inputs do not say. */
  basis: string | null
  /** What the rate applies to ("$4,807.69", "9 of 14 days"); fills the Quantity column. */
  quantity: string | null
  /** The rate itself ("6.2%", "$5,923.07 / period"); fills the Rate column. */
  rate: string | null
}

type Inputs = Record<string, unknown>

const num = (inputs: Inputs, key: string): number | null => {
  const value = inputs[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
const text = (inputs: Inputs, key: string): string | null => {
  const value = inputs[key]
  return typeof value === "string" && value !== "" ? value : null
}

/** "6.2%", "1.45%", "18%": no float noise, no trailing zeros. */
export function formatPct(pct: number): string {
  return `${Number(pct.toFixed(4))}%`
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function healthTierLabel(tier: string | null): string | null {
  if (!tier) return null
  return HEALTH_TIER_LABELS[tier as HealthTier] ?? capitalize(tier.replaceAll("_", " "))
}

function daysClause(inputs: Inputs): string | null {
  const days = num(inputs, "daysEmployed")
  const periodDays = num(inputs, "periodDays")
  return days !== null && periodDays !== null && days < periodDays ? `prorated ${days} of ${periodDays} days` : null
}

const STATUTORY_TITLE: Partial<Record<InvoiceLineCode, string>> = {
  SOCIAL_SECURITY: "Employer Social Security",
  MEDICARE: "Employer Medicare",
  FUTA: "Federal unemployment tax (FUTA)",
  SUTA: "State unemployment tax (SUTA)",
  WORKERS_COMP: "Workers' compensation insurance",
}

function describeStatutory(code: InvoiceLineCode, inputs: Inputs): LineDescription {
  const title = STATUTORY_TITLE[code] ?? code
  const ratePct = num(inputs, "ratePct")
  const taxable = num(inputs, "taxableWageCents")
  if (ratePct === null || taxable === null) return { title, basis: null, quantity: null, rate: null }
  const wage = num(inputs, "wageCents")
  const base = num(inputs, "wageBaseCents")
  let basis = `${formatPct(ratePct)} of ${formatCents(taxable)} wages`
  if (base !== null) {
    const capped = taxable === 0 || (wage !== null && taxable < wage)
    basis += `, annual wage base ${formatCents(base)}${capped ? " reached" : ""}`
  }
  return { title, basis, quantity: formatCents(taxable), rate: formatPct(ratePct) }
}

function describeSalary(inputs: Inputs): LineDescription {
  const title = "Salary"
  const scheduled = num(inputs, "scheduledGrossCents")
  const days = num(inputs, "daysEmployed")
  const periodDays = num(inputs, "periodDays")
  if (scheduled === null || days === null || periodDays === null) return { title, basis: null, quantity: null, rate: null }
  const annual = num(inputs, "annualWageCents")
  const annualClause = annual === null ? "" : `, annual pay ${formatCents(annual)}`
  const basis =
    days < periodDays
      ? `Prorated: ${days} of ${periodDays} days of ${formatCents(scheduled)} scheduled pay${annualClause}`
      : `Full period: ${formatCents(scheduled)} scheduled pay${annualClause}`
  return { title, basis, quantity: `${days} of ${periodDays} days`, rate: `${formatCents(scheduled)} / period` }
}

function describeServiceFee(inputs: Inputs): LineDescription {
  const title = "Northwind service fee"
  const ratePct = num(inputs, "ratePct")
  const wage = num(inputs, "wageCents")
  if (ratePct === null || wage === null) return { title, basis: null, quantity: null, rate: null }
  return { title, basis: `${formatPct(ratePct)} of ${formatCents(wage)} wages`, quantity: formatCents(wage), rate: formatPct(ratePct) }
}

function describeHealth(inputs: Inputs): LineDescription {
  const tier = healthTierLabel(text(inputs, "healthTier"))
  const title = tier ? `Employer health contribution — ${tier}` : "Employer health contribution"
  const share = num(inputs, "employerSharePct")
  const premium = num(inputs, "monthlyPremiumCents")
  if (share === null || premium === null) return { title, basis: null, quantity: null, rate: null }
  const plan = text(inputs, "package")
  const planClause = plan ? `${capitalize(plan)} plan ` : ""
  const prorated = daysClause(inputs)
  const basis = `${formatPct(share)} of the ${formatCents(premium)} monthly ${planClause}premium${prorated ? `, ${prorated}` : ""}`
  return { title, basis, quantity: `${formatCents(premium)} / mo`, rate: formatPct(share) }
}

function describeRetirement(inputs: Inputs): LineDescription {
  const title = "401(k) employer match"
  const matchRate = num(inputs, "matchRatePct")
  const deferralPct = num(inputs, "deferralPct")
  const deferral = num(inputs, "deferralCents")
  const cap = num(inputs, "matchCapPct")
  if (matchRate === null || deferralPct === null || deferral === null) return { title, basis: null, quantity: null, rate: null }
  const capClause = cap === null ? "" : `, up to ${formatPct(cap)} of wages`
  return {
    title,
    basis: `Matches ${formatPct(matchRate)} of the employee's ${formatPct(deferralPct)} deferral (${formatCents(deferral)})${capClause}`,
    quantity: formatCents(deferral),
    rate: formatPct(matchRate),
  }
}

function describeDeposit(inputs: Inputs): LineDescription {
  const title = "Security deposit — one month of committed employment cost"
  const monthly = num(inputs, "monthlyCommittedCents")
  if (monthly === null) return { title, basis: null, quantity: null, rate: null }
  const term = num(inputs, "termCommittedCents")
  const capped = term !== null && term < monthly
  const basis = capped
    ? `One month of committed employment cost (${formatCents(monthly)}), capped at the ${formatCents(term)} fixed-term total`
    : `One month of committed employment cost: wages, employer taxes, benefits and the Northwind service fee (${formatCents(monthly)})`
  return { title, basis, quantity: "1 month", rate: `${formatCents(capped ? term : monthly)} / mo` }
}

const DEPOSIT_COMPONENT_TITLE: Partial<Record<InvoiceLineCode, string>> = {
  DEPOSIT_WAGE: "Salary",
  DEPOSIT_SOCIAL_SECURITY: STATUTORY_TITLE.SOCIAL_SECURITY!,
  DEPOSIT_MEDICARE: STATUTORY_TITLE.MEDICARE!,
  DEPOSIT_FUTA: STATUTORY_TITLE.FUTA!,
  DEPOSIT_SUTA: STATUTORY_TITLE.SUTA!,
  DEPOSIT_WORKERS_COMP: STATUTORY_TITLE.WORKERS_COMP!,
  DEPOSIT_SERVICE_FEE: "Northwind service fee",
}

/** One part of the deposit: one month of a cost the quote itemises, in the quote's own words. */
function describeDepositComponent(code: InvoiceLineCode, inputs: Inputs): LineDescription {
  const title = DEPOSIT_COMPONENT_TITLE[code] ?? code
  const quoteBasis = text(inputs, "basis")
  const monthly = num(inputs, "monthlyCommittedCents")
  if (quoteBasis === null || monthly === null) return { title, basis: null, quantity: null, rate: null }
  const annual = num(inputs, "annualCents")
  const term = num(inputs, "termCommittedCents")
  const capped = term !== null && term < monthly
  const clause = capped ? `, scaled down so the deposit stays within the ${formatCents(term)} fixed-term total` : ""
  const basis =
    code === "DEPOSIT_WAGE"
      ? `One month of gross pay${annual === null ? "" : ` (${formatCents(annual)} a year ÷ 12)`}${clause}`
      : `One month at ${quoteBasis}${clause}`
  return { title, basis, quantity: "1 month", rate: null }
}

/**
 * The title, basis and Quantity/Rate columns of one line. The title and basis come from the
 * line's `code` and stored `inputs`; the stored `description` is only the fallback title of a
 * code this function does not know.
 */
export function describeInvoiceLine(line: Pick<InvoiceLine, "code" | "description" | "inputs">): LineDescription {
  const inputs: Inputs = line.inputs && typeof line.inputs === "object" ? (line.inputs as unknown as Inputs) : {}
  switch (line.code) {
    case "SALARY":
      return describeSalary(inputs)
    case "SOCIAL_SECURITY":
    case "MEDICARE":
    case "FUTA":
    case "SUTA":
    case "WORKERS_COMP":
      return describeStatutory(line.code, inputs)
    case "SERVICE_FEE":
      return describeServiceFee(inputs)
    case "HEALTHCARE":
      return describeHealth(inputs)
    case "RETIREMENT":
      return describeRetirement(inputs)
    case "DEPOSIT":
      return describeDeposit(inputs)
    case "DEPOSIT_WAGE":
    case "DEPOSIT_SOCIAL_SECURITY":
    case "DEPOSIT_MEDICARE":
    case "DEPOSIT_FUTA":
    case "DEPOSIT_SUTA":
    case "DEPOSIT_WORKERS_COMP":
    case "DEPOSIT_SERVICE_FEE":
      return describeDepositComponent(line.code, inputs)
    default:
      return { title: line.description, basis: null, quantity: null, rate: null }
  }
}

/** Order the groups print in, top to bottom. */
export const INVOICE_GROUP_ORDER: readonly InvoiceLineGroup[] = ["wage", "statutory", "benefits", "service_fee", "deposit"]

export const INVOICE_GROUP_LABEL: Record<InvoiceLineGroup, string> = {
  wage: "Wages",
  statutory: "Employer payroll taxes",
  benefits: "Benefits",
  service_fee: "Northwind service fee",
  deposit: "Security deposit",
}

export type DescribedLine = LineDescription & Pick<InvoiceLine, "code" | "group" | "amountCents">

export type InvoiceLineGroupView = {
  group: InvoiceLineGroup
  label: string
  lines: DescribedLine[]
  subtotalCents: number
}

/** Lines in the canonical group order with each group's subtotal; empty groups are omitted. */
export function groupInvoiceLines(lines: readonly Pick<InvoiceLine, "code" | "group" | "description" | "amountCents" | "inputs">[]): InvoiceLineGroupView[] {
  const groups: InvoiceLineGroupView[] = []
  for (const group of INVOICE_GROUP_ORDER) {
    const inGroup = lines.filter((line) => line.group === group)
    if (inGroup.length === 0) continue
    groups.push({
      group,
      label: INVOICE_GROUP_LABEL[group],
      lines: inGroup.map((line) => ({
        code: line.code,
        group: line.group,
        amountCents: line.amountCents,
        ...describeInvoiceLine(line),
      })),
      subtotalCents: inGroup.reduce((total, line) => total + line.amountCents, 0),
    })
  }
  return groups
}

/** "Prorated: 9 of 14 days" for a partial period, `null` for a full one or no period. */
export function prorationNote(period: Pick<InvoicePeriod, "daysEmployed" | "periodDays"> | null): string | null {
  if (!period || period.daysEmployed >= period.periodDays) return null
  return `Prorated: ${period.daysEmployed} of ${period.periodDays} days`
}

const VOID_REASON_LABEL: Record<string, string> = {
  order_cancelled: "The order was cancelled",
  terminated: "Employment ended before this pay period",
}

/** Stored void reasons are free text from Finance, except the codes the system writes. */
export function invoiceVoidReasonLabel(reason: string | null): string {
  if (!reason) return "No reason recorded"
  return VOID_REASON_LABEL[reason] ?? reason
}

/** How the deposit is treated, per docs/billing-and-invoicing.md §7 and §10 (no automatic credit or refund). */
export const DEPOSIT_NOTE =
  "The deposit is billed once per hire. It is not credited against payroll invoices automatically; questions about applying or returning it go to your Northwind account manager."

/** The line that explains who an invoice is for when it bills no pay period. */
export const DEPOSIT_PERIOD_LABEL = "Deposit"

export type InvoiceAmountSummary = {
  /** "Amount due" or, once settled, "Amount paid". */
  label: string
  amountCents: number
  /** One line under the amount: the due date, "Paid in full on …", the void reason. */
  note: string
}

/** The prominent figure at the top of an invoice, worded identically on the page and in the PDF. */
export function invoiceAmountSummary(input: {
  status: InvoiceDisplayStatus
  totalCents: number
  paidCents: number
  inProgressCents: number
  dueDate: string
  paidDate: string | null
  voidReason: string | null
}): InvoiceAmountSummary {
  const owed = Math.max(0, input.totalCents - input.paidCents)
  switch (input.status) {
    case "void":
      return { label: "Amount due", amountCents: 0, note: `Void: ${invoiceVoidReasonLabel(input.voidReason)}` }
    case "paid":
      return {
        label: "Amount paid",
        amountCents: input.totalCents,
        note: input.paidDate ? `Paid in full on ${formatIsoDay(input.paidDate)}` : "Paid in full",
      }
    case "processing":
      return {
        label: "Amount due",
        amountCents: owed,
        note: `A payment of ${formatCents(input.inProgressCents)} is processing`,
      }
    case "overdue":
      return { label: "Amount due", amountCents: owed, note: `Overdue: was due ${formatIsoDay(input.dueDate)}` }
    case "open":
      return { label: "Amount due", amountCents: owed, note: `Due ${formatIsoDay(input.dueDate)}` }
  }
}
