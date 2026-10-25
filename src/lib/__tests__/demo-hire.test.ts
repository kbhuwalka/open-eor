import { describe, expect, it } from "vitest"

import { effectiveHourlyCents, resolveWageFloor } from "@/domain/wage"

import { demoHire } from "../demo-hire"
import { isDemoShortcut } from "../demo-shortcut"

const base = { roleIds: ["role_a", "role_b"], earliestStart: "2026-11-02", wageUnit: "annual" as const }

function sequence(...values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]
}

describe("demoHire", () => {
  it("makes a named hire whose email matches the name", () => {
    const hire = demoHire({ ...base, random: sequence(0, 0, 0, 0, 0) })
    expect(hire).toMatchObject({ firstName: "Maya", lastName: "Whitfield", email: "maya.whitfield@example.com", stateCode: "CA", roleId: "role_a" })
  })

  it("starts one or two weeks after the earliest start, on the same weekday", () => {
    expect(demoHire({ ...base, random: sequence(0) }).startDate).toBe("2026-11-09")
    expect(demoHire({ ...base, random: sequence(0.99) }).startDate).toBe("2026-11-16")
  })

  it("writes the salary in the unit the form is on, always above the state's wage floor", () => {
    expect(demoHire({ ...base, random: sequence(0) }).wage).toBe("78000")
    expect(demoHire({ ...base, wageUnit: "monthly", random: sequence(0) }).wage).toBe("6500")
    expect(demoHire({ ...base, wageUnit: "hourly", random: sequence(0) }).wage).toBe("37.50")
    for (let i = 0; i < 200; i += 1) {
      const hire = demoHire(base)
      expect(effectiveHourlyCents(Number(hire.wage) * 100, "annual")).toBeGreaterThan(resolveWageFloor(hire.stateCode).effectiveHourlyCents)
    }
  })

  it("leaves the role empty when the company has none, and never indexes past the lists", () => {
    expect(demoHire({ ...base, roleIds: [], random: sequence(0.5) }).roleId).toBeNull()
    expect(() => demoHire({ ...base, random: sequence(1) })).not.toThrow()
  })
})

describe("isDemoShortcut", () => {
  const key = { code: "KeyD", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false }

  it("is Alt+Shift+D on the physical D key, and nothing else", () => {
    expect(isDemoShortcut(key)).toBe(true)
    expect(isDemoShortcut({ ...key, altKey: false })).toBe(false)
    expect(isDemoShortcut({ ...key, shiftKey: false })).toBe(false)
    expect(isDemoShortcut({ ...key, ctrlKey: true })).toBe(false)
    expect(isDemoShortcut({ ...key, metaKey: true })).toBe(false)
    expect(isDemoShortcut({ ...key, code: "KeyF" })).toBe(false)
    expect(isDemoShortcut({ ...key, repeat: true })).toBe(false)
  })
})
