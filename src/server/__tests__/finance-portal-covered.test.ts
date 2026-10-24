import { describe, expect, it } from "vitest"

import { SEED_IDS } from "@/db"
import { DomainError } from "@/domain/types"

import { listFinancePayments } from "../billing-queries"
import { coveredInvoicesByPayment } from "../finance-portal-covered"

import { sessionUser, tempDbFactory } from "./helpers"

const openDb = tempDbFactory("eor-finance-covered-")

describe("coveredInvoicesByPayment", () => {
  it("lists, per payment, the same invoices the payments list shows, each with its person and share", () => {
    const db = openDb()
    const actor = sessionUser(db, SEED_IDS.users.finance)
    const rows = [
      ...listFinancePayments(db, actor, { status: "initiated", pageSize: 100 }).rows,
      ...listFinancePayments(db, actor, { status: "succeeded", pageSize: 100 }).rows,
    ]
    expect(rows.length).toBeGreaterThan(0)
    const covered = coveredInvoicesByPayment(db, actor, rows.map((row) => row.id))
    for (const row of rows) {
      const invoices = covered[row.id] ?? []
      expect(invoices.map((invoice) => invoice.id).sort()).toEqual(row.invoices.map((invoice) => invoice.id).sort())
      expect(invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0)).toBe(row.totalCents)
      for (const invoice of invoices) {
        expect(invoice.personName).toBeTruthy()
        expect(invoice.number).toBeTruthy()
      }
    }
  })

  it("asks for nothing when there are no payments", () => {
    const db = openDb()
    expect(coveredInvoicesByPayment(db, sessionUser(db, SEED_IDS.users.finance), [])).toEqual({})
  })

  it("is Finance only", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    expect(() => coveredInvoicesByPayment(db, specialist, ["pay_x"])).toThrow(DomainError)
  })
})
