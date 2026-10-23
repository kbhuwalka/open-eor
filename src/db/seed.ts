/**
 * Deterministic demo seed (data-model §5). Fixed ids and timestamps.
 * `seedIfEmpty` no-ops when users exist unless `force` is set (`pnpm db:seed`).
 */
import { count, eq } from "drizzle-orm"

import type { PolicySnapshotV1 } from "@/domain/types"

import type { AppDatabase } from "./client"
import {
  caseDocuments,
  caseEvents,
  clientAgreements,
  clientCompanies,
  hireRequests,
  onboardingCases,
  providers,
  roleTemplates,
  users,
  workerProfiles,
} from "./schema"

export const SEED_IDS = {
  provider: "provider_1",
  client: "client_1",
  agreement: "agreement_1",
  roleTemplate: "role_template_1",
  users: {
    clientHr: "user_client_hr",
    worker: "user_worker",
    worker2: "user_worker_2",
    eorOps: "user_eor_ops",
    eorReviewer: "user_eor_reviewer",
  },
  hire: "hire_1",
  case: "case_pending_1",
  document: "doc_list_a_1",
  workerProfile: "worker_profile_1",
  events: {
    hireCreated: "evt_hire_created",
    hireSubmitted: "evt_hire_submitted",
    releasedToWorker: "evt_released_worker",
    submittedReview: "evt_submitted_review",
  },
} as const

/** Relative to repo root — committed fixture for the seeded List A document. */
export const SEED_DOCUMENT_PATH = "data/uploads/seed/list-a-passport.png"

/** Fixed clock so reseed is byte-stable. */
export const SEED_TIMES = {
  created: new Date("2026-01-12T15:00:00.000Z"),
  submitted: new Date("2026-01-12T16:00:00.000Z"),
  released: new Date("2026-01-14T15:00:00.000Z"),
  submittedReview: new Date("2026-01-15T15:00:00.000Z"),
} as const

type SeedExecutor = {
  insert: AppDatabase["insert"]
  delete: AppDatabase["delete"]
  select: AppDatabase["select"]
}

/**
 * PolicySnapshotV1 literal for hire_1.
 * CA hourly floor is 1650 cents, above the federal 725 (domain §7), so the
 * frozen floor source is CA. Fee is round(6500 * 15 / 100) = 975.
 */
export function seedPolicySnapshot(): PolicySnapshotV1 {
  return {
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
  }
}

export function seedIfEmpty(
  db: AppDatabase,
  options: { force: boolean }
): void {
  db.transaction((tx) => {
    const [{ value }] = tx.select({ value: count() }).from(users).all()
    if (value > 0 && !options.force) return
    if (value > 0) wipeDemo(tx)
    seedDemo(tx)
  })
}

function wipeDemo(db: SeedExecutor): void {
  db.delete(caseEvents).run()
  db.delete(caseDocuments).run()
  db.delete(workerProfiles).run()
  db.delete(onboardingCases).run()
  db.delete(hireRequests).run()
  db.delete(roleTemplates).run()
  db.delete(clientAgreements).run()
  db.delete(users).run()
  db.delete(clientCompanies).run()
  db.delete(providers).run()
}

