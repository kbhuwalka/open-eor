import { describe, expect, it } from "vitest"

import { earliestStartDate } from "@/domain/business-days"
import type { PolicySnapshotV1 } from "@/domain/types"
import { resolveWageFloor } from "@/domain/wage"

import { confirmationProblem, CONFIRMATION_MAX } from "../filing"
import { buildRejectReason, rejectionHistory, rejectionProblem } from "../i9-review"
import { hasFailingCheck, orderChecks, type OrderCheckInput } from "../order-checks"
import { payrollBlockers, preflightItems, type PreflightInput } from "../preflight"
import { stageProgressText } from "../stage-text"

const NOW = new Date("2026-02-02T15:00:00Z")

function snapshot(patch: Partial<PolicySnapshotV1> = {}): PolicySnapshotV1 {
  return {
    version: 1,
    hireId: "hire_1",
    capturedAt: "2026-01-30T10:00:00.000Z",
    roleTitle: "Designer",
    workerType: "w2_employee",
    comp: { wageCents: 6500, wageUnit: "hourly", stateCode: "CA" },
    wageFloor: { effectiveHourlyCents: resolveWageFloor("CA").effectiveHourlyCents, source: resolveWageFloor("CA").source },
    package: "standard",
    markupPct: 15,
    eorFeeCents: 0,
    benefits: { baselineHealth: true, electives: true },
    ...patch,
  }
}

function checkInput(patch: Partial<OrderCheckInput> = {}): OrderCheckInput {
  return {
    stateCode: "CA",
    wageCents: 6500,
    wageUnit: "hourly",
    startDate: "2026-03-02",
    snapshot: snapshot(),
    agreementSigned: true,
    now: NOW,
    ...patch,
  }
}

const statusOf = (checks: ReturnType<typeof orderChecks>, id: string) => checks.find((check) => check.id === id)!.status

describe("orderChecks", () => {
  it("passes a healthy order", () => {
    const checks = orderChecks(checkInput())
    expect(checks.map((check) => check.status)).toEqual(["pass", "pass", "pass", "pass", "pass"])
    expect(hasFailingCheck(checks)).toBe(false)
  })

  it("fails below the wage floor and says which floor", () => {
    const checks = orderChecks(checkInput({ wageCents: 500, snapshot: snapshot({ comp: { wageCents: 500, wageUnit: "hourly", stateCode: "CA" } }) }))
    expect(statusOf(checks, "wage_floor")).toBe("fail")
    expect(checks.find((check) => check.id === "wage_floor")!.detail).toMatch(/floor/)
    expect(hasFailingCheck(checks)).toBe(true)
  })

  it("compares an annual wage as an hourly rate", () => {
    const checks = orderChecks(checkInput({ wageCents: 148_000_00, wageUnit: "annual", snapshot: null }))
    expect(statusOf(checks, "wage_floor")).toBe("pass")
  })

  it("detects drift from the policy snapshot and warns when there is none", () => {
    expect(statusOf(orderChecks(checkInput({ wageCents: 7000 })), "snapshot")).toBe("fail")
    expect(statusOf(orderChecks(checkInput({ stateCode: "NY" })), "snapshot")).toBe("fail")
    expect(statusOf(orderChecks(checkInput({ snapshot: null })), "snapshot")).toBe("warn")
  })

  it("judges the start date: passed fails, tight warns, none warns", () => {
    expect(statusOf(orderChecks(checkInput({ startDate: "2026-02-01" })), "start_date")).toBe("fail")
    const tight = earliestStartDate(NOW) > "2026-02-02" ? "2026-02-03" : "2026-02-02"
    expect(statusOf(orderChecks(checkInput({ startDate: tight })), "start_date")).toBe("warn")
    expect(statusOf(orderChecks(checkInput({ startDate: null })), "start_date")).toBe("warn")
  })

  it("fails when the client agreement is not signed", () => {
    expect(statusOf(orderChecks(checkInput({ agreementSigned: false })), "agreement")).toBe("fail")
  })
})

function preflight(patch: Partial<PreflightInput> = {}, statuses: Record<string, "done" | "ready" | "blocked"> = {}): PreflightInput {
  const keys = ["sign_agreement", "pay_deposit", "confirm_deposit", "w4", "direct_deposit", "verify_i9_section2"]
  return {
    caseId: "case_1",
    workerName: "Anya Chen",
    tasks: keys.map((key) => ({ id: `task_${key}`, key, status: statuses[key] ?? "done", party: "worker" as const })),
    deposit: { state: "paid", amountLabel: "$1,000.00" },
    forms: { w4: true, directDeposit: true },
    ...patch,
  }
}

