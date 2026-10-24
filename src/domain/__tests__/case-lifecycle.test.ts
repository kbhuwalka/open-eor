import { describe, expect, it } from "vitest"

import {
  clientCancelOrder,
  clientReactivate,
  clientRenewTerm,
  clientTerminate,
  createOrder,
  depositCentsFor,
} from "../case-lifecycle"
import { USER_ROLES } from "../types"
import { expectDomainError } from "./expect-domain-error"

const NOW = new Date(2026, 3, 1, 12)

const ORDER = {
  hireId: "hire_new",
  roleTitle: "Software Engineer",
  workerType: "w2_employee",
  wageCents: 6500,
  wageUnit: "hourly" as const,
  stateCode: "CA",
  package: "standard" as const,
  markupPct: 15,
}

const order = (extra: { endDate?: string | null; startDate?: string; actorRole?: (typeof USER_ROLES)[number]; wageCents?: number } = {}) =>
  createOrder({
    actorRole: "client_hr",
    now: NOW,
    startDate: "2026-05-04",
    ...ORDER,
    ...extra,
  })

describe("createOrder", () => {
  it("freezes a snapshot with a quote and sets the deposit to one month committed", () => {
    const result = order()
    expect(result.snapshot.quote).toBeDefined()
    expect(result.depositCents).toBe(result.snapshot.quote!.totals.committed.monthlyCents)
    expect(result.event).toEqual({
      type: "order_created",
      payload: { hireId: "hire_new", snapshotCapturedAt: result.snapshot.capturedAt },
    })
  })

  it("caps the deposit at the term total of a short fixed term", () => {
    const result = order({ endDate: "2026-05-06" })
    const term = result.snapshot.quote!.term!
    expect(result.depositCents).toBeLessThanOrEqual(term.committedCents)
    expect(depositCentsFor(result.snapshot.quote!)).toBe(result.depositCents)
  })

  it("keeps the end date in the snapshot and refuses one that is not after the start", () => {
    expect(order({ endDate: "2026-10-31" }).snapshot.endDate).toBe("2026-10-31")
    expect(order({ endDate: null }).snapshot.endDate).toBeNull()
    for (const endDate of ["2026-05-04", "2026-05-03", "soon"]) {
      expectDomainError(() => order({ endDate }), "END_DATE_BEFORE_START")
    }
  })

  it("checks the role first, then the start date, then the wage", () => {
    for (const actorRole of USER_ROLES.filter((role) => role !== "client_hr")) {
      expectDomainError(() => order({ actorRole, wageCents: 1 }), "FORBIDDEN_ROLE")
    }
    expectDomainError(() => order({ startDate: "2026-04-01", wageCents: 1 }), "START_DATE_TOO_SOON")
    expectDomainError(() => order({ wageCents: 1 }), "WAGE_BELOW_FLOOR")
  })
})