function seedDemo(db: SeedExecutor): void {
  const { created, submitted, released, submittedReview } = SEED_TIMES
  const snapshot = seedPolicySnapshot()

  db.insert(providers)
    .values({
      id: SEED_IDS.provider,
      name: "Northwind EOR",
      createdAt: created,
    })
    .run()

  db.insert(clientCompanies)
    .values({
      id: SEED_IDS.client,
      providerId: SEED_IDS.provider,
      name: "Acme Robotics",
      createdAt: created,
    })
    .run()

  db.insert(users)
    .values([
      {
        id: SEED_IDS.users.clientHr,
        role: "client_hr",
        displayName: "Alex Harper",
        email: "hr@acme.example",
        clientCompanyId: SEED_IDS.client,
        providerId: null,
        createdAt: created,
      },
      {
        id: SEED_IDS.users.worker,
        role: "worker",
        displayName: "Jordan Lee",
        email: "jordan@worker.example",
        clientCompanyId: SEED_IDS.client,
        providerId: null,
        createdAt: created,
      },
      {
        id: SEED_IDS.users.worker2,
        role: "worker",
        displayName: "Taylor Kim",
        email: "taylor@worker.example",
        clientCompanyId: SEED_IDS.client,
        providerId: null,
        createdAt: created,
      },
      {
        id: SEED_IDS.users.eorOps,
        role: "eor_ops",
        displayName: "Sam Ortiz",
        email: "ops@northwind.example",
        clientCompanyId: null,
        providerId: SEED_IDS.provider,
        createdAt: created,
      },
      {
        id: SEED_IDS.users.eorReviewer,
        role: "eor_reviewer",
        displayName: "Riley Chen",
        email: "review@northwind.example",
        clientCompanyId: null,
        providerId: SEED_IDS.provider,
        createdAt: created,
      },
    ])
    .run()

  db.insert(clientAgreements)
    .values({
      id: SEED_IDS.agreement,
      clientCompanyId: SEED_IDS.client,
      markupPct: 15,
      status: "signed",
      signedAt: created,
      createdAt: created,
    })
    .run()

  db.insert(roleTemplates)
    .values({
      id: SEED_IDS.roleTemplate,
      clientCompanyId: SEED_IDS.client,
      title: "Software Engineer",
      workerType: "w2_employee",
      wageCents: 6500,
      wageUnit: "hourly",
      stateCode: "CA",
      createdAt: created,
    })
    .run()

  db.insert(hireRequests)
    .values({
      id: SEED_IDS.hire,
      clientCompanyId: SEED_IDS.client,
      roleTemplateId: SEED_IDS.roleTemplate,
      workerUserId: SEED_IDS.users.worker,
      createdByUserId: SEED_IDS.users.clientHr,
      package: "standard",
      jobTitle: "Software Engineer",
      wageCents: 6500,
      wageUnit: "hourly",
      stateCode: "CA",
      policySnapshotJson: JSON.stringify(snapshot),
      status: "submitted",
      createdAt: created,
    })
    .run()

  db.insert(onboardingCases)
    .values({
      id: SEED_IDS.case,
      hireRequestId: SEED_IDS.hire,
      workerUserId: SEED_IDS.users.worker,
      state: "pending_review",
      assignedOpsUserId: SEED_IDS.users.eorOps,
      assignedReviewerUserId: SEED_IDS.users.eorReviewer,
      createdAt: created,
      updatedAt: submittedReview,
    })
    .run()

  db.insert(caseDocuments)
    .values({
      id: SEED_IDS.document,
      caseId: SEED_IDS.case,
      kind: "list_a",
      storagePath: SEED_DOCUMENT_PATH,
      fileName: "list-a-passport.png",
      uploadedBy: SEED_IDS.users.worker,
      createdAt: released,
    })
    .run()

  db.insert(workerProfiles)
    .values({
      id: SEED_IDS.workerProfile,
      userId: SEED_IDS.users.worker,
      caseId: SEED_IDS.case,
      personalJson: JSON.stringify({
        legalName: "Jordan Lee",
        phone: "+1-555-0100",
      }),
      w4Json: JSON.stringify({ filingStatus: "single" }),
      bankJson: JSON.stringify({ last4: "1234" }),
      benefitsAcked: true,
      i9AttestationJson: JSON.stringify({
        status: "citizen",
        attestedAt: released.toISOString(),
      }),
      updatedAt: released,
    })
    .run()

  db.insert(caseEvents)
    .values([
      {
        id: SEED_IDS.events.hireCreated,
        caseId: SEED_IDS.case,
        actorUserId: SEED_IDS.users.clientHr,
        type: "hire_created",
        payloadJson: JSON.stringify({ hireId: SEED_IDS.hire }),
        createdAt: created,
      },
      {
        id: SEED_IDS.events.hireSubmitted,
        caseId: SEED_IDS.case,
        actorUserId: SEED_IDS.users.clientHr,
        type: "hire_submitted",
        payloadJson: JSON.stringify({
          hireId: SEED_IDS.hire,
          snapshotCapturedAt: snapshot.capturedAt,
        }),
        createdAt: submitted,
      },
      {
        id: SEED_IDS.events.releasedToWorker,
        caseId: SEED_IDS.case,
        actorUserId: SEED_IDS.users.eorOps,
        type: "released_to_worker",
        payloadJson: JSON.stringify({ note: "Checklist opened" }),
        createdAt: released,
      },
      {
        id: SEED_IDS.events.submittedReview,
        caseId: SEED_IDS.case,
        actorUserId: SEED_IDS.users.worker,
        type: "submitted_for_review",
        payloadJson: JSON.stringify({
          submissionNo: 1,
          documentIds: [SEED_IDS.document],
        }),
        createdAt: submittedReview,
      },
    ])
    .run()
}

/** Personas for `/pick`, in a stable demo order. */
export function listPersonas(db: AppDatabase) {
  const order: readonly string[] = [
    SEED_IDS.users.clientHr,
    SEED_IDS.users.worker,
    SEED_IDS.users.worker2,
    SEED_IDS.users.eorOps,
    SEED_IDS.users.eorReviewer,
  ]
  return db
    .select()
    .from(users)
    .all()
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
}

/** Rows for `userId`, used by tests that prove a cold worker has no case. */
export function casesForWorker(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(onboardingCases)
    .where(eq(onboardingCases.workerUserId, userId))
    .all()
}
