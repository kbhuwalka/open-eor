import { describe, expect, it } from "vitest"

import {
  employeeHealthPremiumPerPeriod,
  employerHealthCostPerPeriod,
  employerRetirementMatch,
  US_2026,
} from "../../cost-rates"
import { annualizeWageCents, buildQuote, costsForPeriod, assumedBenefitElections } from "../../quote"
import { billingRun, ytdWageFromInvoices } from "../billing-run"
import {
  allocateCents,
  depositAmountCents,
  employmentEndDate,
  formatInvoiceNumber,
  generateDepositInvoice,
  generatePayrollInvoice,
  nextInvoiceSequence,
  parseInvoiceNumber,
} from "../invoice"
import { daysEmployedInPeriod, payPeriodContaining, periodsForTaxYear } from "../pay-calendar"
import {
  DECLINED_ELECTIONS,
  type BenefitElectionState,
  type BillingHire,
  type Invoice,
  type InvoiceLine,
  type PayrollLineInputs,
} from "../types"
import { baseHire, between, isoFromDays, mulberry32, randomHire } from "./helpers"

const companies = [{ id: "client_1" }, { id: "client_2" }]
const FAR_FUTURE = "2035-01-01"

const defaultElections: BenefitElectionState = {
  enrolled: true,
  healthTier: "employee",
  retirementDeferralPct: US_2026.retirement401k.defaultDeferralPct,
}

function run(hire: BillingHire, elections: BenefitElectionState, today = FAR_FUTURE, existing: Invoice[] = []) {
  return billingRun({ companies, hires: [hire], elections: { [hire.hireId]: elections }, existingInvoices: existing, today })
}

const payroll = (invoices: Invoice[]) => invoices.filter((i) => i.kind === "payroll")
const total = (invoices: Invoice[]) => invoices.reduce((sum, i) => sum + i.totalCents, 0)
const lineSum = (invoices: Invoice[], code: string) =>
  invoices.reduce((sum, i) => sum + (i.lines.find((l) => l.code === code)?.amountCents ?? 0), 0)
const lineOf = (invoice: Invoice, code: string) => {
  const found = invoice.lines.find((l) => l.code === code)
  if (!found) throw new Error(`missing line ${code}`)
  return found as InvoiceLine & { inputs: PayrollLineInputs }
}

function quoteOf(hire: BillingHire) {
  return buildQuote({
    wageCents: hire.wageCents,
    wageUnit: hire.wageUnit,
    stateCode: hire.stateCode,
    package: hire.package,
    markupPct: hire.markupPct,
    ...(hire.termEndDate ? { term: { startDate: hire.startDate, endDate: hire.termEndDate } } : {}),
  })
}

describe("invoice numbers", () => {
  it("formats, parses and continues the sequence per year", () => {
    expect(formatInvoiceNumber(2026, 7)).toBe("INV-2026-0007")
    expect(formatInvoiceNumber(2026, 12345)).toBe("INV-2026-12345")
    expect(parseInvoiceNumber("INV-2026-0007")).toEqual({ year: 2026, sequence: 7 })
    expect(parseInvoiceNumber("2026-7")).toBeNull()
    expect(nextInvoiceSequence([], 2026)).toBe(1)
    expect(nextInvoiceSequence(["INV-2026-0003", "INV-2025-0099", "INV-2026-0010", "junk"], 2026)).toBe(11)
    expect(nextInvoiceSequence(["INV-2026-0003"], 2027)).toBe(1)
  })
})

