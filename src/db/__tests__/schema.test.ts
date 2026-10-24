import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"

import * as domainTypes from "@/domain/types"
import { DEFAULT_WORKFLOW, TASK_PARTIES as DOMAIN_PARTIES, TASK_STATUSES as DOMAIN_STATUSES } from "@/domain/tasks"

import { createDb, resolveDbPath } from "../client"
import * as schema from "../schema"
import {
  clientAgreements,
  clientCompanies,
  onboardingCases,
  tasks,
  users,
  workflowTemplates,
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
        id: "client_other",
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
          clientCompanyId: "client_other",
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
          clientCompanyId: "client_other",
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
          lifecycle: "open",
          templateId: `wft_us_eor_onboarding_v${DEFAULT_WORKFLOW.version}`,
          factsJson: "{}",
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

describe("task tables", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  function open(file = "test.sqlite") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-tasks-"))
    tempDirs.push(dir)
    const dbPath = path.join(dir, file)
    return { dir, dbPath, db: createDb(dbPath, { forceSeed: false }) }
  }

  it("stores the default workflow as versioned data, id wft_<key>_v<version>", () => {
    const { db } = open()
    const rows = db.select().from(workflowTemplates).all()
    expect(rows.map((r) => r.id)).toEqual([`wft_us_eor_onboarding_v${DEFAULT_WORKFLOW.version}`])
    const definition = JSON.parse(rows[0].definitionJson) as { tasks: { key: string }[] }
    expect(definition.tasks.map((t) => t.key)).toContain("verify_i9_section2")
    expect(open().db.select().from(onboardingCases).all().every((c) => c.templateId === rows[0].id)).toBe(true)
  })

  it("numbers tasks per case: a second task with the same seq is refused", () => {
    const { db } = open()
    const first = db.select().from(tasks).limit(1).get()!
    expect(() =>
      db
        .insert(tasks)
        .values({ ...first, id: "task_dup_seq" })
        .run()
    ).toThrow()
  })

  it("drops and rebuilds a database from before the task engine", () => {
    const { dbPath } = open()
    const legacy = path.join(path.dirname(dbPath), "legacy.sqlite")
    const sqlite = new Database(legacy)
    sqlite.exec(
      "CREATE TABLE onboarding_cases (id TEXT PRIMARY KEY, hire_request_id TEXT, worker_user_id TEXT, state TEXT)"
    )
    sqlite.exec("INSERT INTO onboarding_cases VALUES ('old', 'h', 'w', 'pending_review')")
    sqlite.close()

    const db = createDb(legacy, { forceSeed: false })
    const cases = db.select().from(onboardingCases).all()
    expect(cases.length).toBeGreaterThan(0)
    expect(cases.every((c) => c.id !== "old" && c.lifecycle)).toBe(true)
    expect(db.select().from(tasks).all().length).toBeGreaterThan(0)
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

describe("enum constants", () => {
  it("match the domain's, so schema and engine cannot drift", () => {
    expect(schema.USER_ROLES).toEqual(domainTypes.USER_ROLES)
    expect(schema.CASE_LIFECYCLES).toEqual(domainTypes.CASE_LIFECYCLES)
    expect(schema.DOCUMENT_KINDS).toEqual(domainTypes.DOCUMENT_KINDS)
    expect(schema.AGREEMENT_STATUSES).toEqual(domainTypes.AGREEMENT_STATUSES)
    expect(schema.WAGE_UNITS).toEqual(domainTypes.WAGE_UNITS)
    expect(schema.BENEFIT_PACKAGES).toEqual(domainTypes.BENEFIT_PACKAGES)
    expect(schema.TASK_STATUSES).toEqual(DOMAIN_STATUSES)
    expect(schema.TASK_PARTIES).toEqual(DOMAIN_PARTIES)
  })
})
