import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"

import { createDb, resolveDbPath } from "../client"
import {
  clientAgreements,
  clientCompanies,
  onboardingCases,
  users,
} from "../schema"
import { SEED_IDS, SEED_TIMES } from "../seed"

describe("schema constraints", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  function openDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-schema-"))
    tempDirs.push(dir)
    const dbPath = path.join(dir, "test.sqlite")
    return { db: createDb(dbPath, { forceSeed: false }), dbPath }
  }

  it("rejects a user whose tenant link does not match the role", () => {
    const { db } = openDb()
    const base = {
      role: "worker" as const,
      displayName: "Pat",
      email: "pat@worker.example",
      createdAt: SEED_TIMES.created,
    }
    expect(() =>
      db
        .insert(users)
        .values({
          ...base,
          id: "user_both",
          clientCompanyId: SEED_IDS.client,
          providerId: SEED_IDS.provider,
        })
        .run()
    ).toThrow()
    expect(() =>
      db
        .insert(users)
        .values({
          ...base,
          id: "user_neither",
          email: "pat2@worker.example",
          clientCompanyId: null,
          providerId: null,
        })
        .run()
    ).toThrow()
    expect(() =>
      db
        .insert(users)
        .values({
          ...base,
          id: "user_wrong_side",
          email: "pat3@worker.example",
          role: "worker",
          clientCompanyId: null,
          providerId: SEED_IDS.provider,
        })
        .run()
    ).toThrow()
  })

  it("requires signed_at iff the agreement is signed, and one agreement per client", () => {
    const { db } = openDb()
    db.insert(clientCompanies)
      .values({
        id: "client_2",
        providerId: SEED_IDS.provider,
        name: "Other",
        createdAt: SEED_TIMES.created,
      })
      .run()

    expect(() =>
      db
        .insert(clientAgreements)
        .values({
          id: "agreement_open",
          clientCompanyId: "client_2",
          markupPct: 15,
          status: "signed",
          signedAt: null,
          createdAt: SEED_TIMES.created,
        })
        .run()
    ).toThrow()

    expect(() =>
      db
        .insert(clientAgreements)
        .values({
          id: "agreement_draft_dated",
          clientCompanyId: "client_2",
          markupPct: 15,
          status: "draft",
          signedAt: SEED_TIMES.created,
          createdAt: SEED_TIMES.created,
        })
        .run()
    ).toThrow()

    expect(() =>
      db
        .insert(clientAgreements)
        .values({
          id: "agreement_dup",
          clientCompanyId: SEED_IDS.client,
          markupPct: 10,
          status: "draft",
          signedAt: null,
          createdAt: SEED_TIMES.created,
        })
        .run()
    ).toThrow()
  })

  it("rejects a second case for the same hire and creates the suggested indexes", () => {
    const { db, dbPath } = openDb()
    expect(() =>
      db
        .insert(onboardingCases)
        .values({
          id: "case_dup",
          hireRequestId: SEED_IDS.hire,
          workerUserId: SEED_IDS.users.worker2,
          state: "draft_hire",
          assignedOpsUserId: null,
          assignedReviewerUserId: null,
          createdAt: SEED_TIMES.created,
          updatedAt: SEED_TIMES.created,
        })
        .run()
    ).toThrow()

    const sqlite = new Database(dbPath, { readonly: true })
    const names = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)"
      )
      .all(
        "case_documents_case_kind_created_idx",
        "case_events_case_created_idx"
      )
      .map((row) => (row as { name: string }).name)
      .sort()
    sqlite.close()
    expect(names).toEqual([
      "case_documents_case_kind_created_idx",
      "case_events_case_created_idx",
    ])
  })
})

describe("resolveDbPath", () => {
  it("defaults to data/eor.sqlite and honors DATABASE_FILE", () => {
    expect(resolveDbPath({})).toBe(
      path.join(process.cwd(), "data", "eor.sqlite")
    )
    expect(resolveDbPath({ DATABASE_FILE: "/tmp/eor.sqlite" })).toBe(
      "/tmp/eor.sqlite"
    )
    expect(resolveDbPath({ DATABASE_FILE: "tmp/eor.sqlite" })).toBe(
      path.join(process.cwd(), "tmp", "eor.sqlite")
    )
  })
})
