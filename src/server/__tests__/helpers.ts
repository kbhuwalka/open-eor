/**
 * Shared fixtures for service tests: a temp database, a settable clock, the seeded actors, and a
 * driver that finishes ready tasks the way the portals will (sample payloads from the domain).
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterEach } from "vitest"

import type { SessionUser } from "@/auth/session"
import { caseDocuments, createDb, SEED_COMPANIES, SEED_IDS, users, type AppDatabase } from "@/db"
import type { IdentityDocumentDetails, IdentityListKind } from "@/domain/forms"
import { createRng, samplePayload, type Task } from "@/domain/tasks"
import type { DocumentKind } from "@/domain/types"

import { createOrder, uploadCaseDocument, type CreateOrderInput } from "../cases"
import type { CaseServiceDeps } from "../deps"
import { completeTaskAsActor, tasksForCase } from "../tasks"

export function sessionUser(db: AppDatabase, userId: string): SessionUser {
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) throw new Error(`no user ${userId}`)
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as SessionUser["role"],
    clientCompanyId: row.clientCompanyId,
    providerId: row.providerId,
  }
}

export const alex: SessionUser = {
  id: SEED_IDS.users.clientHr,
  email: "hr@acme.example",
  displayName: "Alex Harper",
  role: "client_hr",
  clientCompanyId: SEED_IDS.client,
  providerId: null,
}

/** Opens a seeded database in a temp dir; the dir is removed after each test. */
export function tempDbFactory(prefix = "eor-svc-"): () => AppDatabase {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })
  return () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    dirs.push(dir)
    return createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
  }
}

export type Clock = { now: Date; advanceHours(hours: number): Date; set(iso: string): Date }

export function makeClock(iso: string): Clock {
  const clock: Clock = {
    now: new Date(iso),
    advanceHours(hours) {
      clock.now = new Date(clock.now.getTime() + hours * 3_600_000)
      return clock.now
    },
    set(next) {
      clock.now = new Date(next)
      return clock.now
    },
  }
  return clock
}

const idCounters = new WeakMap<AppDatabase, number>()

/** Ids are unique per database, however many deps objects share it. */
export function makeDeps(db: AppDatabase, clock: Clock): CaseServiceDeps {
  return {
    db,
    now: () => clock.now,
    newId: (prefix) => {
      const next = (idCounters.get(db) ?? 0) + 1
      idCounters.set(db, next)
      return `${prefix}_t${next}`
    },
  }
}

export const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

/** 2026-03-02 is a Monday, well past five business days after the default clock. */
export const DEFAULT_CLOCK = "2026-02-01T12:00:00Z"

export function orderInput(patch: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    firstName: "Casey",
    lastName: "Nguyen",
    email: "casey@worker.example",
    roleId: SEED_IDS.role,
    workerType: "w2_employee",
    wageCents: 6500,
    wageUnit: "hourly",
    stateCode: "CA",
    package: "premium",
    startDate: "2026-03-02",
    acceptAgreement: false,
    ...patch,
  }
}

/** What an employee would enter for each list's sample document (valid, far from expiring). */
export const SAMPLE_IDENTITY_DETAILS: Record<IdentityListKind, IdentityDocumentDetails> = {
  list_a: { title: "U.S. Passport", issuingAuthority: "U.S. Department of State", number: "583920174", expiresOn: "2034-05-15" },
  list_b: { title: "Driver's license", issuingAuthority: "California DMV", number: "D4471920", expiresOn: "2031-01-31" },
  list_c: {
    title: "Social Security Account Number card (unrestricted)",
    issuingAuthority: "Social Security Administration",
    number: "123-45-6789",
    expiresOn: null,
  },
}

export function sampleDetailsFor(kind: DocumentKind): IdentityDocumentDetails | null {
  return kind === "list_a" || kind === "list_b" || kind === "list_c" ? SAMPLE_IDENTITY_DETAILS[kind] : null
}

export type Driver = ReturnType<typeof makeDriver>

/** Finishes tasks for one case as the right party. Time moves forward an hour per task. */
export function makeDriver(db: AppDatabase, deps: CaseServiceDeps, clock: Clock, caseId: string, workerUserId: string) {
  const rng = createRng(42)
  const actors = {
    client: alex,
    worker: sessionUser(db, workerUserId),
    specialist: sessionUser(db, SEED_IDS.users.specialist),
    finance: sessionUser(db, SEED_IDS.users.finance),
  }
  /** Records an upload with sample details for List A/B/C; pass `null` for a legacy upload without them. */
  const upload = (kind: DocumentKind, fileName: string, details: IdentityDocumentDetails | null = sampleDetailsFor(kind)) =>
    uploadCaseDocument(deps, { actor: actors.worker, caseId, kind, fileName, storagePath: `data/uploads/${fileName}`, details })

  function payloadFor(task: Task, party: keyof typeof actors): unknown {
    const documents = db
      .select({ id: caseDocuments.id, kind: caseDocuments.kind, createdAt: caseDocuments.createdAt })
      .from(caseDocuments)
      .where(eq(caseDocuments.caseId, caseId))
      .all()
      .map((doc) => ({ id: doc.id, kind: doc.kind as DocumentKind, createdAt: doc.createdAt.getTime() }))
    const actor = actors[party]
    return samplePayload(task, {
      rng,
      actor: { userId: actor.id, role: actor.role, clientCompanyId: actor.clientCompanyId },
      env: { documents },
      today: isoDay(clock.now),
      workerName: actors.worker.displayName,
      savedMethodId: SEED_COMPANIES[0].method.id,
    })
  }

  const find = (key: string, status: Task["status"] = "ready"): Task | undefined =>
    tasksForCase(db, caseId)
      .filter((task) => task.key === key && task.status === status)
      .at(-1)

  function complete(key: string): void {
    const task = find(key)
    if (!task) throw new Error(`no ready ${key}`)
    const party = task.party as keyof typeof actors
    if (task.type === "upload_documents") upload("list_a", "passport.png")
    clock.advanceHours(1)
    completeTaskAsActor(deps, { actor: actors[party], taskId: task.id, payload: payloadFor(task, party) })
  }

  /** Completes every ready non-system task that is not in `stop`, until nothing is left to do. */
  function drive(options: { stop?: string[]; blockingOnly?: boolean } = {}): void {
    const stop = options.stop ?? []
    for (let guard = 0; guard < 100; guard += 1) {
      const next = tasksForCase(db, caseId).find(
        (task) =>
          task.status === "ready" &&
          task.party !== "system" &&
          task.trigger === null &&
          !stop.includes(task.key) &&
          (!options.blockingOnly || task.blocksGoLive)
      )
      if (!next) return
      complete(next.key)
    }
    throw new Error("drive did not settle")
  }

  return { actors, upload, find, complete, drive, rng }
}

/** Orders a person and returns everything a test needs to drive them. */
export function setup(db: AppDatabase, patch: Partial<CreateOrderInput> = {}, clockIso = DEFAULT_CLOCK) {
  const clock = makeClock(clockIso)
  const deps = makeDeps(db, clock)
  const order = createOrder(deps, { actor: alex, hire: orderInput(patch) })
  const driver = makeDriver(db, deps, clock, order.caseId, order.workerUserId)
  return { clock, deps, ...order, driver }
}
