import { describe, expect, it } from "vitest"
import {
  addOpsNote,
  assertTransition,
  createHire,
  deriveHireStatus,
  opsMarkReadyForPayroll,
  opsReleaseToWorker,
  opsReopen,
  reviewerApprove,
  reviewerReject,
  signAgreement,
  submitHire,
  uploadDocument,
  workerSubmitForReview,
} from "../case-machine"
import type { ChecklistInput } from "../checklist"
import { CASE_STATES, USER_ROLES, type CaseState, type UserRole } from "../types"
import { expectDomainError } from "./expect-domain-error"

const NOW = new Date("2026-04-01T15:00:00.000Z")

const HIRE = {
  hireId: "hire_new",
  roleTitle: "Software Engineer",
  workerType: "w2_employee",
  wageCents: 6500,
  wageUnit: "hourly" as const,
  stateCode: "CA",
  package: "standard" as const,
  markupPct: 15,
}

const COMPLETE: ChecklistInput = {
  personalJson: { legalName: "Jordan Lee", phone: "4155550100" },
  i9AttestationJson: { status: "citizen", attestedAt: "2026-01-15T00:00:00.000Z" },
  w4Json: { filingStatus: "single" },
  bankJson: { last4: "4242" },
  benefitsAcked: true,
}

const LIST_A = [{ id: "doc_list_a", kind: "list_a" as const, createdAt: 1 }]

const LIST_A_AND_B = [
  { id: "doc_list_a", kind: "list_a" as const, createdAt: 1 },
  { id: "doc_list_b", kind: "list_b" as const, createdAt: 1 },
]

const LEGAL_EDGES: readonly { from: CaseState; to: CaseState; actorRole: UserRole }[] = [
  { from: "draft_hire", to: "awaiting_agreement", actorRole: "client_hr" },
  { from: "draft_hire", to: "pending_eor_setup", actorRole: "client_hr" },
  { from: "awaiting_agreement", to: "pending_eor_setup", actorRole: "client_hr" },
  { from: "pending_eor_setup", to: "awaiting_worker", actorRole: "eor_ops" },
  { from: "awaiting_worker", to: "pending_review", actorRole: "worker" },
  { from: "pending_review", to: "changes_requested", actorRole: "eor_reviewer" },
  { from: "pending_review", to: "work_auth_approved", actorRole: "eor_reviewer" },
  { from: "changes_requested", to: "awaiting_worker", actorRole: "eor_ops" },
  { from: "changes_requested", to: "pending_review", actorRole: "worker" },
  { from: "work_auth_approved", to: "ready_for_payroll", actorRole: "eor_ops" },
]

function submit(input: { from?: CaseState; agreementStatus?: "draft" | "signed"; wageCents?: number; snapshotAlreadySet?: boolean; actorRole?: UserRole } = {}) {
  return submitHire({
    actorRole: input.actorRole ?? "client_hr",
    from: input.from ?? "draft_hire",
    agreementStatus: input.agreementStatus ?? "signed",
    snapshotAlreadySet: input.snapshotAlreadySet ?? false,
    now: NOW,
    ...HIRE,
    wageCents: input.wageCents ?? HIRE.wageCents,
  })
}

describe("happy path", () => {
  it("walks draft_hire to ready_for_payroll when the agreement is already signed", () => {
    const submitted = submit()
    expect(submitted.nextState).toBe("pending_eor_setup")
    expect(submitted.event.type).toBe("hire_submitted")
    expect(submitted.snapshot.capturedAt).toBe(NOW.toISOString())

    const released = opsReleaseToWorker({ actorRole: "eor_ops", from: submitted.nextState })
    expect(released.nextState).toBe("awaiting_worker")
    expect(released.event.type).toBe("released_to_worker")

    const forReview = workerSubmitForReview({
      actorRole: "worker",
      actorUserId: "user_worker",
      caseWorkerUserId: "user_worker",
      from: released.nextState,
      checklist: COMPLETE,
      documents: LIST_A,
      previousSubmissionNo: 0,
    })
    expect(forReview.nextState).toBe("pending_review")
    expect(forReview.event).toMatchObject({
      type: "submitted_for_review",
      payload: { submissionNo: 1, documentIds: ["doc_list_a"] },
    })

    const approved = reviewerApprove({
      actorRole: "eor_reviewer",
      from: forReview.nextState,
      submissionNo: 1,
      latestSubmissionNo: 1,
      documents: LIST_A,
    })
    expect(approved.nextState).toBe("work_auth_approved")
    expect(approved.event.type).toBe("work_auth_approved")

    const ready = opsMarkReadyForPayroll({ actorRole: "eor_ops", from: approved.nextState })
    expect(ready.nextState).toBe("ready_for_payroll")
    expect(ready.event).toEqual({ type: "ready_for_payroll", payload: {} })
  })
})

