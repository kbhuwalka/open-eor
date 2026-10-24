import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, asc, desc, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { createDb, formSubmissions, hireRequests, onboardingCases, payrollEntries, SEED_IDS, SEED_NOW, users, type AppDatabase } from "@/db"
import { nextPayDateAfter } from "@/lib/pay-schedule"
import { isPayslipVisible, payslipSummaryFromDetail, type PayslipDetail } from "@/lib/payslip-view"

import { generatePayslipPdf } from "../documents"
import { decryptFields } from "../field-crypto"
import { createPayDataSource } from "../pay-queries"
import payData, { emptyPayDataSource } from "../pay-queries"
import { payslipInputFromDetail } from "../pay-pdf"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const NOW = SEED_NOW

describe("the empty data source (the reference for 'nothing yet')", () => {
  const now = new Date("2026-04-24T16:00:00Z")

  it("returns an empty dashboard: no slips, no pay date, no account", async () => {
    expect(await emptyPayDataSource.getPayDashboard("any-user", { now })).toEqual({
      taxYear: 2026,
      latestNetPayCents: null,
      latestPayDate: null,
      ytdGrossCents: 0,
      ytdTaxesCents: 0,
      ytdNetCents: 0,
      nextPayDate: null,
      directDeposit: null,
      availableYears: [],
    })
    expect(await emptyPayDataSource.listPayslips("any-user", { year: 2026 }, { now })).toEqual([])
    expect(await emptyPayDataSource.getPayslipDetail("any-user", "ps_1", { now })).toBeNull()
  })

  it("the default export is the real source and re-exports the visibility rule", () => {
    expect(payData).not.toBe(emptyPayDataSource)
    expect(isPayslipVisible("2026-04-24", now)).toBe(true)
    expect(isPayslipVisible("2026-04-25", now)).toBe(false)
  })
})