describe("generatePayrollInvoice", () => {
  const hire: BillingHire = { ...baseHire, wageCents: 15_000_000, stateCode: "CA", startDate: "2025-12-15" }
  const period = periodsForTaxYear(2026)[1]

  it("bills salary, each statutory cost, benefits and the service fee, with auditable inputs", () => {
    const invoice = generatePayrollInvoice({
      company: { id: "client_1" },
      hire,
      period,
      ytdWageCents: 576_923,
      elections: defaultElections,
      number: "INV-2026-0001",
    })
    expect(invoice.lines.map((l) => l.code)).toEqual([
      "SALARY",
      "SOCIAL_SECURITY",
      "MEDICARE",
      "FUTA",
      "SUTA",
      "WORKERS_COMP",
      "SERVICE_FEE",
      "HEALTHCARE",
      "RETIREMENT",
    ])
    expect(invoice.totalCents).toBe(invoice.lines.reduce((s, l) => s + l.amountCents, 0))
    expect(invoice).toMatchObject({
      id: `payroll:hire_1:${period.index}`,
      number: "INV-2026-0001",
      kind: "payroll",
      issueDate: period.issueDate,
      dueDate: period.dueDate,
      rateSetId: "us-2026",
      payCalendarId: "us-biweekly-v1",
      status: "open",
    })
    for (const line of invoice.lines) {
      expect(line.inputs).toMatchObject({ rateSetId: "us-2026", ytdWageCents: 576_923 })
    }
    const gross = lineOf(invoice, "SALARY").amountCents
    expect(gross).toBe(576_923)
    expect(lineOf(invoice, "MEDICARE").inputs).toMatchObject({ wageCents: gross, ratePct: 1.45, wageBaseCents: null })
    expect(lineOf(invoice, "SUTA").inputs).toMatchObject({ ratePct: 3.4, wageBaseCents: 700_000, taxableWageCents: 123_077 })
    expect(lineOf(invoice, "SUTA").amountCents).toBe(Math.round((123_077 * 3.4) / 100))
    expect(lineOf(invoice, "SERVICE_FEE").amountCents).toBe(Math.round(gross * 0.15))
    expect(lineOf(invoice, "HEALTHCARE").amountCents).toBe(
      employerHealthCostPerPeriod({ package: "standard", tier: "employee" }),
    )
    expect(lineOf(invoice, "RETIREMENT").inputs).toMatchObject({ deferralPct: 4, matchRatePct: 50, matchCapPct: 4 })
  })

  it("recomputes every line from its stored inputs", () => {
    const invoice = generatePayrollInvoice({
      company: { id: "client_1" },
      hire,
      period,
      ytdWageCents: 650_000,
      elections: defaultElections,
      number: "INV-2026-0001",
    })
    const costs = costsForPeriod({
      annualWageCents: annualizeWageCents(hire.wageCents, hire.wageUnit),
      indexInTaxYear: period.indexInTaxYear,
      daysEmployed: 14,
      ytdWageCents: 650_000,
      stateCode: "CA",
      package: "standard",
      markupPct: 15,
      benefits: assumedBenefitElections(),
    })
    expect(lineOf(invoice, "SALARY").amountCents).toBe(costs.grossCents)
    expect(lineOf(invoice, "SUTA").amountCents).toBe(costs.statutory.SUTA)
    expect(lineOf(invoice, "SUTA").inputs).toMatchObject({ taxableWageCents: 50_000 })
  })

  it("omits benefit lines unless the person is enrolled in them", () => {
    const make = (elections: BenefitElectionState) =>
      generatePayrollInvoice({ company: { id: "client_1" }, hire, period, ytdWageCents: 0, elections, number: "n" })
    const declined = make(DECLINED_ELECTIONS)
    expect(declined.lines.some((l) => l.group === "benefits")).toBe(false)
    const healthOnly = make({ enrolled: true, healthTier: "family", retirementDeferralPct: null })
    expect(healthOnly.lines.map((l) => l.code)).toContain("HEALTHCARE")
    expect(healthOnly.lines.map((l) => l.code)).not.toContain("RETIREMENT")
    expect(lineOf(healthOnly, "HEALTHCARE").amountCents).toBe(
      employerHealthCostPerPeriod({ package: "standard", tier: "family" }),
    )
    const notEnrolledButChose = make({ enrolled: false, healthTier: "family", retirementDeferralPct: 6 })
    expect(notEnrolledButChose.lines.some((l) => l.group === "benefits")).toBe(false)
    expect(total([healthOnly]) - total([declined])).toBe(lineOf(healthOnly, "HEALTHCARE").amountCents)
  })

  it("refuses a period the person does not work", () => {
    expect(() =>
      generatePayrollInvoice({
        company: { id: "client_1" },
        hire: { ...hire, startDate: "2026-06-01" },
        period,
        ytdWageCents: 0,
        elections: DECLINED_ELECTIONS,
        number: "n",
      }),
    ).toThrow(RangeError)
  })

  it("prorates the first period by calendar days ÷ 14 and ends on the last working day", () => {
    const hourly: BillingHire = { ...baseHire, wageCents: 5000, wageUnit: "hourly", startDate: "2026-10-22", termEndDate: "2026-11-18" }
    const invoices = payroll(run(hourly, DECLINED_ELECTIONS))
    expect(invoices.map((i) => i.period!.daysEmployed)).toEqual([11, 14, 3])
    // 80 h × $50 = $4,000 per full period; 11 of 14 days.
    expect(lineOf(invoices[0], "SALARY").amountCents).toBe(Math.round((400_000 * 11) / 14))
    expect(lineOf(invoices[1], "SALARY").amountCents).toBe(400_000)
    expect(invoices[2].period).toMatchObject({ start: "2026-11-16", end: "2026-11-29" })
    expect(lineOf(invoices[2], "SALARY").amountCents).toBe(Math.round((400_000 * 3) / 14))
  })
})