describe("agreement path", () => {
  it("submits into awaiting_agreement and signing advances that case", () => {
    const submitted = submit({ agreementStatus: "draft" })
    expect(submitted.nextState).toBe("awaiting_agreement")
    expect(submitted.event.type).toBe("hire_submitted")

    const signed = signAgreement({
      actorRole: "client_hr",
      now: NOW,
      agreement: { id: "agreement_1", status: "draft", markupPct: 15 },
      cases: [{ caseId: "case_1", from: submitted.nextState }],
    })
    expect(signed.agreementStatus).toBe("signed")
    expect(signed.signedAt).toBe(NOW.toISOString())
    expect(signed.transitions).toEqual([
      {
        caseId: "case_1",
        nextState: "pending_eor_setup",
        event: {
          type: "agreement_signed",
          payload: { agreementId: "agreement_1", markupPct: 15 },
        },
      },
    ])
  })

  it("refuses a second sign and emits no transition", () => {
    expectDomainError(
      () =>
        signAgreement({
          actorRole: "client_hr",
          now: NOW,
          agreement: { id: "agreement_1", status: "signed", markupPct: 15 },
          cases: [{ caseId: "case_1", from: "awaiting_agreement" }],
        }),
      "AGREEMENT_ALREADY_SIGNED",
    )
  })

  it("refuses to sign through a case that is not awaiting agreement", () => {
    expectDomainError(
      () =>
        signAgreement({
          actorRole: "client_hr",
          now: NOW,
          agreement: { id: "agreement_1", status: "draft", markupPct: 15 },
          cases: [{ caseId: "case_1", from: "draft_hire" }],
        }),
      "ILLEGAL_TRANSITION",
    )
  })

  it("signs the agreement when no case is waiting, and advances every waiting case", () => {
    const none = signAgreement({
      actorRole: "client_hr",
      now: NOW,
      agreement: { id: "agreement_1", status: "draft", markupPct: 15 },
      cases: [],
    })
    expect(none.transitions).toEqual([])
    expect(none.agreementStatus).toBe("signed")

    const both = signAgreement({
      actorRole: "client_hr",
      now: NOW,
      agreement: { id: "agreement_1", status: "draft", markupPct: 15 },
      cases: [
        { caseId: "case_1", from: "awaiting_agreement" },
        { caseId: "case_2", from: "awaiting_agreement" },
      ],
    })
    expect(both.transitions.map((transition) => transition.caseId)).toEqual(["case_1", "case_2"])
    expect(both.transitions.every((transition) => transition.event.type === "agreement_signed")).toBe(
      true,
    )
  })
})

describe("reject loop", () => {
  it("increments submissionNo from 1 to 2 across reject, resubmit, and approve", () => {
    const rejected = reviewerReject({
      actorRole: "eor_reviewer",
      from: "pending_review",
      submissionNo: 1,
      latestSubmissionNo: 1,
      reason: { code: "DOC_ILLEGIBLE", note: "blurry" },
      documentIds: ["doc_list_a"],
    })
    expect(rejected.nextState).toBe("changes_requested")
    expect(rejected.event).toMatchObject({
      type: "work_auth_rejected",
      payload: { submissionNo: 1, reason: { code: "DOC_ILLEGIBLE", note: "blurry" } },
    })

    const resubmitted = workerSubmitForReview({
      actorRole: "worker",
      actorUserId: "user_worker",
      caseWorkerUserId: "user_worker",
      from: rejected.nextState,
      checklist: COMPLETE,
      documents: LIST_A,
      previousSubmissionNo: 1,
    })
    expect(resubmitted.nextState).toBe("pending_review")
    expect(resubmitted.event).toMatchObject({
      type: "submitted_for_review",
      payload: { submissionNo: 2 },
    })

    const approved = reviewerApprove({
      actorRole: "eor_reviewer",
      from: resubmitted.nextState,
      submissionNo: 2,
      latestSubmissionNo: 2,
      documents: LIST_A,
    })
    expect(approved.nextState).toBe("work_auth_approved")
    expect(approved.event).toMatchObject({
      type: "work_auth_approved",
      payload: { submissionNo: 2, documentIds: ["doc_list_a"] },
    })
  })
})