describe("cancel, terminate and reactivate", () => {
  const cancel = (input: Partial<Parameters<typeof clientCancelOrder>[0]> = {}) =>
    clientCancelOrder({ actorRole: "client_hr", lifecycle: "open", goLiveReached: false, ...input })
  const terminate = (input: Partial<Parameters<typeof clientTerminate>[0]> = {}) =>
    clientTerminate({ actorRole: "client_hr", lifecycle: "open", goLiveReached: true, effectiveOn: "2026-11-01", ...input })
  const reactivate = (input: Partial<Parameters<typeof clientReactivate>[0]> = {}) =>
    clientReactivate({ actorRole: "client_hr", lifecycle: "terminated", goLiveReached: true, now: NOW, ...input })

  it("cancels only an open order that has not gone live, with a trimmed optional note", () => {
    expect(cancel({ note: "  role closed " })).toEqual({
      nextLifecycle: "cancelled",
      event: { type: "request_cancelled", payload: { note: "role closed" } },
    })
    expect(cancel().event.payload).toEqual({})
    expectDomainError(() => cancel({ goLiveReached: true }), "ILLEGAL_TRANSITION")
    expectDomainError(() => cancel({ lifecycle: "cancelled" }), "ILLEGAL_TRANSITION")
    expectDomainError(() => cancel({ lifecycle: "terminated" }), "ILLEGAL_TRANSITION")
    expectDomainError(() => cancel({ actorRole: "onboarding_specialist" }), "FORBIDDEN_ROLE")
  })

  it("terminates only a live open person, with an ISO effective date", () => {
    expect(terminate({ note: "Contract ended" })).toEqual({
      nextLifecycle: "terminated",
      event: { type: "terminated", payload: { effectiveOn: "2026-11-01", note: "Contract ended" } },
    })
    expectDomainError(() => terminate({ goLiveReached: false }), "ILLEGAL_TRANSITION")
    expectDomainError(() => terminate({ lifecycle: "terminated" }), "ILLEGAL_TRANSITION")
    expectDomainError(() => terminate({ effectiveOn: "soon" }), "ILLEGAL_TRANSITION")
    expectDomainError(() => terminate({ actorRole: "worker" }), "FORBIDDEN_ROLE")
  })

  it("bounds a fixed-term last working day by the end date, but allows ending early", () => {
    expect(terminate({ effectiveOn: "2026-08-31", endDate: "2026-08-31" }).nextLifecycle).toBe("terminated")
    expect(terminate({ effectiveOn: "2026-06-01", endDate: "2026-08-31" }).nextLifecycle).toBe("terminated")
    expectDomainError(() => terminate({ effectiveOn: "2026-09-01", endDate: "2026-08-31" }), "LAST_DAY_AFTER_END_DATE")
  })

  it("reactivates a terminated person without restarting onboarding", () => {
    const result = reactivate({ note: " back on " })
    expect(result).toMatchObject({ nextLifecycle: "open", restartTasks: false })
    expect(result.event).toEqual({ type: "reactivated", payload: { note: "back on" } })
    expect(result).not.toHaveProperty("endDate")
  })

  it("reactivates a cancelled onboarding and restarts its tasks", () => {
    const result = reactivate({ lifecycle: "cancelled", goLiveReached: false })
    expect(result).toMatchObject({ nextLifecycle: "open", restartTasks: true })
    expect(result.event).toEqual({ type: "reactivated", payload: { restarted: true } })
  })

  it("refuses to reactivate an open person who is not inactive, and anyone but the client", () => {
    for (const endDate of [null, "2026-04-02", "2026-12-31"]) {
      expectDomainError(() => reactivate({ lifecycle: "open", endDate, newEndDate: "2027-01-01" }), "ILLEGAL_TRANSITION")
    }
    expectDomainError(() => reactivate({ lifecycle: "open", goLiveReached: false, endDate: "2026-03-31", newEndDate: null }), "ILLEGAL_TRANSITION")
    for (const actorRole of USER_ROLES.filter((role) => role !== "client_hr")) {
      for (const lifecycle of ["terminated", "cancelled"] as const) {
        expectDomainError(() => reactivate({ actorRole, lifecycle }), "FORBIDDEN_ROLE")
      }
    }
  })

  it("requires a new term when the old end date has passed, and validates it", () => {
    for (const lifecycle of ["terminated", "cancelled"] as const) {
      expectDomainError(() => reactivate({ lifecycle, endDate: "2026-03-31" }), "TERM_REQUIRED")
    }
    const indefinite = reactivate({ endDate: "2026-03-31", newEndDate: null })
    expect(indefinite.endDate).toBeNull()
    expect(indefinite.event).toEqual({ type: "reactivated", payload: { endDate: null } })
    expect(reactivate({ lifecycle: "cancelled", endDate: "2026-03-31", newEndDate: "2026-09-30" }).endDate).toBe("2026-09-30")
    for (const newEndDate of ["2026-04-01", "2026-03-01", "nope"]) {
      expectDomainError(() => reactivate({ endDate: "2026-03-31", newEndDate }), "END_DATE_NOT_FUTURE")
    }
    expectDomainError(
      () => reactivate({ endDate: "2026-03-31", startDate: "2026-12-01", newEndDate: "2026-11-30" }),
      "END_DATE_BEFORE_START",
    )
  })

  it("renews the term of a live person whose term ended, with no lifecycle change", () => {
    const direct = clientRenewTerm({
      actorRole: "client_hr",
      lifecycle: "open",
      goLiveReached: true,
      endDate: "2026-03-31",
      newEndDate: "2026-12-31",
      now: NOW,
      note: " renewed ",
    })
    const viaReactivate = reactivate({ lifecycle: "open", endDate: "2026-03-31", newEndDate: "2026-12-31", note: " renewed " })
    for (const result of [direct, viaReactivate]) {
      expect(result).toMatchObject({ nextLifecycle: "open", restartTasks: false, endDate: "2026-12-31" })
      expect(result.event).toEqual({ type: "reactivated", payload: { note: "renewed", endDate: "2026-12-31" } })
    }
    expectDomainError(() => reactivate({ lifecycle: "open", endDate: "2026-03-31" }), "TERM_REQUIRED")
    expectDomainError(
      () => clientRenewTerm({ actorRole: "client_hr", lifecycle: "terminated", goLiveReached: true, endDate: "2026-03-31", newEndDate: null, now: NOW }),
      "ILLEGAL_TRANSITION",
    )
  })
})