describe("employmentEndDate", () => {
  it("is the earlier of the term end and a last working day", () => {
    expect(employmentEndDate({ termEndDate: null, lastWorkingDay: null })).toBeNull()
    expect(employmentEndDate({ termEndDate: "2026-12-31", lastWorkingDay: null })).toBe("2026-12-31")
    expect(employmentEndDate({ termEndDate: "2026-12-31", lastWorkingDay: "2026-11-13" })).toBe("2026-11-13")
    expect(employmentEndDate({ termEndDate: null, lastWorkingDay: "2026-11-13" })).toBe("2026-11-13")
  })
})

describe("quote == invoices, to the cent", () => {
  it("equals the fixed-term quote for random hires, with and without benefits", () => {
    const rand = mulberry32(2026)
    for (let n = 0; n < 150; n++) {
      const hire = randomHire(rand, `hire_${n}`)
      if (!hire.termEndDate) continue
      const quote = quoteOf(hire)
      const withoutBenefits = payroll(run(hire, DECLINED_ELECTIONS))
      expect(total(withoutBenefits), JSON.stringify(hire)).toBe(quote.term!.committedCents)
      const withBenefits = payroll(run(hire, defaultElections))
      expect(total(withBenefits), JSON.stringify(hire)).toBe(quote.term!.withBenefitsCents)
    }
  })

  it("equals the quote for a person terminated before the term ends, priced as a shorter term", () => {
    const hire: BillingHire = { ...baseHire, startDate: "2026-11-02", termEndDate: "2027-06-30", lastWorkingDay: "2027-02-12" }
    const shorter = buildQuote({
      wageCents: hire.wageCents,
      wageUnit: hire.wageUnit,
      stateCode: hire.stateCode,
      package: hire.package,
      markupPct: hire.markupPct,
      term: { startDate: "2026-11-02", endDate: "2027-02-12" },
    })
    expect(total(payroll(run(hire, DECLINED_ELECTIONS)))).toBe(shorter.term!.committedCents)
  })

  it("the 26 invoices of a full tax year equal the indefinite quote annual figure", () => {
    const rand = mulberry32(99)
    for (let n = 0; n < 40; n++) {
      const hire: BillingHire = {
        ...randomHire(rand, `year_${n}`),
        termEndDate: null,
        startDate: periodsForTaxYear(2026)[0].start,
        hiredOn: "2025-11-01",
      }
      const lastIssue = periodsForTaxYear(2026)[25].issueDate
      const year = payroll(run(hire, defaultElections, lastIssue))
      expect(year).toHaveLength(26)
      const quote = quoteOf(hire)
      const byCode = (code: string) => quote.lines.find((l) => l.code === code)!.annualCents
      expect(lineSum(year, "SALARY")).toBe(annualizeWageCents(hire.wageCents, hire.wageUnit))
      expect(lineSum(year, "SALARY")).toBe(byCode("WAGE"))
      for (const code of ["SOCIAL_SECURITY", "MEDICARE", "FUTA", "SUTA", "WORKERS_COMP", "SERVICE_FEE", "HEALTHCARE", "RETIREMENT"]) {
        expect(lineSum(year, code), `${code} ${JSON.stringify(hire)}`).toBe(byCode(code))
      }
      expect(total(year)).toBe(quote.totals.withBenefits.annualCents)
      expect(total(year) - lineSum(year, "HEALTHCARE") - lineSum(year, "RETIREMENT")).toBe(quote.totals.committed.annualCents)
    }
  })

  it("a 27-pay-date year bills 27 invoices; the first 26 equal the quote and the 27th repeats the first period", () => {
    const hire: BillingHire = { ...baseHire, startDate: "2026-12-14", hiredOn: "2026-11-01", stateCode: "NY" }
    const periods = periodsForTaxYear(2027)
    expect(periods).toHaveLength(27)
    const invoices = payroll(run(hire, DECLINED_ELECTIONS, periods[26].issueDate)).filter((i) => i.period!.taxYear === 2027)
    expect(invoices).toHaveLength(27)
    expect(total(invoices.slice(0, 26))).toBe(quoteOf(hire).totals.committed.annualCents)
    expect(lineOf(invoices[26], "SALARY").amountCents).toBe(lineOf(invoices[0], "SALARY").amountCents)
    // Wage bases were consumed long before the 27th pay date.
    expect(lineOf(invoices[26], "SOCIAL_SECURITY").amountCents).toBe(
      Math.round((lineOf(invoices[26], "SALARY").amountCents * 6.2) / 100),
    )
    expect(lineOf(invoices[26], "SUTA").amountCents).toBe(0)
  })

  it("is the same calculation the cost calculator uses: an indefinite quote ignores the term", () => {
    const hire: BillingHire = { ...baseHire, termEndDate: null }
    const open = quoteOf(hire)
    const fixed = quoteOf({ ...hire, termEndDate: "2026-12-31" })
    expect(open.term).toBeUndefined()
    expect(open.lines.find((l) => l.code === "WAGE")).toEqual(fixed.lines.find((l) => l.code === "WAGE"))
  })
})