describe("reopen", () => {
  it("returns a changes_requested case to the worker, who can submit again", () => {
    const reopened = opsReopen({ actorRole: "eor_ops", from: "changes_requested", note: "try again" })
    expect(reopened.nextState).toBe("awaiting_worker")
    expect(reopened.event).toEqual({
      type: "case_reopened",
      payload: { note: "try again" },
    })
    const resubmitted = workerSubmitForReview({
      actorRole: "worker",
      actorUserId: "user_worker",
      caseWorkerUserId: "user_worker",
      from: reopened.nextState,
      checklist: COMPLETE,
      documents: LIST_A,
      previousSubmissionNo: 1,
    })
    expect(resubmitted.nextState).toBe("pending_review")
    expect(resubmitted.event.type).toBe("submitted_for_review")
  })
})

describe("illegal transitions", () => {
  it("refuses eor_ops approve and reject from pending_review", () => {
    expectDomainError(
      () =>
        reviewerApprove({
          actorRole: "eor_ops",
          from: "pending_review",
          submissionNo: 1,
          latestSubmissionNo: 1,
          documents: LIST_A,
        }),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () =>
        reviewerReject({
          actorRole: "eor_ops",
          from: "pending_review",
          submissionNo: 1,
          latestSubmissionNo: 1,
          reason: { code: "DOC_EXPIRED" },
          documentIds: ["doc_list_a"],
        }),
      "FORBIDDEN_ROLE",
    )
  })

  it("refuses eor_reviewer release, client_hr submit-for-review, and worker approve", () => {
    expectDomainError(
      () => opsReleaseToWorker({ actorRole: "eor_reviewer", from: "pending_eor_setup" }),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () =>
        workerSubmitForReview({
          actorRole: "client_hr",
          actorUserId: "user_client_hr",
          caseWorkerUserId: "user_worker",
          from: "awaiting_worker",
          checklist: COMPLETE,
          documents: LIST_A,
          previousSubmissionNo: 0,
        }),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () =>
        reviewerApprove({
          actorRole: "worker",
          from: "pending_review",
          submissionNo: 1,
          latestSubmissionNo: 1,
          documents: LIST_A,
        }),
      "FORBIDDEN_ROLE",
    )
  })

  it("refuses skipped, self, and terminal edges for every role", () => {
    for (const actorRole of USER_ROLES) {
      expectDomainError(
        () => assertTransition({ from: "draft_hire", to: "awaiting_worker", actorRole }),
        "ILLEGAL_TRANSITION",
      )
      expectDomainError(
        () => assertTransition({ from: "pending_eor_setup", to: "pending_review", actorRole }),
        "ILLEGAL_TRANSITION",
      )
      expectDomainError(
        () =>
          assertTransition({ from: "work_auth_approved", to: "work_auth_approved", actorRole }),
        "ILLEGAL_TRANSITION",
      )
    }
    for (const to of CASE_STATES) {
      for (const actorRole of USER_ROLES) {
        expectDomainError(
          () => assertTransition({ from: "ready_for_payroll", to, actorRole }),
          "ILLEGAL_TRANSITION",
        )
      }
    }
    expectDomainError(
      () =>
        reviewerApprove({
          actorRole: "eor_reviewer",
          from: "work_auth_approved",
          submissionNo: 1,
          latestSubmissionNo: 1,
          documents: LIST_A,
        }),
      "ILLEGAL_TRANSITION",
    )
  })

  it("refuses an incomplete submit, then an invalid list combo once the checklist is complete", () => {
    const incomplete = expectDomainError(
      () =>
        workerSubmitForReview({
          actorRole: "worker",
          actorUserId: "user_worker",
          caseWorkerUserId: "user_worker",
          from: "awaiting_worker",
          checklist: { ...COMPLETE, benefitsAcked: false },
          documents: LIST_A,
          previousSubmissionNo: 0,
        }),
      "CHECKLIST_INCOMPLETE",
    )
    expect(incomplete.details?.missing).toEqual(["benefits_ack"])

    expectDomainError(
      () =>
        workerSubmitForReview({
          actorRole: "worker",
          actorUserId: "user_worker",
          caseWorkerUserId: "user_worker",
          from: "awaiting_worker",
          checklist: COMPLETE,
          documents: LIST_A_AND_B,
          previousSubmissionNo: 0,
        }),
      "INVALID_LIST_COMBO",
    )
  })

  it("checks checklist before list combo, and state before either", () => {
    expectDomainError(
      () =>
        workerSubmitForReview({
          actorRole: "worker",
          actorUserId: "user_worker",
          caseWorkerUserId: "user_worker",
          from: "awaiting_worker",
          checklist: { ...COMPLETE, personalJson: null },
          documents: LIST_A_AND_B,
          previousSubmissionNo: 0,
        }),
      "CHECKLIST_INCOMPLETE",
    )
    expectDomainError(
      () =>
        workerSubmitForReview({
          actorRole: "worker",
          actorUserId: "user_worker",
          caseWorkerUserId: "user_worker",
          from: "draft_hire",
          checklist: { ...COMPLETE, personalJson: null },
          documents: LIST_A_AND_B,
          previousSubmissionNo: 0,
        }),
      "ILLEGAL_TRANSITION",
    )
  })

  it("refuses createHire when the worker already has a case", () => {
    expectDomainError(
      () =>
        createHire({
          actorRole: "client_hr",
          hireId: "hire_2",
          actorClientCompanyId: "client_1",
          worker: { role: "worker", clientCompanyId: "client_1", hasCase: true },
        }),
      "WORKER_ALREADY_ASSIGNED",
    )
  })

  it("refuses OTHER with an empty note", () => {
    expectDomainError(
      () =>
        reviewerReject({
          actorRole: "eor_reviewer",
          from: "pending_review",
          submissionNo: 1,
          latestSubmissionNo: 1,
          reason: { code: "OTHER", note: "  " },
          documentIds: ["doc_list_a"],
        }),
      "INVALID_REJECT_REASON",
    )
  })

  it("refuses submit when the actor is not the case worker", () => {
    expectDomainError(
      () =>
        workerSubmitForReview({
          actorRole: "worker",
          actorUserId: "user_worker_2",
          caseWorkerUserId: "user_worker",
          from: "awaiting_worker",
          checklist: COMPLETE,
          documents: LIST_A,
          previousSubmissionNo: 0,
        }),
      "FORBIDDEN_ROLE",
    )
  })
})

