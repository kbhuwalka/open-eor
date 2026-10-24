/**
 * Three-valued condition evaluation over facts (tasks-and-workflow.md §4). A missing fact makes a
 * comparison `pending`, so a condition can be decided as early as the facts allow.
 */
import type { Condition, Facts, Json } from "./types"

export type Truth = boolean | "pending"

function isSet(value: Json | undefined): boolean {
  return value !== undefined && value !== null
}

function compare(op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte", left: Json, right: Json): boolean {
  switch (op) {
    case "eq":
      return JSON.stringify(left) === JSON.stringify(right)
    case "neq":
      return JSON.stringify(left) !== JSON.stringify(right)
  }
  if (typeof left !== typeof right || (typeof left !== "number" && typeof left !== "string")) {
    return false
  }
  const a = left as number | string
  const b = right as number | string
  switch (op) {
    case "gt":
      return a > b
    case "gte":
      return a >= b
    case "lt":
      return a < b
    case "lte":
      return a <= b
  }
}

export function evaluateCondition(condition: Condition | undefined, facts: Facts): Truth {
  if (!condition) return true
  switch (condition.op) {
    case "and": {
      const parts = condition.of.map((part) => evaluateCondition(part, facts))
      if (parts.includes(false)) return false
      return parts.includes("pending") ? "pending" : true
    }
    case "or": {
      const parts = condition.of.map((part) => evaluateCondition(part, facts))
      if (parts.includes(true)) return true
      return parts.includes("pending") ? "pending" : false
    }
    case "not": {
      const inner = evaluateCondition(condition.of, facts)
      return inner === "pending" ? "pending" : !inner
    }
    case "set":
    case "unset": {
      const value = facts[condition.fact]
      if (value === undefined && condition.fact.startsWith("result.")) return "pending"
      return condition.op === "set" ? isSet(value) : !isSet(value)
    }
    case "in": {
      const value = facts[condition.fact]
      if (value === undefined) return "pending"
      return condition.value.some((candidate) => compare("eq", value, candidate))
    }
    default: {
      const comparison = condition as { fact: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: Json }
      const value = facts[comparison.fact]
      if (value === undefined) return "pending"
      return compare(comparison.op, value, comparison.value)
    }
  }
}

/** Every fact a condition reads. */
export function conditionFacts(condition: Condition | undefined): string[] {
  if (!condition) return []
  if (condition.op === "and" || condition.op === "or") return condition.of.flatMap(conditionFacts)
  if (condition.op === "not") return conditionFacts(condition.of)
  return [(condition as { fact: string }).fact]
}
