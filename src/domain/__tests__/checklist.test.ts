import { describe, expect, it } from "vitest"
import { checklistStatus, type ChecklistInput } from "../checklist"
import { CHECKLIST_STEP_IDS } from "../types"

const complete: ChecklistInput = {
  personalJson: { legalName: "Jordan Lee", phone: "4155550100" },
  i9AttestationJson: { status: "citizen", attestedAt: "2026-01-15T00:00:00.000Z" },
  w4Json: { filingStatus: "single" },
  bankJson: { last4: "4242" },
  benefitsAcked: true,
}

describe("checklistStatus", () => {
  it("is complete when every step is present", () => {
    expect(checklistStatus(complete)).toEqual({ complete: true, missing: [] })
  })

  it("names each missing step on its own", () => {
    expect(checklistStatus({ ...complete, personalJson: null }).missing).toEqual(["personal"])
    expect(
      checklistStatus({
        ...complete,
        personalJson: { legalName: "  ", phone: "4155550100" },
      }).missing,
    ).toEqual(["personal"])
    expect(
      checklistStatus({
        ...complete,
        personalJson: { legalName: "Jordan Lee", phone: "" },
      }).missing,
    ).toEqual(["personal"])
    expect(checklistStatus({ ...complete, i9AttestationJson: null }).missing).toEqual(["i9"])
    expect(
      checklistStatus({
        ...complete,
        i9AttestationJson: { status: "alien_authorized", attestedAt: "2026-01-15T00:00:00.000Z" },
      }).missing,
    ).toEqual(["i9"])
    expect(
      checklistStatus({
        ...complete,
        i9AttestationJson: {
          status: "alien_authorized",
          attestedAt: "2026-01-15T00:00:00.000Z",
          workAuthExpiresOn: "2027-01-15",
        },
      }).complete,
    ).toBe(true)
    expect(checklistStatus({ ...complete, w4Json: { filingStatus: "joint" } }).missing).toEqual([
      "w4",
    ])
    expect(checklistStatus({ ...complete, bankJson: { last4: "123" } }).missing).toEqual(["bank"])
    expect(checklistStatus({ ...complete, bankJson: { last4: "12a4" } }).missing).toEqual(["bank"])
    expect(checklistStatus({ ...complete, benefitsAcked: false }).missing).toEqual(["benefits_ack"])
  })

  it("lists every missing step in checklist order", () => {
    const status = checklistStatus({
      personalJson: null,
      i9AttestationJson: null,
      w4Json: null,
      bankJson: null,
      benefitsAcked: false,
    })
    expect(status.complete).toBe(false)
    expect(status.missing).toEqual([...CHECKLIST_STEP_IDS])
  })
})
