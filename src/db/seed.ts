/**
 * Deterministic demo seed (Issue #11 plan). Fixed ids; safe to re-run via
 * wipe+insert when `FORCE_SEED=1`, otherwise no-ops if users already exist.
 */
import { count, eq } from "drizzle-orm"

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
    eorOps: "user_eor_ops",
    eorReviewer: "user_eor_reviewer",
  },
  hire: "hire_1",
  case: "case_pending_1",
  document: "doc_list_a_1",
  workerProfile: "worker_profile_1",
  events: {
    hireCreated: "evt_hire_created",
    releasedToWorker: "evt_released_worker",
    submittedReview: "evt_submitted_review",
  },
} as const

/** Relative to repo root — committed fixture for cold demo. */
export const SEED_DOCUMENT_PATH = "data/uploads/seed/list-a-passport.png"

export function seedIfEmpty(db: AppDatabase): void {
  const [{ value }] = db.select({ value: count() }).from(users).all()
  if (value > 0 && process.env.FORCE_SEED !== "1") return
  if (value > 0) {
    wipeDemo(db)
  }
  seedDemo(db)
}

function wipeDemo(db: AppDatabase): void {
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

export function seedDemo(db: AppDatabase): void {
  const now = new Date()
  const earlier = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
  const mid = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)

  db.insert(providers)
    .values({
      id: SEED_IDS.provider,
      name: "Northwind EOR",
      createdAt: earlier,
    })
    .run()

  db.insert(clientCompanies)
    .values({
      id: SEED_IDS.client,
      providerId: SEED_IDS.provider,
      name: "Acme Robotics",
      createdAt: earlier,
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
        createdAt: earlier,
      },
      {
        id: SEED_IDS.users.worker,
        role: "worker",
        displayName: "Jordan Lee",
        email: "jordan@worker.example",
        clientCompanyId: SEED_IDS.client,
        providerId: null,
        createdAt: earlier,
      },
      {
        id: SEED_IDS.users.eorOps,
        role: "eor_ops",
        displayName: "Sam Ortiz",
        email: "ops@northwind.example",
        clientCompanyId: null,
        providerId: SEED_IDS.provider,
        createdAt: earlier,
      },
      {
        id: SEED_IDS.users.eorReviewer,
        role: "eor_reviewer",
        displayName: "Riley Chen",
        email: "review@northwind.example",
        clientCompanyId: null,
        providerId: SEED_IDS.provider,
        createdAt: earlier,
      },
    ])
    .run()

  db.insert(clientAgreements)
    .values({
      id: SEED_IDS.agreement,
      clientCompanyId: SEED_IDS.client,
      markupPct: 15,
      status: "signed",
      signedAt: earlier,
      createdAt: earlier,
    })
    .run()

  // $65/hr — above a simple federal minimum-wage floor placeholder.
  db.insert(roleTemplates)
    .values({
      id: SEED_IDS.roleTemplate,
      clientCompanyId: SEED_IDS.client,
      title: "Software Engineer",
      workerType: "w2_employee",
      wageCents: 6500,
      wageUnit: "hourly",
      stateCode: "CA",
      createdAt: earlier,
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
      policySnapshotJson: null,
      status: "active",
      createdAt: earlier,
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
      createdAt: earlier,
      updatedAt: now,
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
      createdAt: mid,
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
      i9AttestationJson: JSON.stringify({ attestedCitizen: true }),
      updatedAt: mid,
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
        createdAt: earlier,
      },
      {
        id: SEED_IDS.events.releasedToWorker,
        caseId: SEED_IDS.case,
        actorUserId: SEED_IDS.users.eorOps,
        type: "released_to_worker",
        payloadJson: JSON.stringify({ note: "Checklist opened" }),
        createdAt: mid,
      },
      {
        id: SEED_IDS.events.submittedReview,
        caseId: SEED_IDS.case,
        actorUserId: SEED_IDS.users.worker,
        type: "submitted_for_review",
        payloadJson: JSON.stringify({ documentId: SEED_IDS.document }),
        createdAt: now,
      },
    ])
    .run()
}

/** Assert seed invariants (used by tests / CLI). */
export function assertSeedWorld(db: AppDatabase): {
  userCount: number
  pendingCaseId: string
} {
  const allUsers = db.select().from(users).all()
  const pending = db
    .select()
    .from(onboardingCases)
    .where(eq(onboardingCases.state, "pending_review"))
    .get()
  if (allUsers.length < 4) {
    throw new Error(`Expected ≥4 users, got ${allUsers.length}`)
  }
  if (!pending) {
    throw new Error("Expected a pending_review case")
  }
  return { userCount: allUsers.length, pendingCaseId: pending.id }
}
