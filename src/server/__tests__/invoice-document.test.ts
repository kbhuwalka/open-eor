// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const { requirePortalUser } = vi.hoisted(() => ({ requirePortalUser: vi.fn() }))
const holder = vi.hoisted(() => ({ finance: null as unknown }))

vi.mock("@/auth", () => ({ requirePortalUser }))
vi.mock("@/server/finance-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/finance-queries")>()),
  get financeQueries() {
    return holder.finance
  },
}))

import { createDb, invoices, SEED_IDS, SEED_NOW, type AppDatabase } from "@/db"
import { formatCents } from "@/lib/format"
import { groupInvoiceLines } from "@/lib/invoice-lines"

import { InvoiceView } from "@/app/client/finance/invoices/[id]/invoice-view"
import { allText, extractPages } from "../documents/__tests__/pdf-text"
import { generateInvoicePdf } from "../documents"
import { createFinanceQueries } from "../finance-queries"
import { invoiceDetailFromSource, invoicePdfInputFromSource, loadInvoiceDocument, loadInvoiceDocumentSource } from "../invoice-document"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const ACME = SEED_IDS.client
const BRIGHTWAVE = SEED_IDS.client2

describe("the invoice document over the seeded world", () => {
  let dir: string
  let db: AppDatabase
  let finance: ReturnType<typeof createFinanceQueries>

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-invoice-doc-"))
    db = createDb(path.join(dir, "invoice-document.sqlite"), { forceSeed: false })
    finance = createFinanceQueries({ getDb: () => db, now: () => SEED_NOW })
    holder.finance = finance
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
  beforeEach(() => requirePortalUser.mockReset())

  const loadInvoiceSource = (id: string) => loadInvoiceDocumentSource(db, id, { companyId: null })!

  const idsOf = (companyId: string) => db.select({ id: invoices.id }).from(invoices).where(eq(invoices.companyId, companyId)).all().map((r) => r.id)

  it("loads every invoice of the company with lines that add up, a person and a service period", async () => {
    const ids = idsOf(ACME)
    expect(ids.length).toBeGreaterThan(20)
    for (const id of ids) {
      const detail = loadInvoiceDocument(db, id, { companyId: ACME }, SEED_NOW)!
      expect(detail, id).not.toBeNull()
      expect(detail.person.name.length).toBeGreaterThan(0)
      expect(detail.person.title).toBeTruthy()
      expect(detail.person.workState).toBeTruthy()
      expect(detail.person).not.toHaveProperty("startDate")
      expect(detail).not.toHaveProperty("terms")
      expect(detail.client.name).toBe("Acme Robotics")
      expect(detail.groups.reduce((total, g) => total + g.subtotalCents, 0)).toBe(detail.totalCents)
      if (detail.kind === "payroll") expect(detail.period).not.toBeNull()
      else expect(detail.period).toBeNull()
      for (const line of detail.groups.flatMap((g) => g.lines)) expect(line.title).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })

  it("never returns another company's invoice, however it is asked for", async () => {
    const acmeId = idsOf(ACME)[0]
    const brightwaveId = idsOf(BRIGHTWAVE)[0]
    expect(loadInvoiceDocument(db, acmeId, { companyId: BRIGHTWAVE }, SEED_NOW)).toBeNull()
    expect(loadInvoiceDocumentSource(db, acmeId, { companyId: BRIGHTWAVE })).toBeNull()
    expect(await finance.getInvoiceDetail(BRIGHTWAVE, acmeId)).toBeNull()
    expect(await finance.getInvoicePdfInput(BRIGHTWAVE, acmeId)).toBeNull()
    expect(await finance.getInvoiceDetail(ACME, brightwaveId)).toBeNull()
    expect(await finance.getInvoiceDetail("", acmeId)).toBeNull()
    expect(await finance.getInvoiceDetail(ACME, "payroll:nope:1")).toBeNull()
    expect((await finance.getInvoiceDetail(ACME, acmeId))?.id).toBe(acmeId)
  })

  it("lets Finance (scope null, after its own role check) open any company's invoice", () => {
    for (const id of [idsOf(ACME)[0], idsOf(BRIGHTWAVE)[0]]) {
      expect(loadInvoiceDocument(db, id, { companyId: null }, SEED_NOW)?.id).toBe(id)
    }
  })

  it("the page renders the session client's invoice and is a 404 for another company's", async () => {
    const acmeId = idsOf(ACME)[0]
    requirePortalUser.mockResolvedValue({ id: SEED_IDS.users.clientHr, clientCompanyId: ACME })
    const element = await InvoiceView({ params: Promise.resolve({ id: acmeId }) })
    expect(element.props.invoice.id).toBe(acmeId)

    requirePortalUser.mockResolvedValue({ id: SEED_IDS.users.clientHr2, clientCompanyId: BRIGHTWAVE })
    await expect(InvoiceView({ params: Promise.resolve({ id: acmeId }) })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404"),
    })
    await expect(InvoiceView({ params: Promise.resolve({ id: encodeURIComponent("payroll:nope:1") }) })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404"),
    })
  })

  it("the page decodes an encoded id", async () => {
    const id = idsOf(ACME).find((candidate) => candidate.includes(":"))!
    requirePortalUser.mockResolvedValue({ id: SEED_IDS.users.clientHr, clientCompanyId: ACME })
    const element = await InvoiceView({ params: Promise.resolve({ id: encodeURIComponent(id) }) })
    expect(element.props.invoice.id).toBe(id)
  })

  it("every stored line of every seeded invoice is its own row on the page model and in the PDF, and the rows add up to the total", async () => {
    const deposits: string[] = []
    for (const id of [...idsOf(ACME), ...idsOf(BRIGHTWAVE)]) {
      const source = loadInvoiceSource(id)
      const stored = source.invoice.lines
      const detail = invoiceDetailFromSource(source, SEED_NOW)
      const rows = detail.groups.flatMap((group) => group.lines)
      expect(rows.map((row) => row.code), id).toEqual(expect.arrayContaining(stored.map((line) => line.code)))
      expect(rows, id).toHaveLength(stored.length)
      expect(rows.reduce((total, row) => total + row.amountCents, 0), id).toBe(detail.totalCents)
      expect(stored.reduce((total, line) => total + line.amountCents, 0), id).toBe(source.invoice.totalCents)
      if (detail.kind === "deposit") {
        deposits.push(id)
        expect(stored.map((line) => line.code), id).toEqual(
          expect.arrayContaining(["DEPOSIT_WAGE", "DEPOSIT_SOCIAL_SECURITY", "DEPOSIT_MEDICARE", "DEPOSIT_FUTA", "DEPOSIT_SUTA", "DEPOSIT_WORKERS_COMP", "DEPOSIT_SERVICE_FEE"]),
        )
      } else {
        for (const code of ["SALARY", "SOCIAL_SECURITY", "MEDICARE", "FUTA", "SUTA", "WORKERS_COMP", "SERVICE_FEE"]) {
          expect(stored.map((line) => line.code), `${id} ${code}`).toContain(code)
        }
      }
      const pages = await extractPages(await generateInvoicePdf(invoicePdfInputFromSource(source, SEED_NOW)))
      const flat = pages.flat()
      for (const row of rows) expect(flat, `${id} ${row.code}`).toContain(formatCents(row.amountCents))
      expect(flat[flat.indexOf("Total") + 1], id).toBe(formatCents(detail.totalCents))
    }
    expect(deposits.length).toBeGreaterThan(3)
  })

  it("the PDF prints the page's facts, and both equal the stored total", async () => {
    const samples = idsOf(ACME).filter((_, i) => i % 9 === 0).slice(0, 8)
    expect(samples.length).toBeGreaterThan(3)
    const kinds = new Set<string>()
    for (const id of samples) {
      const source = loadInvoiceDocumentSource(db, id, { companyId: ACME })!
      const detail = loadInvoiceDocument(db, id, { companyId: ACME }, SEED_NOW)!
      kinds.add(detail.kind)
      const pages = await extractPages(await generateInvoicePdf(invoicePdfInputFromSource(source, SEED_NOW)))
      const text = allText(pages)
      const printed = text.replace(/[\u2013\u2014]/g, "-").replace(/\s*\n\s*/g, " ")
      expect(text, id).toContain(detail.person.name)
      expect(text).toContain(detail.person.title!)
      if (detail.period) expect(text).toContain(detail.period.start.slice(8).replace(/^0/, ""))
      for (const group of groupInvoiceLines(source.invoice.lines)) {
        for (const line of group.lines) {
          expect(printed, `${id} ${line.title}`).toContain(line.title.replace(/[\u2013\u2014]/g, "-"))
          expect(text).toContain(formatCents(line.amountCents))
        }
      }
      const flat = pages.flat()
      expect(flat[flat.indexOf("Total") + 1], id).toBe(formatCents(detail.totalCents))
      expect(source.invoice.totalCents).toBe(detail.totalCents)
    }
    expect(kinds.size).toBeGreaterThan(0)
  })
})
