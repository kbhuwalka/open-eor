import { describe, expect, it } from "vitest"
import type { DocumentKind } from "../types"
import { assertRejectReason, isWorkAuthListComboValid, selectActiveDocuments } from "../work-auth"
import { expectDomainError } from "./expect-domain-error"

const COMBOS: readonly [DocumentKind[], boolean][] = [
  [[], false],
  [["list_a"], true],
  [["list_b"], false],
  [["list_c"], false],
  [["list_b", "list_c"], true],
  [["list_a", "list_b"], false],
  [["list_a", "list_c"], false],
  [["list_a", "list_b", "list_c"], false],
]

describe("isWorkAuthListComboValid", () => {
  it("matches the eight List A / B / C combinations", () => {
    expect(COMBOS).toHaveLength(8)
    for (const [kinds, valid] of COMBOS) {
      expect(isWorkAuthListComboValid(kinds)).toBe(valid)
    }
  })

  it("ignores w4 and other, and treats duplicate kinds as one", () => {
    expect(isWorkAuthListComboValid(["list_a", "w4", "other"])).toBe(true)
    expect(isWorkAuthListComboValid(["list_a", "list_a"])).toBe(true)
    expect(isWorkAuthListComboValid(["list_b", "list_c", "w4"])).toBe(true)
  })
})

describe("selectActiveDocuments", () => {
  it("keeps the greatest createdAt per kind and drops superseded rows", () => {
    const active = selectActiveDocuments([
      { id: "old_a", kind: "list_a" as const, createdAt: 1 },
      { id: "b", kind: "list_b" as const, createdAt: 2 },
      { id: "new_a", kind: "list_a" as const, createdAt: 3 },
      { id: "c", kind: "list_c" as const, createdAt: 4 },
    ])
    expect(active.map((document) => document.id)).toEqual(["new_a", "b", "c"])
  })

  it("lets the later row win when createdAt ties", () => {
    const active = selectActiveDocuments([
      { id: "first", kind: "list_a" as const, createdAt: 5 },
      { id: "second", kind: "list_a" as const, createdAt: 5 },
    ])
    expect(active.map((document) => document.id)).toEqual(["second"])
  })
})

describe("assertRejectReason", () => {
  it("accepts each non-OTHER code with and without a note", () => {
    const codes = ["DOC_ILLEGIBLE", "DOC_EXPIRED", "DOC_MISMATCH", "WRONG_LIST_COMBO"] as const
    for (const code of codes) {
      expect(assertRejectReason({ code })).toEqual({ code })
      expect(assertRejectReason({ code, note: " see scan " })).toEqual({ code, note: "see scan" })
    }
  })

  it("refuses OTHER without a note, including whitespace", () => {
    expectDomainError(() => assertRejectReason({ code: "OTHER" }), "INVALID_REJECT_REASON")
    expectDomainError(() => assertRejectReason({ code: "OTHER", note: "" }), "INVALID_REJECT_REASON")
    expectDomainError(
      () => assertRejectReason({ code: "OTHER", note: "   " }),
      "INVALID_REJECT_REASON",
    )
    expect(assertRejectReason({ code: "OTHER", note: " name mismatch " })).toEqual({
      code: "OTHER",
      note: "name mismatch",
    })
  })

  it("refuses a missing or unknown code", () => {
    expectDomainError(() => assertRejectReason({}), "INVALID_REJECT_REASON")
    expectDomainError(() => assertRejectReason({ code: "NOT_A_CODE" }), "INVALID_REJECT_REASON")
    expectDomainError(() => assertRejectReason("DOC_EXPIRED"), "INVALID_REJECT_REASON")
  })
})