describe("transition matrix", () => {
  it("accepts exactly the 10 edges and their listed roles", () => {
    const allowed = new Map<string, UserRole>()
    for (const edge of LEGAL_EDGES) {
      const key = `${edge.from}>${edge.to}`
      expect(allowed.has(key)).toBe(false)
      allowed.set(key, edge.actorRole)
    }
    expect(allowed.size).toBe(10)

    let passed = 0
    for (const from of CASE_STATES) {
      for (const to of CASE_STATES) {
        for (const actorRole of USER_ROLES) {
          const role = allowed.get(`${from}>${to}`)
          if (role === actorRole) {
            expect(() => assertTransition({ from, to, actorRole })).not.toThrow()
            passed += 1
          } else if (role) {
            expectDomainError(() => assertTransition({ from, to, actorRole }), "FORBIDDEN_ROLE")
          } else {
            expectDomainError(
              () => assertTransition({ from, to, actorRole }),
              "ILLEGAL_TRANSITION",
            )
          }
        }
      }
    }
    expect(passed).toBe(10)
    expect(CASE_STATES).toHaveLength(8)
    expect(USER_ROLES).toHaveLength(4)
  })
})

describe("hire status derivation", () => {
  it("maps every case state", () => {
    const expected: Record<CaseState, "draft" | "submitted" | "active"> = {
      draft_hire: "draft",
      awaiting_agreement: "submitted",
      pending_eor_setup: "submitted",
      awaiting_worker: "submitted",
      pending_review: "submitted",
      changes_requested: "submitted",
      work_auth_approved: "submitted",
      ready_for_payroll: "active",
    }
    for (const state of CASE_STATES) expect(deriveHireStatus(state)).toBe(expected[state])
  })
})