describe("year-to-date wages and wage bases", () => {
  it("resets year-to-date wages by the year of the pay date, not the work date", () => {
    // Pay date Fri 2027-01-01 for work Dec 14–27 2026: a new tax year, so SUTA is charged again.
    const hire: BillingHire = { ...baseHire, wageCents: 5_200_000, startDate: "2026-08-10", termEndDate: "2027-01-31" }
    const invoices = payroll(run(hire, DECLINED_ELECTIONS))
    const byPayDate = new Map(invoices.map((i) => [i.period!.payDate, i]))
    const lastOf2026 = byPayDate.get("2026-12-18")!
    const firstOf2027 = byPayDate.get("2027-01-01")!
    expect(lastOf2026.period!.taxYear).toBe(2026)
    expect(firstOf2027.period).toMatchObject({ start: "2026-12-14", end: "2026-12-27", taxYear: 2027 })
    expect(lineOf(firstOf2027, "SALARY").inputs.ytdWageCents).toBe(0)
    expect(lineOf(lastOf2026, "SALARY").inputs.ytdWageCents).toBeGreaterThan(0)
    // TX unemployment: 2.7% of the first $9,000; $2,000 a period, so $9,000 is reached in the fifth.
    const suta2026 = invoices.filter((i) => i.period!.taxYear === 2026).map((i) => lineOf(i, "SUTA").inputs.taxableWageCents)
    expect(suta2026.reduce((a, b) => (a as number) + (b as number), 0)).toBe(900_000)
    expect(lineOf(firstOf2027, "SUTA").inputs.taxableWageCents).toBe(200_000)
    expect(ytdWageFromInvoices(invoices, hire.hireId, 2027, firstOf2027.period!.index + 1)).toBe(200_000)
  })

  it("stops FUTA, SUTA and Social Security at the right pay period when the wage base is crossed", () => {
    const hire: BillingHire = { ...baseHire, wageCents: 40_000_000, stateCode: "CA", startDate: "2025-12-15" }
    const invoices = payroll(run(hire, DECLINED_ELECTIONS, periodsForTaxYear(2026)[25].issueDate))
    const taxable = (code: string) => invoices.map((i) => lineOf(i, code).inputs.taxableWageCents as number)
    // $40,000,000 ÷ 26 = $15,384.62 a period.
    const gross = invoices.map((i) => lineOf(i, "SALARY").amountCents)
    const ytdBefore = (n: number) => gross.slice(0, n).reduce((a, b) => a + b, 0)
    const crossing = (cap: number) => gross.findIndex((_, n) => ytdBefore(n + 1) >= cap)

    const ssCross = crossing(US_2026.socialSecurity.annualWageBaseCents)
    expect(ssCross).toBe(11)
    taxable("SOCIAL_SECURITY").forEach((t, n) => {
      if (n < ssCross) expect(t).toBe(gross[n])
      if (n === ssCross) expect(t).toBe(US_2026.socialSecurity.annualWageBaseCents - ytdBefore(n))
      if (n > ssCross) expect(t).toBe(0)
    })
    // The first period alone (about $15,385) exceeds the $7,000 bases of FUTA and California SUTA.
    expect(taxable("FUTA")).toEqual([700_000, ...Array(25).fill(0)])
    expect(taxable("SUTA")).toEqual([700_000, ...Array(25).fill(0)])
    // Medicare and workers' comp have no cap.
    expect(taxable("MEDICARE")).toEqual(gross)
  })

  it("spreads a low wage's unemployment base over several periods", () => {
    // $52,000 a year = $2,000 a period; FUTA base $7,000 → 2,000 / 2,000 / 2,000 / 1,000.
    const hire: BillingHire = { ...baseHire, wageCents: 5_200_000, stateCode: "TX", startDate: "2025-12-15" }
    const invoices = payroll(run(hire, DECLINED_ELECTIONS, periodsForTaxYear(2026)[10].issueDate))
    expect(invoices.slice(0, 6).map((i) => lineOf(i, "FUTA").inputs.taxableWageCents)).toEqual([200_000, 200_000, 200_000, 100_000, 0, 0])
    expect(invoices.slice(0, 6).map((i) => lineOf(i, "FUTA").amountCents)).toEqual([1_200, 1_200, 1_200, 600, 0, 0])
    expect(invoices.slice(0, 6).map((i) => lineOf(i, "SUTA").inputs.taxableWageCents)).toEqual([200_000, 200_000, 200_000, 200_000, 100_000, 0])
  })
})