describe("preflightItems", () => {
  it("is all done when every prerequisite is", () => {
    const items = preflightItems(preflight())
    expect(items.map((item) => item.id)).toEqual(["agreement", "deposit", "w4", "direct_deposit", "i9"])
    expect(items.every((item) => item.done)).toBe(true)
    expect(payrollBlockers(items)).toEqual([])
    expect(items.every((item) => item.href.startsWith("/onboarding/people/case_1"))).toBe(true)
  })

  it("names who each open item is waiting on", () => {
    const items = preflightItems(
      preflight(
        { forms: { w4: false, directDeposit: false }, deposit: { state: "open", amountLabel: "$1,000.00" } },
        { sign_agreement: "ready", pay_deposit: "ready", confirm_deposit: "blocked", w4: "ready", direct_deposit: "ready", verify_i9_section2: "blocked" },
      ),
    )
    expect(items.every((item) => !item.done)).toBe(true)
    const blockers = payrollBlockers(items)
    expect(blockers).toHaveLength(5)
    expect(blockers[0]).toBe("Employment agreement signed: waiting on Anya to sign")
    expect(blockers[1]).toMatch(/client to pay \$1,000\.00/)
    expect(blockers[4]).toMatch(/Anya to upload identity documents/)
  })

  it("explains a deposit that is paid or processing but not yet confirmed", () => {
    const processing = preflightItems(preflight({ deposit: { state: "processing", amountLabel: null } }, { pay_deposit: "ready", confirm_deposit: "blocked" }))
    expect(processing[1].detail).toMatch(/processing/)
    const paid = preflightItems(preflight({}, { confirm_deposit: "ready" }))
    expect(paid[1].done).toBe(false)
    expect(paid[1].detail).toMatch(/waiting on Finance/i)
  })

  it("links a ready I-9 to its task and treats an on-file form as done", () => {
    const items = preflightItems(preflight({}, { verify_i9_section2: "ready", w4: "blocked" }))
    expect(items[4].href).toBe("/onboarding?open=task_verify_i9_section2")
    expect(items[4].detail).toBe("Documents are ready to verify")
    expect(items[2].done).toBe(true)
  })

  it("uses the latest instance of a key", () => {
    const input = preflight()
    const tasks = [{ id: "old", key: "verify_i9_section2", status: "done" as const, party: "specialist" as const }, ...input.tasks.filter((task) => task.key !== "verify_i9_section2"), { id: "new", key: "verify_i9_section2", status: "blocked" as const, party: "specialist" as const }]
    expect(preflightItems({ ...input, tasks })[4].done).toBe(false)
  })
})

describe("I-9 review helpers", () => {
  it("requires a document, and words for OTHER", () => {
    expect(rejectionProblem({ code: "DOC_EXPIRED", note: "", documents: [] })).toMatch(/Choose which document/)
    expect(rejectionProblem({ code: "OTHER", note: "  ", documents: ["List A"] })).toMatch(/Describe/)
    expect(rejectionProblem({ code: "DOC_EXPIRED", note: "", documents: ["List A"] })).toBeNull()
  })

  it("builds the reason with the documents named, keeping the code", () => {
    expect(buildRejectReason({ code: "DOC_ILLEGIBLE", note: " too dark ", documents: ["List B", "List C"] })).toEqual({
      code: "DOC_ILLEGIBLE",
      note: "List B and List C: too dark",
    })
    expect(buildRejectReason({ code: "DOC_EXPIRED", note: "", documents: ["List A"] })).toEqual({ code: "DOC_EXPIRED", note: "List A" })
    expect(buildRejectReason({ code: "OTHER", note: "Photo is of a screen", documents: ["List A"] })).toEqual({ code: "OTHER", note: "List A: Photo is of a screen" })
    expect(() => buildRejectReason({ code: "OTHER", note: "", documents: ["List A"] })).toThrow()
  })

  it("lists earlier rejections of the I-9 check and ignores everything else", () => {
    const at = new Date("2026-02-01T10:00:00Z")
    const history = rejectionHistory([
      { id: "a", key: "verify_i9_section2", status: "rejected", completedAt: at, completedByName: "Sam", result: { reason: { code: "DOC_EXPIRED", note: "List A: expired" } } },
      { id: "b", key: "verify_i9_section2", status: "done", completedAt: at, completedByName: "Sam", result: {} },
      { id: "c", key: "w4", status: "rejected", completedAt: at, completedByName: "Sam", result: { reason: { code: "OTHER", note: "x" } } },
      { id: "d", key: "verify_i9_section2", status: "rejected", completedAt: at, completedByName: null, result: { reason: { code: "NOT_A_CODE" } } },
    ])
    expect(history).toEqual([{ taskId: "a", at: at.toISOString(), code: "DOC_EXPIRED", note: "List A: expired", by: "Sam" }])
  })
})

describe("confirmationProblem", () => {
  it("needs a value of at most 60 characters", () => {
    expect(confirmationProblem("   ")).toMatch(/Enter/)
    expect(confirmationProblem("x".repeat(CONFIRMATION_MAX + 1))).toMatch(/60/)
    expect(confirmationProblem("NH-2026-0042")).toBeNull()
    expect(confirmationProblem("x".repeat(CONFIRMATION_MAX))).toBeNull()
  })
})

describe("stage progress text", () => {
  it("writes stage progress in words", () => {
    expect(stageProgressText({ status: "onboarding", stage: { title: "Paperwork" }, stageProgress: { done: 2, total: 5 } })).toBe("Paperwork · 2 of 5 steps")
    expect(stageProgressText({ status: "onboarding", stage: null, stageProgress: { done: 5, total: 5 } })).toBe("5 of 5 steps")
    expect(stageProgressText({ status: "active", stage: null, stageProgress: { done: 5, total: 5 } })).toBe("Onboarding complete")
    expect(stageProgressText({ status: "inactive", stage: null, stageProgress: { done: 1, total: 5 } })).toBe("Not onboarding")
  })
})