describe("payData over the seeded world", () => {
  let dir: string
  let db: AppDatabase
  let pay: ReturnType<typeof createPayDataSource>
  let alice: string
  let bob: string
  let nobody: string

  const slipIds = (userId: string) =>
    db.select({ id: payrollEntries.id }).from(payrollEntries).where(eq(payrollEntries.workerUserId, userId)).all().map((row) => row.id)

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-pay-"))
    db = createDb(path.join(dir, "pay.sqlite"), { forceSeed: false })
    pay = createPayDataSource({ getDb: () => db })
    const withSlips = db
      .selectDistinct({ userId: payrollEntries.workerUserId, hireId: payrollEntries.hireId })
      .from(payrollEntries)
      .all()
    const companyOf = (userId: string) => db.select({ id: users.clientCompanyId }).from(users).where(eq(users.id, userId)).get()?.id
    alice = withSlips[0].userId
    bob = withSlips.find((row) => companyOf(row.userId) !== companyOf(alice))!.userId
    nobody = db
      .select({ id: onboardingCases.workerUserId })
      .from(onboardingCases)
      .all()
      .map((row) => row.id)
      .find((id) => slipIds(id).length === 0)!
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const details = async (userId: string, now: Date = NOW) => {
    const dashboard = await pay.getPayDashboard(userId, { now })
    const slips = (await Promise.all(dashboard.availableYears.map((year) => pay.listPayslips(userId, { year }, { now })))).flat()
    return Promise.all(slips.map(async (slip) => (await pay.getPayslipDetail(userId, slip.id, { now }))!))
  }

  it("lists the employee's own slips only, newest pay date first, per tax year", async () => {
    const dashboard = await pay.getPayDashboard(alice, { now: NOW })
    expect(dashboard.availableYears).toEqual([2026])
    const rows = await pay.listPayslips(alice, { year: 2026 }, { now: NOW })
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.map((row) => row.payDate)).toEqual([...rows.map((row) => row.payDate)].sort().reverse())
    expect(rows.map((row) => row.id).sort()).toEqual(slipIds(alice).sort())
    expect(await pay.listPayslips(alice, { year: 2025 }, { now: NOW })).toEqual([])
    expect(await pay.listPayslips(alice, { year: 2027 }, { now: NOW })).toEqual([])
  })

  it("hides a slip before its pay date, shows it from 00:00 Eastern on that day (summer and winter time)", async () => {
    const [first] = db.select().from(payrollEntries).where(eq(payrollEntries.workerUserId, alice)).orderBy(asc(payrollEntries.payDate)).all()
    const day = first.payDate
    const edt = new Date(`${day}T03:59:59Z`)
    const visibleAt = new Date(`${day}T04:00:00Z`)
    expect(await pay.listPayslips(alice, { year: 2026 }, { now: edt })).toEqual([])
    expect(await pay.getPayslipDetail(alice, first.id, { now: edt })).toBeNull()
    expect((await pay.getPayDashboard(alice, { now: edt })).availableYears).toEqual([])
    expect((await pay.listPayslips(alice, { year: 2026 }, { now: visibleAt })).map((row) => row.id)).toContain(first.id)
    expect(await pay.getPayslipDetail(alice, first.id, { now: visibleAt })).toMatchObject({ id: first.id, payDate: day })

    for (const at of [new Date(`${day}T00:00:00Z`), new Date(`${day}T12:00:00Z`), new Date("2027-03-01T00:00:00Z")]) {
      const rows = await pay.listPayslips(alice, { year: 2026 }, { now: at })
      expect(rows.every((row) => isPayslipVisible(row.payDate, at))).toBe(true)
    }
  })

  it("every detail adds up: gross = deductions + taxes + net, earnings sum to gross; lists equal the details", async () => {
    for (const userId of [alice, bob]) {
      const all = await details(userId)
      expect(all.length).toBeGreaterThan(3)
      for (const slip of all) {
        const deductions = slip.totals.deductions.currentCents
        expect(slip.gross.currentCents, slip.id).toBe(deductions + slip.totals.taxes.currentCents + slip.net.currentCents)
        expect(sum(slip.earnings.map((line) => line.currentCents))).toBe(slip.gross.currentCents)
        expect(sum(slip.taxes.map((line) => line.currentCents))).toBe(slip.totals.taxes.currentCents)
        expect(slip.taxableWages.currentCents).toBe(slip.gross.currentCents - slip.totals.preTaxDeductions.currentCents)
        expect(slip.paymentMethod).toMatch(/^(Checking|Savings) ••\d{4}$/)
        expect(slip.employee.ssnMasked).toMatch(/^\*{3}-\*{2}-\d{4}$/)
        expect(slip.employee.roleTitle).toBeTruthy()
        expect(slip.taxYear).toBe(Number(slip.payDate.slice(0, 4)))
      }
      const rows = await pay.listPayslips(userId, { year: 2026 }, { now: NOW })
      expect(rows).toEqual(all.filter((slip) => slip.taxYear === 2026).map(payslipSummaryFromDetail))
    }
  })

  it("year to date is chained from the stored run: it equals the sum of the employee's visible slips", async () => {
    for (const userId of [alice, bob]) {
      const all = (await details(userId)).sort((a, b) => a.payDate.localeCompare(b.payDate))
      let gross = 0
      let net = 0
      let taxes = 0
      for (const slip of all) {
        gross += slip.gross.currentCents
        net += slip.net.currentCents
        taxes += slip.totals.taxes.currentCents
        expect(slip.gross.ytdCents, slip.payDate).toBe(gross)
        expect(slip.net.ytdCents).toBe(net)
        expect(slip.totals.taxes.ytdCents).toBe(taxes)
      }
      const dashboard = await pay.getPayDashboard(userId, { now: NOW })
      expect(dashboard).toMatchObject({ ytdGrossCents: gross, ytdNetCents: net, ytdTaxesCents: taxes })
      expect(dashboard.latestNetPayCents).toBe(all.at(-1)!.net.currentCents)
      expect(dashboard.latestPayDate).toBe(all.at(-1)!.payDate)
      expect(dashboard.taxYear).toBe(2026)
    }
  })

  it("an earlier clock sees a shorter history whose YTD still equals the sum of what it shows", async () => {
    const all = (await details(alice)).sort((a, b) => a.payDate.localeCompare(b.payDate))
    const third = all[2]
    const at = new Date(`${third.payDate}T12:00:00Z`)
    const seen = await details(alice, at)
    expect(seen).toHaveLength(3)
    const dashboard = await pay.getPayDashboard(alice, { now: at })
    expect(dashboard.ytdGrossCents).toBe(sum(seen.map((slip) => slip.gross.currentCents)))
    expect(dashboard.latestPayDate).toBe(third.payDate)
  })

  it("an employee never reads another's slips: a foreign id is null, exactly like an unknown one", async () => {
    const aliceIds = new Set(slipIds(alice))
    const bobIds = slipIds(bob)
    expect(bobIds.length).toBeGreaterThan(0)
    for (const id of bobIds) {
      expect(await pay.getPayslipDetail(alice, id, { now: NOW })).toBeNull()
      expect(aliceIds.has(id)).toBe(false)
    }
    expect(await pay.getPayslipDetail(alice, "payslip:nope:1", { now: NOW })).toBeNull()
    expect(await pay.getPayslipDetail(bob, bobIds[0], { now: NOW })).toMatchObject({ id: bobIds[0] })
    const aliceRows = await pay.listPayslips(alice, { year: 2026 }, { now: NOW })
    expect(aliceRows.some((row) => bobIds.includes(row.id))).toBe(false)
  })

  it("people who are not employees, unknown ids and employees without slips read as nothing", async () => {
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.finance, SEED_IDS.users.specialist, "user_nope", ""]) {
      expect(await pay.listPayslips(userId, { year: 2026 }, { now: NOW })).toEqual([])
      const dashboard = await pay.getPayDashboard(userId, { now: NOW })
      expect(dashboard).toMatchObject({ latestNetPayCents: null, nextPayDate: null, directDeposit: null, availableYears: [], ytdGrossCents: 0 })
    }
    expect(await pay.getPayslipDetail(SEED_IDS.users.clientHr, slipIds(alice)[0], { now: NOW })).toBeNull()
    expect(await pay.listPayslips(nobody, { year: 2026 }, { now: NOW })).toEqual([])
    expect((await pay.getPayDashboard(nobody, { now: NOW })).availableYears).toEqual([])
  })

  it("the next pay date comes from the hire's dates: a Friday after today; a new hire sees their first one", async () => {
    const dashboard = await pay.getPayDashboard(alice, { now: NOW })
    const hire = db
      .select({ start: hireRequests.startDate, end: hireRequests.endDate })
      .from(onboardingCases)
      .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
      .where(eq(onboardingCases.workerUserId, alice))
      .get()!
    expect(dashboard.nextPayDate).toBe(nextPayDateAfter(NOW, { startDate: hire.start!, endDate: hire.end }))
    if (dashboard.nextPayDate) {
      expect(dashboard.nextPayDate > "2026-10-24").toBe(true)
      expect(new Date(`${dashboard.nextPayDate}T00:00:00Z`).getUTCDay()).toBe(5)
    }
    const newHire = await pay.getPayDashboard(nobody, { now: NOW })
    expect(newHire.availableYears).toEqual([])
  })

  it("the direct-deposit label is the account type and last four digits; no full number or SSN is ever returned", async () => {
    for (const userId of [alice, bob]) {
      const caseId = db.select({ id: onboardingCases.id }).from(onboardingCases).where(eq(onboardingCases.workerUserId, userId)).get()!.id
      const deposit = db
        .select()
        .from(formSubmissions)
        .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, "direct_deposit")))
        .get()!
      const stored = JSON.parse(deposit.dataJson) as { accountType: string; last4: string }
      const secrets = decryptFields(deposit.encryptedJson!) as { accountNumber: string; routingNumber: string }
      const w4 = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, "w4"))).get()!
      const ssn = String(decryptFields(w4.encryptedJson!).ssn)

      const dashboard = await pay.getPayDashboard(userId, { now: NOW })
      expect(dashboard.directDeposit).toEqual({ label: `${stored.accountType === "checking" ? "Checking" : "Savings"} ••${stored.last4}` })
      const everything = JSON.stringify([dashboard, await pay.listPayslips(userId, { year: 2026 }, { now: NOW }), await details(userId)])
      expect(everything).not.toContain(secrets.accountNumber)
      expect(everything).not.toContain(secrets.routingNumber)
      expect(everything).not.toContain(ssn)
      expect(everything).not.toContain(ssn.replace(/\D/g, ""))
      expect(everything).toContain(`***-**-${ssn.replace(/\D/g, "").slice(-4)}`)
    }
  })

  it("prints a real pay slip PDF for a stored slip", async () => {
    const [slip] = await details(alice)
    const bytes = await generatePayslipPdf(payslipInputFromDetail(slip), { now: NOW })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
  })

  it("falls back to the stored totals for a row whose run output cannot be read, still adding up", async () => {
    const [row] = db.select().from(payrollEntries).where(eq(payrollEntries.workerUserId, bob)).orderBy(desc(payrollEntries.payDate)).all()
    db.update(payrollEntries).set({ withholdingJson: "{}" }).where(eq(payrollEntries.id, row.id)).run()
    const slip = (await pay.getPayslipDetail(bob, row.id, { now: NOW })) as PayslipDetail
    expect(slip.gross.currentCents).toBe(row.grossCents)
    expect(slip.net.currentCents).toBe(row.netCents)
    expect(slip.totals.taxes.currentCents).toBe(row.taxesCents)
    expect(slip.gross.currentCents).toBe(slip.totals.deductions.currentCents + slip.totals.taxes.currentCents + slip.net.currentCents)
    expect(slip.net.ytdCents).toBeGreaterThanOrEqual(slip.net.currentCents)
  })
})
