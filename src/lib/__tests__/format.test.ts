import { describe, expect, it } from "vitest"

import { formatCents, formatCompactCents } from "../format"

describe("formatCompactCents", () => {
  it("prints whole dollars below a thousand", () => {
    expect(formatCompactCents(0)).toBe("$0")
    expect(formatCompactCents(49)).toBe("$0")
    expect(formatCompactCents(95_040)).toBe("$950")
  })

  it("keeps one decimal below a hundred units and none above", () => {
    expect(formatCompactCents(123_400)).toBe("$1.2K")
    expect(formatCompactCents(3_845_000)).toBe("$38.5K")
    expect(formatCompactCents(21_234_500)).toBe("$212K")
    expect(formatCompactCents(123_456_700)).toBe("$1.2M")
    expect(formatCompactCents(1_234_567_800)).toBe("$12.3M")
  })

  it("rolls over to the next unit instead of printing 1,000K", () => {
    expect(formatCompactCents(99_950)).toBe("$1K")
    expect(formatCompactCents(99_999_900)).toBe("$1M")
  })

  it("keeps the sign of a negative amount", () => {
    expect(formatCompactCents(-123_400)).toBe("-$1.2K")
  })

  it("is the rounded form of the exact figure", () => {
    expect(formatCents(3_845_012)).toBe("$38,450.12")
    expect(formatCompactCents(3_845_012)).toBe("$38.5K")
  })
})