describe("benefit helpers", () => {
  it("splits each premium between employer and employee without losing a cent", () => {
    for (const pkg of ["standard", "premium"] as const) {
      for (const tier of ["employee", "employee_spouse", "employee_children", "family"] as const) {
        const employer = employerHealthCostPerPeriod({ package: pkg, tier })
        const employee = employeeHealthPremiumPerPeriod({ package: pkg, tier })
        const { monthlyPremiumCents, employerSharePct } = US_2026.packages[pkg].health[tier]
        expect(employer + employee).toBe(Math.round((monthlyPremiumCents * 12) / 26))
        expect(employer).toBe(Math.round((Math.round((monthlyPremiumCents * 12) / 26) * employerSharePct) / 100))
        expect(employee).toBeGreaterThan(0)
      }
    }
    // Employee-only keeps the previous quote's $558 / $800 a month employer cost, per pay period.
    expect(employerHealthCostPerPeriod({ package: "standard", tier: "employee" })).toBe(25_754)
    expect(employerHealthCostPerPeriod({ package: "premium", tier: "employee" })).toBe(36_923)
  })

  it("matches 50% / 100% of deferrals up to 4% of pay, so the default deferral gives 2% / 4%", () => {
    const standard = employerRetirementMatch({ package: "standard", grossCents: 1_000_000, ytdWageCents: 0, deferralPct: 4 })
    expect(standard).toEqual({ deferralCents: 40_000, matchCents: 20_000 })
    const premium = employerRetirementMatch({ package: "premium", grossCents: 1_000_000, ytdWageCents: 0, deferralPct: 4 })
    expect(premium).toEqual({ deferralCents: 40_000, matchCents: 40_000 })
    // Deferring more than the cap earns no more; deferring less earns a match on what is deferred.
    expect(employerRetirementMatch({ package: "standard", grossCents: 1_000_000, ytdWageCents: 0, deferralPct: 10 }).matchCents).toBe(20_000)
    expect(employerRetirementMatch({ package: "standard", grossCents: 1_000_000, ytdWageCents: 0, deferralPct: 2 }).matchCents).toBe(10_000)
    expect(employerRetirementMatch({ package: "standard", grossCents: 1_000_000, ytdWageCents: 0, deferralPct: 0 })).toEqual({ deferralCents: 0, matchCents: 0 })
  })

  it("stops deferrals and the match at the annual IRS elective deferral limit", () => {
    // 20% of $150,000 a year would be $30,000, above the $24,500 limit.
    const hire: BillingHire = { ...baseHire, wageCents: 15_000_000, startDate: "2025-12-15" }
    const invoices = payroll(
      run(hire, { enrolled: true, healthTier: null, retirementDeferralPct: 20 }, periodsForTaxYear(2026)[25].issueDate),
    )
    const deferrals = invoices.map((i) => lineOf(i, "RETIREMENT").inputs.deferralCents as number)
    expect(deferrals.reduce((a, b) => a + b, 0)).toBe(US_2026.retirement401k.annualElectiveDeferralLimitCents)
    expect(deferrals[0]).toBe(Math.round(0.2 * lineOf(invoices[0], "SALARY").amountCents))
    expect(deferrals[25]).toBe(0)
    const matches = invoices.map((i) => lineOf(i, "RETIREMENT").amountCents)
    expect(matches[25]).toBe(0)
    expect(matches[0]).toBeGreaterThan(0)
  })

  it("ignores pay above the IRS compensation limit when matching", () => {
    const top = employerRetirementMatch({
      package: "premium",
      grossCents: 3_000_000,
      ytdWageCents: 35_000_000,
      deferralPct: 4,
    })
    // Only $10,000 of the $30,000 period pay is under the $360,000 limit: 4% match on $10,000.
    expect(top.matchCents).toBe(Math.round(0.04 * 1_000_000))
    expect(employerRetirementMatch({ package: "premium", grossCents: 3_000_000, ytdWageCents: 36_000_000, deferralPct: 4 }).matchCents).toBe(0)
  })
})

