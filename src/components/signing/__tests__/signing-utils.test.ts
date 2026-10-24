import { describe, expect, it } from "vitest"

import type { SignatureField } from "@/domain/forms"

import { adoptionErrors, defaultInitials, fieldBox, formatSigningDate, sortFields } from "../signing-utils"

const field = (id: string, page: number, x: number, y: number, height = 20): SignatureField => ({
  id,
  page,
  x,
  y,
  width: 100,
  height,
  kind: "signature",
  required: true,
  label: id,
  signerRole: "Employee",
})

describe("fieldBox", () => {
  const page = { width: 600, height: 800 }

  it("converts PDF points from the bottom-left to percentages from the top-left", () => {
    const box = fieldBox({ x: 60, y: 100, width: 300, height: 40 }, page)
    expect(box.left).toBeCloseTo(10)
    expect(box.width).toBeCloseTo(50)
    expect(box.height).toBeCloseTo(5)
    // The top edge is 800 - 100 - 40 = 660 points from the top.
    expect(box.top).toBeCloseTo(82.5)
  })

  it("grows thin fields upward from their bottom edge", () => {
    const thin = fieldBox({ x: 0, y: 100, width: 100, height: 10 }, page, 20)
    expect(thin.height).toBeCloseTo(2.5)
    expect(thin.top).toBeCloseTo(((800 - 100 - 20) / 800) * 100)
  })
})

describe("sortFields", () => {
  it("orders by page, then top to bottom, then left to right", () => {
    const sorted = sortFields([field("c", 1, 10, 700), field("b", 0, 300, 100), field("a", 0, 10, 100), field("top", 0, 10, 600)])
    expect(sorted.map((f) => f.id)).toEqual(["top", "a", "b", "c"])
  })
})

describe("formatSigningDate", () => {
  it("prints MM/DD/YYYY in Eastern time", () => {
    expect(formatSigningDate(new Date("2026-10-24T16:03:00Z"))).toBe("10/24/2026")
    expect(formatSigningDate(new Date("2026-10-25T02:30:00Z"))).toBe("10/24/2026")
    expect(formatSigningDate(new Date("2026-01-05T04:59:00Z"))).toBe("01/04/2026")
  })
})

describe("defaultInitials", () => {
  it("takes the first letter of each name part", () => {
    expect(defaultInitials("Maria L. Santos-Rivera")).toBe("MLS")
    expect(defaultInitials("maría o'neil")).toBe("MO")
    expect(defaultInitials("")).toBe("")
  })
})

describe("adoptionErrors", () => {
  it("accepts any expected name, ignoring case, accents and punctuation", () => {
    expect(adoptionErrors("maria l santos rivera", "MLS", ["Maria Santos-Rivera", "Maria L. Santos-Rivera"])).toEqual({})
  })

  it("rejects a different name and shows the expected one", () => {
    expect(adoptionErrors("Marie Santos", "MS", ["Maria Santos"]).typedName).toMatch(/Maria Santos/)
  })

  it("needs a first and last name when no name is expected", () => {
    expect(adoptionErrors("Maria", "M", []).typedName).toBe("Type your first and last name.")
  })

  it("needs initials of at most four letters", () => {
    expect(adoptionErrors("Maria Santos", "", ["Maria Santos"]).initials).toBeDefined()
    expect(adoptionErrors("Maria Santos", "ABCDE", ["Maria Santos"]).initials).toBeDefined()
  })
})
