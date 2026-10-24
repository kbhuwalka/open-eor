// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import { readCompanyDocument } from "@/server/master-agreement"
import { sessionUser } from "@/server/__tests__/helpers"

import { createDb, type AppDatabase } from "../client"
import { clientAgreements, companyDocumentSignatures, companyDocuments, onboardingCases, tasks as tasksTable, users } from "../schema"
import { SEED_COMPANIES, SEED_IDS, SEED_ROSTER, seedDemo } from "../seed"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("seedDemo: signed agreements through the production signing path", () => {
  const SLOW = 90_000

  async function demoDb(): Promise<AppDatabase> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-demo-"))
    tempDirs.push(dir)
    const db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false, seed: false })
    await seedDemo(db, { force: false })
    return db
  }

  it("stores a verifiable signed document for every signed agreement, downloadable by its client and by Northwind", async () => {
    const db = await demoDb()
    const agreements = db.select().from(clientAgreements).all()
    expect(agreements).toHaveLength(SEED_COMPANIES.length)

    for (const company of SEED_COMPANIES) {
      const agreement = agreements.find((row) => row.clientCompanyId === company.id)!
      expect(agreement.status).toBe("signed")
      const documents = db.select().from(companyDocuments).where(eq(companyDocuments.clientCompanyId, company.id)).all()
      expect(documents, company.name).toHaveLength(1)
      const [document] = documents
      expect(document).toMatchObject({ kind: "master_agreement", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
      expect(document.preSignatureSha256).toMatch(/^[0-9a-f]{64}$/)

      const signatures = db.select().from(companyDocumentSignatures).where(eq(companyDocumentSignatures.documentId, document.id)).all()
      expect(signatures).toHaveLength(1)
      expect(signatures[0]).toMatchObject({ party: "client", signerUserId: company.hr, typedName: signatures[0].signerName })

      for (const viewer of [company.hr, SEED_IDS.users.specialist]) {
        const result = await readCompanyDocument(db, sessionUser(db, viewer), document.id)
        expect(result, `${company.name} as ${viewer}`).toMatchObject({ ok: true, sha256: document.sha256 })
      }
      const other = SEED_COMPANIES.find((candidate) => candidate.id !== company.id)!
      expect(await readCompanyDocument(db, sessionUser(db, other.hr), document.id)).toMatchObject({ ok: false, reason: "not_found" })
    }
  }, SLOW)

  it("orders nothing against an unsigned agreement: no agreement task is ever open, and the people are the same as the synchronous seed", async () => {
    const db = await demoDb()
    const agreementTasks = db.select().from(tasksTable).all().filter((task) => task.type === "accept_agreement")
    expect(agreementTasks.length).toBeGreaterThan(0)
    expect(agreementTasks.every((task) => task.status === "skipped")).toBe(true)
    expect(db.select().from(onboardingCases).all()).toHaveLength(SEED_ROSTER.length)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-sync-"))
    tempDirs.push(dir)
    const synchronous = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
    expect(db.select().from(users).all().length).toBe(synchronous.select().from(users).all().length)
  }, SLOW)

  it("repeats: the same ids, times and agreement metadata come out of a second seed", async () => {
    const [first, second] = [await demoDb(), await demoDb()]
    const summary = (db: AppDatabase) =>
      db
        .select()
        .from(companyDocuments)
        .all()
        .map((row) => ({ id: row.id, company: row.clientCompanyId, createdAt: row.createdAt.getTime(), fileName: row.fileName }))
        .sort((a, b) => a.id.localeCompare(b.id))
    expect(summary(first)).toEqual(summary(second))
    expect(summary(first).map((row) => row.id)).toEqual(["cdoc_seed_001", "cdoc_seed_003", "cdoc_seed_005"])
  }, SLOW)

  it("a failed signing leaves no half-seeded demo behind", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-demo-"))
    tempDirs.push(dir)
    const db = createDb(path.join(dir, "test.sqlite"), { forceSeed: false, seed: false })
    const original = db.transaction.bind(db)
    let calls = 0
    // The second transaction is the one that creates the people; make it fail.
    ;(db as unknown as { transaction: typeof db.transaction }).transaction = ((fn: never, ...rest: never[]) => {
      calls += 1
      if (calls === 2) throw new Error("boom")
      return original(fn, ...rest)
    }) as typeof db.transaction
    await expect(seedDemo(db, { force: false })).rejects.toThrow("boom")
    ;(db as unknown as { transaction: typeof db.transaction }).transaction = original
    expect(db.select().from(users).all()).toHaveLength(0)
  }, SLOW)
})
