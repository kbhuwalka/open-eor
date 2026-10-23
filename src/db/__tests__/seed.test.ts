import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createDb, resetDbSingletonForTests } from "../client"
import {
  assertSeedWorld,
  SEED_DOCUMENT_PATH,
  SEED_IDS,
} from "../seed"
import { caseDocuments, onboardingCases, users } from "../schema"
import { eq } from "drizzle-orm"

describe("seed world", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    resetDbSingletonForTests()
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("loads 4 users and a pending_review case with a document", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-"))
    tempDirs.push(dir)
    const db = createDb(path.join(dir, "test.sqlite"))

    const summary = assertSeedWorld(db)
    expect(summary.userCount).toBe(4)
    expect(summary.pendingCaseId).toBe(SEED_IDS.case)

    const roles = db
      .select()
      .from(users)
      .all()
      .map((u) => u.role)
      .sort()
    expect(roles).toEqual(
      ["client_hr", "eor_ops", "eor_reviewer", "worker"].sort()
    )

    const pending = db
      .select()
      .from(onboardingCases)
      .where(eq(onboardingCases.id, SEED_IDS.case))
      .get()
    expect(pending?.state).toBe("pending_review")

    const doc = db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.caseId, SEED_IDS.case))
      .get()
    expect(doc?.storagePath).toBe(SEED_DOCUMENT_PATH)
    expect(fs.existsSync(path.join(process.cwd(), SEED_DOCUMENT_PATH))).toBe(
      true
    )
  })
})
