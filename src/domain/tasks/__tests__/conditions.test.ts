import { describe, expect, it } from "vitest"

import { conditionFacts, evaluateCondition } from "../conditions"
import type { Condition, Facts } from "../types"

const facts: Facts = {
  "order.benefitPackage": "standard",
  "order.endDate": null,
  "order.fixedTerm": false,
  "order.depositCents": 500,
  "result.benefits_decision.decision": "enroll",
}

const ev = (condition: Condition | undefined, f: Facts = facts) => evaluateCondition(condition, f)

describe("evaluateCondition", () => {
  it("treats a missing condition as true", () => {
    expect(ev(undefined)).toBe(true)
  })

  it("compares equality and ordering", () => {
    expect(ev({ fact: "order.fixedTerm", op: "eq", value: false })).toBe(true)
    expect(ev({ fact: "order.fixedTerm", op: "neq", value: false })).toBe(false)
    expect(ev({ fact: "order.depositCents", op: "gt", value: 400 })).toBe(true)
    expect(ev({ fact: "order.depositCents", op: "gte", value: 500 })).toBe(true)
    expect(ev({ fact: "order.depositCents", op: "lt", value: 500 })).toBe(false)
    expect(ev({ fact: "order.depositCents", op: "lte", value: 500 })).toBe(true)
  })

  it("does not order values of different types", () => {
    expect(ev({ fact: "order.benefitPackage", op: "gt", value: 1 })).toBe(false)
  })

  it("supports membership", () => {
    expect(ev({ fact: "order.benefitPackage", op: "in", value: ["standard", "plus"] })).toBe(true)
    expect(ev({ fact: "order.benefitPackage", op: "in", value: ["plus"] })).toBe(false)
  })

  it("treats null as unset and a present value as set", () => {
    expect(ev({ fact: "order.endDate", op: "unset" })).toBe(true)
    expect(ev({ fact: "order.endDate", op: "set" })).toBe(false)
    expect(ev({ fact: "order.benefitPackage", op: "set" })).toBe(true)
  })

  it("is pending when a result fact is not known yet", () => {
    const early: Facts = { "order.benefitPackage": "standard" }
    expect(ev({ fact: "result.benefits_decision.decision", op: "eq", value: "enroll" }, early)).toBe("pending")
    expect(ev({ fact: "result.benefits_decision.decision", op: "set" }, early)).toBe("pending")
    expect(ev({ fact: "result.benefits_decision.decision", op: "in", value: ["enroll"] }, early)).toBe("pending")
  })

  it("combines three-valued results with and, or and not", () => {
    const pending: Condition = { fact: "result.x.y", op: "eq", value: 1 }
    const yes: Condition = { fact: "order.fixedTerm", op: "eq", value: false }
    const no: Condition = { fact: "order.fixedTerm", op: "eq", value: true }
    expect(ev({ op: "and", of: [yes, pending] })).toBe("pending")
    expect(ev({ op: "and", of: [no, pending] })).toBe(false)
    expect(ev({ op: "or", of: [yes, pending] })).toBe(true)
    expect(ev({ op: "or", of: [no, pending] })).toBe("pending")
    expect(ev({ op: "not", of: pending })).toBe("pending")
    expect(ev({ op: "not", of: no })).toBe(true)
  })
})

describe("conditionFacts", () => {
  it("lists every fact a nested condition reads", () => {
    const condition: Condition = {
      op: "and",
      of: [
        { fact: "a", op: "set" },
        { op: "not", of: { op: "or", of: [{ fact: "b", op: "eq", value: 1 }, { fact: "c", op: "in", value: [] }] } },
      ],
    }
    expect(conditionFacts(condition)).toEqual(["a", "b", "c"])
    expect(conditionFacts(undefined)).toEqual([])
  })
})
