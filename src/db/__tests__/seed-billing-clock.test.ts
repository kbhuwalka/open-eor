import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * The seed replays billing up to its clock (`SEED_NOW`, fixed when the module loads). Payroll
 * invoices go out a week before the pay date and carry their pay slip, so a slip with a future pay
 * date exists in the data; it must stay hidden until its pay date, a day that turns over at Eastern
 * midnight (8:30pm Eastern is already the next day in UTC).
 */
async function seedAt(instant: string) {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(instant))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-clock-"))
  const { createDb } = await import("../client")
  const schema = await import("../schema")
  const seed = await import("../seed")
  const queries = await import("@/server/billing-queries")
  const { sessionUser } = await import("@/server/__tests__/helpers")
  const { businessDayOf } = await import("@/domain/business-time")
  const db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
  vi.useRealTimers()
  return { db, dir, schema, seed, queries, sessionUser, today: businessDayOf(seed.SEED_NOW) }
}

const dirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe.each([
  ["8:30pm Eastern on a billing day, already the next day in UTC", "2026-10-31T00:30:00.000Z", "2026-10-30"],
  ["11:30pm Eastern the evening before a pay date", "2026-11-06T03:30:00.000Z", "2026-11-05"],
])("seeded billing at %s", (_label, instant, expectedToday) => {
  it("bills only through the Eastern business day and keeps every event inside the seed clock", async () => {
    const { db, dir, schema, seed, today } = await seedAt(instant)
    dirs.push(dir)
    expect(today).toBe(expectedToday)

    const invoiceRows = db.select().from(schema.invoices).all()
    const payroll = invoiceRows.filter((row) => row.kind === "payroll")
    expect(payroll.length).toBeGreaterThan(0)
    expect(payroll.every((row) => row.issueDate <= today)).toBe(true)
    expect(payroll.some((row) => row.issueDate === today)).toBe(expectedToday === "2026-10-30")

    for (const payment of db.select().from(schema.payments).all()) {
      for (const at of [payment.initiatedAt, payment.settledAt, payment.failedAt]) {
        if (at) expect(at.getTime(), payment.id).toBeLessThanOrEqual(seed.SEED_NOW.getTime())
      }
    }
  }, 60_000)

  it("hides slips whose pay date is still ahead from every worker", async () => {
    const { db, dir, schema, queries, sessionUser, today, seed } = await seedAt(instant)
    dirs.push(dir)
    const entries = db.select().from(schema.payrollEntries).all()
    const ahead = entries.filter((entry) => entry.payDate > today)
    if (expectedToday === "2026-10-30") expect(ahead.length).toBeGreaterThan(0)

    const workers = [...new Set(entries.map((entry) => entry.workerUserId))]
    let visible = 0
    for (const workerId of workers) {
      const actor = sessionUser(db, workerId)
      const slips = queries.listPaySlips(db, actor, {}, seed.SEED_NOW)
      visible += slips.length
      expect(slips.every((slip) => slip.payDate <= today), workerId).toBe(true)
      for (const hidden of ahead.filter((entry) => entry.workerUserId === workerId)) {
        expect(slips.some((slip) => slip.id === hidden.id)).toBe(false)
        expect(queries.paySlipDetail(db, actor, hidden.id, seed.SEED_NOW)).toBeNull()
      }
    }
    expect(visible).toBe(entries.filter((entry) => entry.payDate <= today).length)
  }, 60_000)
})
