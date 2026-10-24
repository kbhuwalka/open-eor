import { describe, expect, it } from "vitest"

import { DomainError } from "@/domain/types"

import { toActionError } from "../action-result"

const message = (details?: Record<string, unknown>) => {
  const result = toActionError(new DomainError("ILLEGAL_TRANSITION", details))
  if (result.ok) throw new Error("unreachable")
  expect(result.code).toBe("ILLEGAL_TRANSITION")
  return result.message
}

describe("ILLEGAL_TRANSITION reads as a sentence, never as a code", () => {
  const cases: [string, Record<string, unknown> | undefined, RegExp][] = [
    ["a payment that is no longer initiated", { entity: "payment", from: "succeeded", to: "failed" }, /payment is no longer waiting on Finance/],
    ["a void invoice", { entity: "invoice", from: "void", to: "void" }, /already void/],
    ["an invoice with a payment", { entity: "invoice", from: "processing", to: "void" }, /has a payment/],
    ["a deposit with nothing in flight", { entity: "deposit", to: "not_received" }, /nothing to mark as not received/],
    ["a deposit step that is not waiting", { entity: "deposit", to: "received" }, /no deposit step waiting for Finance/],
    ["cancelling a person who started", { from: "open", reason: "already_live" }, /already started/],
    ["ending employment before the start", { from: "open", reason: "not_live" }, /not started yet/],
    ["renewing a term that has not ended", { from: "open", reason: "term_not_ended" }, /nothing to renew/],
    ["a cancelled order", { from: "cancelled", allowedFrom: ["open"] }, /was cancelled/],
    ["a terminated person", { from: "terminated", allowedFrom: ["open"] }, /employment has ended/],
    ["details we know nothing about", undefined, /not possible right now/],
  ]

  it.each(cases)("%s", (_name, details, expected) => {
    const text = message(details)
    expect(text).toMatch(expected)
    expect(text).not.toMatch(/ILLEGAL_TRANSITION|[A-Z]+_[A-Z_]+/)
    expect(text.endsWith(".")).toBe(true)
  })
})
