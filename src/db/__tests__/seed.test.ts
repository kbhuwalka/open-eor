import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import {
  parseBankJson,
  parseI9Attestation,
  parsePersonalJson,
  parsePolicySnapshot,
  parseW4Json,
} from "@/domain/types"

import { createDb } from "../client"
import {
  caseDocuments,
  caseEvents,
  clientAgreements,
  hireRequests,
  onboardingCases,
  roleTemplates,
  users,
  workerProfiles,
} from "../schema"
import {
  casesForWorker,
  SEED_DOCUMENT_PATH,
  SEED_IDS,
  SEED_TIMES,
  seedIfEmpty,
} from "../seed"

describe("seed world", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  function openDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-"))
    tempDirs.push(dir)
    return createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
  }

  it("loads the §5 world: five users, submitted hire, pending case, list A", () => {
    const db = openDb()
    const allUsers = db.select().from(users).all()
    const roleCounts = Object.fromEntries(
      ["client_hr", "worker", "eor_ops", "eor_reviewer"].map((role) => [
        role,
        allUsers.filter((user) => user.role === role).length,
      ])
    )
    expect(roleCounts).toEqual({
      client_hr: 1,
      worker: 2,
      eor_ops: 1,
      eor_reviewer: 1,
    })

    const byId = Object.fromEntries(allUsers.map((user) => [user.id, user]))
    expect(byId[SEED_IDS.users.clientHr]?.displayName).toBe("Alex Harper")
    expect(byId[SEED_IDS.users.worker]?.displayName).toBe("Jordan Lee")
    expect(byId[SEED_IDS.users.worker2]?.displayName).toBe("Taylor Kim")
    expect(byId[SEED_IDS.users.eorOps]?.displayName).toBe("Sam Ortiz")
    expect(byId[SEED_IDS.users.eorReviewer]?.displayName).toBe("Riley Chen")

    for (const user of allUsers) {
      const hasClient = user.clientCompanyId !== null
      const hasProvider = user.providerId !== null
      expect(hasClient).not.toBe(hasProvider)
      if (user.role === "client_hr" || user.role === "worker") {
        expect(user.clientCompanyId).toBe(SEED_IDS.client)
        expect(user.providerId).toBeNull()
      } else {
        expect(user.providerId).toBe(SEED_IDS.provider)
        expect(user.clientCompanyId).toBeNull()
      }
    }

    expect(casesForWorker(db, SEED_IDS.users.worker2)).toEqual([])
    const unassignedProfile = db
      .select()
      .from(workerProfiles)
      .where(eq(workerProfiles.userId, SEED_IDS.users.worker2))
      .all()
    expect(unassignedProfile).toEqual([])

    const cases = db.select().from(onboardingCases).all()
    expect(cases.map((row) => row.id)).toEqual([SEED_IDS.case])
    expect(cases[0]?.state).toBe("pending_review")
    expect(cases[0]?.workerUserId).toBe(SEED_IDS.users.worker)
    expect(cases[0]?.assignedOpsUserId).toBe(SEED_IDS.users.eorOps)
    expect(cases[0]?.assignedReviewerUserId).toBe(SEED_IDS.users.eorReviewer)

    const hire = db
      .select()
      .from(hireRequests)
      .where(eq(hireRequests.id, SEED_IDS.hire))
      .get()
    expect(hire?.status).toBe("submitted")
    expect(hire?.workerUserId).toBe(SEED_IDS.users.worker)
    expect(hire?.createdByUserId).toBe(SEED_IDS.users.clientHr)
    expect(hire?.package).toBe("standard")
    expect(hire?.wageCents).toBe(6500)
    expect(hire?.wageUnit).toBe("hourly")
    expect(hire?.stateCode).toBe("CA")
    expect(parsePolicySnapshot(hire?.policySnapshotJson ?? "")).toEqual({
      version: 1,
      hireId: SEED_IDS.hire,
      capturedAt: SEED_TIMES.submitted.toISOString(),
      roleTitle: "Software Engineer",
      workerType: "w2_employee",
      comp: { wageCents: 6500, wageUnit: "hourly", stateCode: "CA" },
      wageFloor: { effectiveHourlyCents: 1650, source: "CA" },
      package: "standard",
      markupPct: 15,
      eorFeeCents: 975,
      benefits: { baselineHealth: true, electives: false },
      requiredSteps: ["personal", "i9", "w4", "bank", "benefits_ack"],
    })

    const agreement = db
      .select()
      .from(clientAgreements)
      .where(eq(clientAgreements.id, SEED_IDS.agreement))
      .get()
    expect(agreement?.markupPct).toBe(15)
    expect(agreement?.status).toBe("signed")
    expect(agreement?.signedAt).toEqual(SEED_TIMES.created)

    const template = db
      .select()
      .from(roleTemplates)
      .where(eq(roleTemplates.id, SEED_IDS.roleTemplate))
      .get()
    expect(template).toMatchObject({
      title: "Software Engineer",
      workerType: "w2_employee",
      wageCents: 6500,
      wageUnit: "hourly",
      stateCode: "CA",
    })

    const docs = db.select().from(caseDocuments).all()
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      id: SEED_IDS.document,
      kind: "list_a",
      storagePath: SEED_DOCUMENT_PATH,
      uploadedBy: SEED_IDS.users.worker,
    })
    expect(fs.existsSync(path.join(process.cwd(), SEED_DOCUMENT_PATH))).toBe(
      true
    )

    // Checklist completeness is computed only by checklistStatus (domain §6, Issue #24).
    // The seeded profile meets every step's stored predicate, and the only active
    // document kind is list_a (W1), so that function returns complete.
    const profile = db
      .select()
      .from(workerProfiles)
      .where(eq(workerProfiles.id, SEED_IDS.workerProfile))
      .get()
    expect(profile?.benefitsAcked).toBe(true)
    expect(profile?.caseId).toBe(SEED_IDS.case)
    const personal = parsePersonalJson(profile?.personalJson ?? "")
    const w4 = parseW4Json(profile?.w4Json ?? "")
    const bank = parseBankJson(profile?.bankJson ?? "")
    const i9 = parseI9Attestation(profile?.i9AttestationJson ?? "")
    expect(personal).toEqual({ legalName: "Jordan Lee", phone: "+1-555-0100" })
    expect(w4).toEqual({ filingStatus: "single" })
    expect(bank).toEqual({ last4: "1234" })
    expect(i9).toEqual({
      status: "citizen",
      attestedAt: SEED_TIMES.released.toISOString(),
    })

    const events = db
      .select()
      .from(caseEvents)
      .all()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    expect(events.map((event) => event.id)).toEqual([
      SEED_IDS.events.hireCreated,
      SEED_IDS.events.hireSubmitted,
      SEED_IDS.events.releasedToWorker,
      SEED_IDS.events.submittedReview,
    ])
    expect(events.map((event) => event.type)).toEqual([
      "hire_created",
      "hire_submitted",
      "released_to_worker",
      "submitted_for_review",
    ])
    expect(JSON.parse(events[1]?.payloadJson ?? "")).toEqual({
      hireId: SEED_IDS.hire,
      snapshotCapturedAt: SEED_TIMES.submitted.toISOString(),
    })
    expect(JSON.parse(events[3]?.payloadJson ?? "")).toEqual({
      submissionNo: 1,
      documentIds: [SEED_IDS.document],
    })
  })

  it("is idempotent: a second open does not duplicate, and force reseed restores edits", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-"))
    tempDirs.push(dir)
    const dbPath = path.join(dir, "test.sqlite")
    const first = createDb(dbPath, { forceSeed: false })
    const before = first.select().from(users).all().length
    seedIfEmpty(first, { force: false })
    expect(first.select().from(users).all()).toHaveLength(before)

    first
      .update(users)
      .set({ displayName: "Changed" })
      .where(eq(users.id, SEED_IDS.users.worker))
      .run()
    seedIfEmpty(first, { force: true })
    const restored = first
      .select()
      .from(users)
      .where(eq(users.id, SEED_IDS.users.worker))
      .get()
    expect(restored?.displayName).toBe("Jordan Lee")
    expect(first.select().from(users).all()).toHaveLength(5)
    expect(first.select().from(onboardingCases).all()).toHaveLength(1)
  })
})