describe("hire creation and submit preconditions", () => {
  it("creates a draft hire for an unassigned worker in the same client", () => {
    const created = createHire({
      actorRole: "client_hr",
      hireId: "hire_2",
      actorClientCompanyId: "client_1",
      worker: { role: "worker", clientCompanyId: "client_1", hasCase: false },
    })
    expect(created).toEqual({
      nextState: "draft_hire",
      event: { type: "hire_created", payload: { hireId: "hire_2" } },
    })
  })

  it("refuses a worker in another company, a non-worker, and a non-hr actor", () => {
    expectDomainError(
      () =>
        createHire({
          actorRole: "client_hr",
          hireId: "hire_2",
          actorClientCompanyId: "client_1",
          worker: { role: "worker", clientCompanyId: "client_other", hasCase: false },
        }),
      "WORKER_ALREADY_ASSIGNED",
    )
    expectDomainError(
      () =>
        createHire({
          actorRole: "client_hr",
          hireId: "hire_2",
          actorClientCompanyId: "client_1",
          worker: { role: "client_hr", clientCompanyId: "client_1", hasCase: false },
        }),
      "WORKER_ALREADY_ASSIGNED",
    )
    expectDomainError(
      () =>
        createHire({
          actorRole: "worker",
          hireId: "hire_2",
          actorClientCompanyId: "client_1",
          worker: { role: "worker", clientCompanyId: "client_1", hasCase: true },
        }),
      "FORBIDDEN_ROLE",
    )
  })

  it("checks role before wage, and refuses a second snapshot", () => {
    expectDomainError(() => submit({ actorRole: "worker", wageCents: 1 }), "FORBIDDEN_ROLE")
    expectDomainError(() => submit({ from: "ready_for_payroll", wageCents: 1 }), "WAGE_BELOW_FLOOR")
    expectDomainError(() => submit({ snapshotAlreadySet: true }), "ILLEGAL_TRANSITION")
  })

  it("does not let a named operation ride another operation's edge to the same state", () => {
    expectDomainError(
      () => submit({ from: "awaiting_agreement", agreementStatus: "signed" }),
      "ILLEGAL_TRANSITION",
    )
    expectDomainError(
      () => opsReleaseToWorker({ actorRole: "eor_ops", from: "changes_requested" }),
      "ILLEGAL_TRANSITION",
    )
    expectDomainError(
      () => opsReopen({ actorRole: "eor_ops", from: "pending_eor_setup" }),
      "ILLEGAL_TRANSITION",
    )
  })
})

