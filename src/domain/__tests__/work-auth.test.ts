import { describe, expect, it } from "vitest"
import type { DocumentKind } from "../types"
import { assertRejectReason, isWorkAuthListComboValid, selectActiveDocuments, selectActiveIdentityDocuments } from "../work-auth"
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

describe("selectActiveIdentityDocuments", () => {
  const doc = (id: string, kind: DocumentKind, createdAt: number) => ({ id, kind, createdAt })
  const ids = (documents: { id: string }[]) => documents.map((document) => document.id)

  it("lets List A supersede List B and C, and B or C supersede A", () => {
    expect(ids(selectActiveIdentityDocuments([doc("b", "list_b", 1), doc("c", "list_c", 2), doc("a", "list_a", 3)]))).toEqual(["a"])
    expect(ids(selectActiveIdentityDocuments([doc("a", "list_a", 1), doc("b", "list_b", 2), doc("c", "list_c", 3)]))).toEqual(["b", "c"])
    expect(ids(selectActiveIdentityDocuments([doc("a", "list_a", 1), doc("b", "list_b", 2)]))).toEqual(["b"])
  })

  it("keeps a superseded document superseded when the family switches back", () => {
    const history = [doc("b1", "list_b", 1), doc("c1", "list_c", 2), doc("a1", "list_a", 3), doc("b2", "list_b", 4)]
    expect(ids(selectActiveIdentityDocuments(history))).toEqual(["b2"])
  })

  it("still keeps the newest per kind, ignores input order, and leaves w4 and other alone", () => {
    const history = [doc("c", "list_c", 4), doc("w4", "w4", 2), doc("b1", "list_b", 1), doc("b2", "list_b", 3), doc("other", "other", 9), doc("a", "list_a", 0)]
    expect(ids(selectActiveIdentityDocuments(history))).toEqual(["b2", "c", "w4", "other"])
  })

  it("lets the later row win when createdAt ties", () => {
    expect(ids(selectActiveIdentityDocuments([doc("b", "list_b", 5), doc("a", "list_a", 5)]))).toEqual(["a"])
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
