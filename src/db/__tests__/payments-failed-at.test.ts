import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createDb, type AppDatabase } from "../client"
import { payments } from "../schema"

let dir: string
let file: string
let db: AppDatabase

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-failed-at-"))
  file = path.join(dir, "test.sqlite")
  db = createDb(file, { forceSeed: false })
})
afterAll(() => {
  db.$client.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("payments.failed_at", () => {
  it("is the failure time of a seeded failed payment, and settled_at is empty for it", () => {
    const failed = db.select().from(payments).all().filter((row) => row.status === "failed")
    expect(failed.length).toBeGreaterThan(0)
    for (const row of failed) {
      expect(row.failedAt, row.id).toBeInstanceOf(Date)
      expect(row.settledAt, row.id).toBeNull()
      expect(row.failureReason, row.id).toBeTruthy()
    }
  })

  it("keeps failed_at empty on every other payment", () => {
    const others = db.select().from(payments).all().filter((row) => row.status !== "failed")
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((row) => row.failedAt === null)).toBe(true)
    expect(others.filter((row) => row.status === "succeeded").every((row) => row.settledAt instanceof Date)).toBe(true)
  })

  it("migrates a database from before the column: the old failure time moves out of settled_at", () => {
    const failedId = db.select().from(payments).all().find((row) => row.status === "failed")!.id
    const failedAt = db.select().from(payments).all().find((row) => row.id === failedId)!.failedAt as Date
    db.$client.close()

    const old = new Database(file)
    old.exec("ALTER TABLE payments DROP COLUMN failed_at")
    old.prepare("UPDATE payments SET settled_at = ? WHERE id = ?").run(failedAt.getTime(), failedId)
    old.close()

    db = createDb(file, { forceSeed: false })
    const row = db.select().from(payments).all().find((r) => r.id === failedId)!
    expect(row.failedAt?.getTime()).toBe(failedAt.getTime())
    expect(row.settledAt).toBeNull()
    expect(row.status).toBe("failed")
  })

  it("leaves a settled payment's settled_at alone when migrating", () => {
    const succeeded = db.select().from(payments).all().filter((row) => row.status === "succeeded")
    expect(succeeded.every((row) => row.settledAt instanceof Date && row.failedAt === null)).toBe(true)
  })
})