describe("actor separation", () => {
  it("does not let eor_ops reach a review decision or eor_reviewer leave those two states", () => {
    expect(opsReleaseToWorker({ actorRole: "eor_ops", from: "pending_eor_setup" }).nextState).toBe(
      "awaiting_worker",
    )
    expect(opsReopen({ actorRole: "eor_ops", from: "changes_requested" }).nextState).toBe(
      "awaiting_worker",
    )
    expect(
      opsMarkReadyForPayroll({ actorRole: "eor_ops", from: "work_auth_approved" }).nextState,
    ).toBe("ready_for_payroll")
    expectDomainError(
      () => reviewerApprove({ actorRole: "eor_ops", from: "draft_hire", submissionNo: 1, latestSubmissionNo: 1, documents: LIST_A }),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () => opsReleaseToWorker({ actorRole: "eor_reviewer", from: "draft_hire" }),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () => opsReopen({ actorRole: "eor_reviewer", from: "changes_requested" }),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(
      () => opsMarkReadyForPayroll({ actorRole: "eor_reviewer", from: "work_auth_approved" }),
      "FORBIDDEN_ROLE",
    )
    expectDomainError(() => submit({ actorRole: "eor_reviewer" }), "FORBIDDEN_ROLE")
    expectDomainError(
      () =>
        signAgreement({
          actorRole: "eor_reviewer",
          now: NOW,
          agreement: { id: "agreement_1", status: "draft", markupPct: 15 },
          cases: [],
        }),
      "FORBIDDEN_ROLE",
    )
  })
})

describe("documents, notes, and stale decisions", () => {
  it("uploads only for the owning worker in a mutable state", () => {
    const uploaded = uploadDocument({
      actorRole: "worker",
      actorUserId: "user_worker",
      caseWorkerUserId: "user_worker",
      from: "changes_requested",
      documentId: "doc_2",
      kind: "list_a",
      supersededDocumentId: "doc_list_a",
    })
    expect(uploaded.nextState).toBe("changes_requested")
    expect(uploaded.event).toEqual({
      type: "document_uploaded",
      payload: { documentId: "doc_2", kind: "list_a", supersededDocumentId: "doc_list_a" },
    })
    expectDomainError(
      () =>
        uploadDocument({
          actorRole: "worker",
          actorUserId: "user_worker",
          caseWorkerUserId: "user_worker",
          from: "pending_review",
          documentId: "doc_3",
          kind: "list_a",
        }),
      "ILLEGAL_TRANSITION",
    )
    expectDomainError(
      () =>
        uploadDocument({
          actorRole: "eor_ops",
          actorUserId: "user_eor_ops",
          caseWorkerUserId: "user_worker",
          from: "awaiting_worker",
          documentId: "doc_3",
          kind: "list_a",
        }),
      "FORBIDDEN_ROLE",
    )
  })

  it("records an ops note without moving state", () => {
    const noted = addOpsNote({
      actorRole: "eor_ops",
      from: "pending_eor_setup",
      note: "called the worker",
    })
    expect(noted).toEqual({
      nextState: "pending_eor_setup",
      event: { type: "ops_note", payload: { note: "called the worker" } },
    })
    expectDomainError(
      () => addOpsNote({ actorRole: "worker", from: "pending_eor_setup", note: "nope" }),
      "FORBIDDEN_ROLE",
    )
  })

  it("refuses a decision whose submissionNo is not the latest", () => {
    expectDomainError(
      () =>
        reviewerApprove({
          actorRole: "eor_reviewer",
          from: "pending_review",
          submissionNo: 1,
          latestSubmissionNo: 2,
          documents: LIST_A,
        }),
      "ILLEGAL_TRANSITION",
    )
    expectDomainError(
      () =>
        reviewerReject({
          actorRole: "eor_reviewer",
          from: "pending_review",
          submissionNo: 1,
          latestSubmissionNo: 2,
          reason: { code: "DOC_MISMATCH" },
          documentIds: ["doc_list_a"],
        }),
      "ILLEGAL_TRANSITION",
    )
  })

  it("judges readiness on the active document per kind", () => {
    const submitted = workerSubmitForReview({
      actorRole: "worker",
      actorUserId: "user_worker",
      caseWorkerUserId: "user_worker",
      from: "awaiting_worker",
      checklist: COMPLETE,
      documents: [
        { id: "old_a", kind: "list_a", createdAt: 1 },
        { id: "new_a", kind: "list_a", createdAt: 2 },
      ],
      previousSubmissionNo: 0,
    })
    expect(submitted.event).toMatchObject({
      type: "submitted_for_review",
      payload: { documentIds: ["new_a"] },
    })

    expectDomainError(
      () =>
        workerSubmitForReview({
          actorRole: "worker",
          actorUserId: "user_worker",
          caseWorkerUserId: "user_worker",
          from: "awaiting_worker",
          checklist: COMPLETE,
          documents: [
            { id: "old_b", kind: "list_b", createdAt: 1 },
            { id: "new_a", kind: "list_a", createdAt: 2 },
          ],
          previousSubmissionNo: 0,
        }),
      "INVALID_LIST_COMBO",
    )
  })

  it("refuses approval when the active set violates W1", () => {
    expectDomainError(
      () =>
        reviewerApprove({
          actorRole: "eor_reviewer",
          from: "pending_review",
          submissionNo: 1,
          latestSubmissionNo: 1,
          documents: LIST_A_AND_B,
        }),
      "INVALID_LIST_COMBO",
    )
  })
})
