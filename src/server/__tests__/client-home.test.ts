import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, describe, expect, it } from "vitest"

import { createDb, hireRequests, onboardingCases, SEED_IDS, type AppDatabase } from "@/db"
import { isPayableRow, type InvoiceRow } from "@/lib/finance-view"
import { DEFAULT_PEOPLE_QUERY } from "@/lib/people-query"

import { loadClientHome } from "../client-home"
import { createFinanceQueries } from "../finance-queries"
import { listPeople } from "../queries"
import { attentionFor } from "../task-inbox"
import { sessionUser, tempDbFactory } from "./helpers"

/** The read-only tests share one seeded database; the one that pays gets its own. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-client-home-"))
let shared: AppDatabase | null = null
const open = () => (shared ??= createDb(path.join(dir, "test.sqlite"), { forceSeed: false }))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const NOW = new Date()
const CLIENTS = [
  { userId: SEED_IDS.users.clientHr, companyId: SEED_IDS.client },
  { userId: SEED_IDS.users.clientHr2, companyId: SEED_IDS.client2 },
  { userId: SEED_IDS.users.clientHr3, companyId: SEED_IDS.client3 },
]

function caseIdsOf(db: AppDatabase, companyId: string): Set<string> {
  return new Set(
    db
      .select({ caseId: onboardingCases.id })
      .from(onboardingCases)
      .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
      .where(eq(hireRequests.clientCompanyId, companyId))
      .all()
      .map((row) => row.caseId),
  )
}

const financeFor = (db: AppDatabase, now = NOW) => createFinanceQueries({ getDb: () => db, now: () => now })

const sum = (rows: readonly InvoiceRow[]) => rows.reduce((total, row) => total + row.totalCents, 0)

/** What the Invoices card stands for, computed independently: payable, less the deposits To do pays. */
const payableOutsideTodo = (invoices: readonly InvoiceRow[], depositCases: ReadonlySet<string>) =>
  invoices.filter((row) => isPayableRow(row) && !(row.kind === "deposit" && depositCases.has(row.caseId)))

describe("loadClientHome", () => {
  it("lists the client's own open tasks in To do, most urgent first", async () => {
    const db = open()
    const user = sessionUser(db, SEED_IDS.users.clientHr)
    const home = await loadClientHome({ db, finance: financeFor(db) }, user, NOW)
    const inbox = attentionFor(db, user, NOW)
    expect(home.todo.items.map((item) => item.row.id)).toEqual(inbox.rows.map((row) => row.id))
    expect(home.todo.total).toBe(inbox.total)
    expect(home.todo.items.length).toBeGreaterThan(0)
  })

  it("shows each deposit once: in To do, never also in the Invoices card total", async () => {
    const db = open()
    const user = sessionUser(db, SEED_IDS.users.clientHr)
    const finance = financeFor(db)
    const home = await loadClientHome({ db, finance }, user, NOW)
    const depositCases = new Set(home.todo.items.filter((item) => item.row.type === "pay_deposit").map((item) => item.row.caseId))
    expect(depositCases.size).toBeGreaterThan(0)
    const card = payableOutsideTodo(await finance.listClientInvoices(SEED_IDS.client), depositCases)
    expect(home.invoices).toEqual({
      count: card.length,
      totalCents: sum(card),
      overdueCents: sum(card.filter((row) => row.displayStatus === "overdue")),
      overdueCount: card.filter((row) => row.displayStatus === "overdue").length,
    })
  })

  it("counts the onboarding and at-risk people the People list shows under its filters", async () => {
    const db = open()
    for (const { userId, companyId } of CLIENTS) {
      const home = await loadClientHome({ db, finance: financeFor(db) }, sessionUser(db, userId), NOW)
      const listed = (patch: object) => listPeople(db, companyId, { ...DEFAULT_PEOPLE_QUERY, ...patch }, NOW).total
      expect(home.people, userId).toEqual({ onboarding: listed({ status: "onboarding" }), atRisk: listed({ atRisk: true }) })
    }
    const home = await loadClientHome({ db, finance: financeFor(db) }, sessionUser(db, SEED_IDS.users.clientHr), NOW)
    expect(home.people.atRisk).toBeGreaterThan(0)
  })

  it("gives each To do row its hire's start date", async () => {
    const db = open()
    const home = await loadClientHome({ db, finance: financeFor(db) }, sessionUser(db, SEED_IDS.users.clientHr), NOW)
    for (const item of home.todo.items) {
      const hire = db
        .select({ startDate: hireRequests.startDate })
        .from(onboardingCases)
        .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
        .where(eq(onboardingCases.id, item.row.caseId))
        .get()
      expect(item.startDate, item.row.caseId).toBe(hire?.startDate ?? null)
    }
  })

  it("never counts another company's invoices", async () => {
    const db = open()
    for (const { userId, companyId } of CLIENTS) {
      const finance = financeFor(db)
      const home = await loadClientHome({ db, finance }, sessionUser(db, userId), NOW)
      const own = caseIdsOf(db, companyId)
      const invoices = await finance.listClientInvoices(companyId)
      for (const row of invoices) expect(own.has(row.caseId), `${userId} ${row.number}`).toBe(true)
      const inTodo = new Set(home.todo.items.filter((item) => item.row.type === "pay_deposit").map((item) => item.row.caseId))
      expect(home.invoices?.totalCents ?? 0, userId).toBe(sum(payableOutsideTodo(invoices, inTodo)))
    }
  })

  it("loads nothing about money or people for a user without a company", async () => {
    const db = open()
    const orphan = { ...sessionUser(db, SEED_IDS.users.clientHr), clientCompanyId: null }
    const home = await loadClientHome({ db, finance: financeFor(db) }, orphan, NOW)
    expect(home.invoices).toBeNull()
    expect(home.people).toEqual({ onboarding: 0, atRisk: 0 })
  })

  describe("after paying", () => {
    const freshDb = tempDbFactory("eor-client-home-pay-")

    it("drops the paid deposit from To do and the paid invoices from the card, which then has nothing due", async () => {
      const db = freshDb()
      const user = sessionUser(db, SEED_IDS.users.clientHr)
      const finance = financeFor(db)
      const before = await loadClientHome({ db, finance }, user, NOW)
      const depositRow = before.todo.items.find((item) => item.row.type === "pay_deposit")!.row
      const deposit = (await finance.listClientInvoices(SEED_IDS.client)).find(
        (row) => row.kind === "deposit" && row.caseId === depositRow.caseId && row.displayStatus !== "paid",
      )!
      const rest = payableOutsideTodo(
        await finance.listClientInvoices(SEED_IDS.client),
        new Set(before.todo.items.filter((item) => item.row.type === "pay_deposit").map((item) => item.row.caseId)),
      )
      const paid = await finance.payInvoices(SEED_IDS.client, [deposit.id, ...rest.map((row) => row.id)], {
        userId: user.id,
        displayName: user.displayName,
      })
      expect(paid.ok).toBe(true)

      const after = await loadClientHome({ db, finance }, user, NOW)
      expect(after.todo.items.map((item) => item.row.id)).not.toContain(depositRow.id)
      expect(after.todo.total).toBe(before.todo.total - 1)
      expect(after.invoices).toBeNull()
    })
  })
})