describe("deposit invoice", () => {
  it("is one month of the committed total", () => {
    const quote = quoteOf({ ...baseHire, termEndDate: null })
    const invoice = generateDepositInvoice({
      company: { id: "client_1" },
      hireId: "hire_1",
      quote,
      issueDate: "2026-10-01",
      number: "INV-2026-0001",
    })
    expect(invoice).toMatchObject({ id: "deposit:hire_1", kind: "deposit", period: null, issueDate: "2026-10-01", dueDate: "2026-10-08" })
    expect(invoice.totalCents).toBe(quote.totals.committed.monthlyCents)
    expect(invoice.lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(invoice.totalCents)
    expect(invoice.lines[0].inputs).toMatchObject({ monthlyCommittedCents: quote.totals.committed.monthlyCents, termCommittedCents: null })
  })

  it("itemises the deposit: one line for the salary, each employer tax and the service fee, summing to the deposit exactly", () => {
    const quote = quoteOf({ ...baseHire, termEndDate: null })
    const invoice = generateDepositInvoice({ company: { id: "client_1" }, hireId: "hire_1", quote, issueDate: "2026-10-01", number: "INV-2026-0001" })
    expect(invoice.lines.map((l) => l.code)).toEqual([
      "DEPOSIT_WAGE",
      "DEPOSIT_SOCIAL_SECURITY",
      "DEPOSIT_MEDICARE",
      "DEPOSIT_FUTA",
      "DEPOSIT_SUTA",
      "DEPOSIT_WORKERS_COMP",
      "DEPOSIT_SERVICE_FEE",
    ])
    expect(invoice.lines.every((l) => l.group === "deposit")).toBe(true)
    expect(invoice.lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(depositAmountCents(quote))
    const committed = quote.lines.filter((l) => l.group !== "benefits")
    invoice.lines.forEach((line, i) => {
      expect(line.inputs).toMatchObject({ annualCents: committed[i].annualCents, basis: committed[i].basis })
      expect(Math.abs(line.amountCents - committed[i].monthlyCents)).toBeLessThanOrEqual(1)
    })
    expect(invoice.lines.find((l) => l.code === "DEPOSIT_WAGE")!.amountCents).toBe(Math.round(committed[0].annualCents / 12))
  })

  it("scales every component down in proportion when a short term caps the deposit", () => {
    const quote = quoteOf({ ...baseHire, startDate: "2026-10-26", termEndDate: "2026-10-28" })
    const invoice = generateDepositInvoice({ company: { id: "client_1" }, hireId: "hire_1", quote, issueDate: "2026-10-01", number: "INV-2026-0001" })
    expect(invoice.totalCents).toBe(quote.term!.committedCents)
    expect(invoice.lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(invoice.totalCents)
    expect(invoice.lines).toHaveLength(7)
    const wage = invoice.lines[0].amountCents
    const fee = invoice.lines[6].amountCents
    const quoteWage = quote.lines.find((l) => l.code === "WAGE")!.annualCents
    const quoteFee = quote.lines.find((l) => l.code === "SERVICE_FEE")!.annualCents
    expect(Math.abs(wage / fee - quoteWage / quoteFee)).toBeLessThan(0.05)
  })

  it("sums to the deposit exactly for any hire (randomised)", () => {
    const random = mulberry32(2026)
    for (let i = 0; i < 200; i += 1) {
      const hire = randomHire(random, `deposit_${i}`)
      const quote = quoteOf(hire)
      const invoice = generateDepositInvoice({ company: { id: "client_1" }, hireId: hire.hireId, quote, issueDate: "2026-10-01", number: "INV-2026-0001" })
      expect(invoice.lines.reduce((sum, l) => sum + l.amountCents, 0), hire.hireId).toBe(invoice.totalCents)
      expect(invoice.totalCents).toBe(depositAmountCents(quote))
      expect(invoice.lines.every((l) => Number.isSafeInteger(l.amountCents) && l.amountCents >= 0)).toBe(true)
    }
  })

  it("is capped at the term total for a very short fixed term", () => {
    const quote = quoteOf({ ...baseHire, startDate: "2026-10-26", termEndDate: "2026-10-28" })
    expect(quote.term!.committedCents).toBeLessThan(quote.totals.committed.monthlyCents)
    expect(depositAmountCents(quote)).toBe(quote.term!.committedCents)
    const long = quoteOf({ ...baseHire, startDate: "2026-10-26", termEndDate: "2027-10-25" })
    expect(depositAmountCents(long)).toBe(long.totals.committed.monthlyCents)
  })
})

describe("allocateCents", () => {
  it("splits in proportion to the weights and adds up exactly", () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocateCents(10, [3, 0, 7])).toEqual([3, 0, 7])
    expect(allocateCents(0, [5, 5])).toEqual([0, 0])
    const random = mulberry32(7)
    for (let i = 0; i < 300; i += 1) {
      const weights = Array.from({ length: between(random, 1, 9) }, () => between(random, 0, 5_000_000))
      const totalCents = between(random, 0, 9_000_000)
      const shares = allocateCents(totalCents, weights)
      if (weights.some((w) => w > 0)) expect(shares.reduce((a, b) => a + b, 0)).toBe(totalCents)
      shares.forEach((share, j) => {
        expect(Number.isInteger(share)).toBe(true)
        if (weights[j] === 0) expect(share).toBe(0)
      })
    }
  })

  it("gives nothing to nobody", () => {
    expect(allocateCents(500, [])).toEqual([])
    expect(allocateCents(500, [0, 0])).toEqual([0, 0])
  })
})

describe("billingRun", () => {
  const hire: BillingHire = { ...baseHire, startDate: "2026-10-22", termEndDate: null }

  it("plans a deposit, then one invoice per pay period whose issue date has come", () => {
    const planned = run(hire, DECLINED_ELECTIONS, "2026-11-13")
    expect(planned.map((i) => [i.kind, i.issueDate])).toEqual([
      ["deposit", "2026-10-01"],
      ["payroll", "2026-10-30"],
      ["payroll", "2026-11-13"],
    ])
    expect(planned.map((i) => i.number)).toEqual(["INV-2026-0001", "INV-2026-0002", "INV-2026-0003"])
    expect(run(hire, DECLINED_ELECTIONS, "2026-09-30")).toEqual([])
    expect(run(hire, DECLINED_ELECTIONS, "2026-10-29").map((i) => i.kind)).toEqual(["deposit"])
  })

  it("is idempotent and deterministic, and later runs only add what is new", () => {
    const first = run(hire, defaultElections, "2026-12-01")
    expect(run(hire, defaultElections, "2026-12-01")).toEqual(first)
    expect(run(hire, defaultElections, "2026-12-01", first)).toEqual([])
    const later = run(hire, defaultElections, "2027-03-01", first)
    expect(later.every((i) => i.issueDate > "2026-12-01")).toBe(true)
    expect([...first, ...later]).toEqual(run(hire, defaultElections, "2027-03-01"))
    expect(new Set([...first, ...later].map((i) => i.id)).size).toBe(first.length + later.length)
    expect(new Set([...first, ...later].map((i) => i.number)).size).toBe(first.length + later.length)
  })

  it("continues invoice numbers after existing ones and restarts them each issue year", () => {
    const first = run(hire, DECLINED_ELECTIONS, "2026-12-31")
    const existing = first.slice(0, 2)
    const rest = run(hire, DECLINED_ELECTIONS, "2027-01-30", existing)
    expect(rest[0].number).toBe(formatInvoiceNumber(2026, 3))
    expect(rest.at(-1)!.number).toBe("INV-2027-0002")
    expect(rest.filter((i) => i.issueDate.startsWith("2027"))).toHaveLength(2)
  })

  it("derives year-to-date from earlier invoices, so a gap-free sequence matches a single run", () => {
    const all = run(hire, DECLINED_ELECTIONS, "2027-02-01")
    const half = all.filter((i) => i.issueDate <= "2026-12-01")
    const rest = run(hire, DECLINED_ELECTIONS, "2027-02-01", half)
    expect([...half, ...rest]).toEqual(all)
  })

  it("bills nothing for void-blocked periods again, and ignores void invoices for year-to-date", () => {
    const all = run(hire, DECLINED_ELECTIONS, "2026-12-01")
    const voided = all.map((i) => (i.id === all[2].id ? { ...i, status: "void" as const } : i))
    expect(run(hire, DECLINED_ELECTIONS, "2026-12-01", voided)).toEqual([])
    const next = run(hire, DECLINED_ELECTIONS, "2026-12-15", voided)
    expect(next).toHaveLength(1)
    expect(ytdWageFromInvoices(voided, hire.hireId, 2026, next[0].period!.index)).toBeLessThan(
      ytdWageFromInvoices(all, hire.hireId, 2026, next[0].period!.index),
    )
  })

  it("stops at the term end or the last working day, with a prorated last period", () => {
    const ending: BillingHire = { ...hire, termEndDate: "2026-11-20", lastWorkingDay: "2026-11-11" }
    const invoices = payroll(run(ending, DECLINED_ELECTIONS))
    expect(invoices.map((i) => i.period!.daysEmployed)).toEqual([11, 10])
    expect(invoices.at(-1)!.period).toMatchObject({ start: "2026-11-02", end: "2026-11-15" })
    expect(daysEmployedInPeriod(payPeriodContaining("2026-11-11"), ending.startDate, "2026-11-11")).toBe(10)
    const shortTerm = payroll(run({ ...ending, termEndDate: "2026-11-04", lastWorkingDay: "2026-11-20" }, DECLINED_ELECTIONS))
    expect(shortTerm.map((i) => i.period!.daysEmployed)).toEqual([11, 3])
  })

  it("bills only known companies and bills undeclared elections as not enrolled", () => {
    const other: BillingHire = { ...hire, hireId: "hire_x", companyId: "client_unknown" }
    const planned = billingRun({
      companies,
      hires: [hire, other],
      elections: {},
      existingInvoices: [],
      today: "2026-11-01",
    })
    expect(planned.every((i) => i.hireId === "hire_1")).toBe(true)
    expect(planned.some((i) => i.lines.some((l) => l.group === "benefits"))).toBe(false)
  })

  it("plans many hires of many companies at once, in issue-date order with unique numbers", () => {
    const rand = mulberry32(5)
    const hires = Array.from({ length: 30 }, (_, n) => randomHire(rand, `h${n}`))
    const planned = billingRun({ companies, hires, elections: {}, existingInvoices: [], today: "2027-06-30" })
    const issueDates = planned.map((i) => i.issueDate)
    expect(issueDates).toEqual([...issueDates].sort())
    expect(new Set(planned.map((i) => i.number)).size).toBe(planned.length)
    expect(new Set(planned.map((i) => i.id)).size).toBe(planned.length)
    expect(billingRun({ companies, hires, elections: {}, existingInvoices: planned, today: "2027-06-30" })).toEqual([])
    for (const hire of hires) {
      const own = planned.filter((i) => i.hireId === hire.hireId && i.kind === "payroll")
      for (const invoice of own) {
        expect(invoice.period!.daysEmployed).toBeGreaterThanOrEqual(1)
        expect(invoice.period!.daysEmployed).toBeLessThanOrEqual(14)
        expect(invoice.issueDate <= "2027-06-30").toBe(true)
        expect(invoice.totalCents).toBe(invoice.lines.reduce((s, l) => s + l.amountCents, 0))
      }
      const starts = own.map((i) => i.period!.index)
      expect(starts).toEqual([...starts].sort((a, b) => a - b))
      if (starts.length > 1) expect(starts.at(-1)! - starts[0]).toBe(starts.length - 1)
    }
  })
})

describe("random hires: billing run sums equal the quote", () => {
  it("holds for hires that start and end on any weekday, in any state", () => {
    const rand = mulberry32(31337)
    for (let n = 0; n < 100; n++) {
      const start = isoFromDays("2026-01-01", between(rand, 0, 600))
      const hire: BillingHire = {
        ...randomHire(rand, `r${n}`),
        startDate: start,
        termEndDate: isoFromDays(start, between(rand, 1, 400)),
        hiredOn: isoFromDays(start, -7),
      }
      const quote = quoteOf(hire)
      const invoices = payroll(run(hire, defaultElections))
      expect(total(invoices)).toBe(quote.term!.withBenefitsCents)
      expect(lineSum(invoices, "SALARY") + lineSum(invoices, "SERVICE_FEE") + ["SOCIAL_SECURITY", "MEDICARE", "FUTA", "SUTA", "WORKERS_COMP"].reduce((s, c) => s + lineSum(invoices, c), 0)).toBe(
        quote.term!.committedCents,
      )
    }
  })
})
