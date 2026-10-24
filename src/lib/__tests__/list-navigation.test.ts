import { describe, expect, it } from "vitest"

import { cursorKeyOf, moveCursor, positionIn, stepIn } from "../list-navigation"

const ids = ["a", "b", "c"]

describe("positionIn and stepIn", () => {
  it("places an id in its list, zero-based, and nothing that is not there", () => {
    expect(positionIn(ids, "b")).toEqual({ index: 1, total: 3 })
    expect(positionIn(ids, "z")).toBeNull()
  })

  it("steps one row either way and stops at both ends", () => {
    expect(stepIn(ids, "b", 1)).toBe("c")
    expect(stepIn(ids, "b", -1)).toBe("a")
    expect(stepIn(ids, "c", 1)).toBeNull()
    expect(stepIn(ids, "a", -1)).toBeNull()
    expect(stepIn(ids, "z", 1)).toBeNull()
  })
})

describe("cursorKeyOf and moveCursor", () => {
  it("reads j and ArrowDown as down, k and ArrowUp as up, and nothing else", () => {
    expect(cursorKeyOf("j")).toBe("down")
    expect(cursorKeyOf("ArrowDown")).toBe("down")
    expect(cursorKeyOf("k")).toBe("up")
    expect(cursorKeyOf("ArrowUp")).toBe("up")
    expect(cursorKeyOf("J")).toBeNull()
    expect(cursorKeyOf("Enter")).toBeNull()
  })

  it("lands on the first row from nothing and clamps at either end without wrapping", () => {
    expect(moveCursor(ids, null, "down")).toBe("a")
    expect(moveCursor(ids, null, "up")).toBe("a")
    expect(moveCursor(ids, "a", "down")).toBe("b")
    expect(moveCursor(ids, "c", "down")).toBe("c")
    expect(moveCursor(ids, "a", "up")).toBe("a")
  })

  it("restarts from the top when the cursor row left the list, and has no cursor in an empty list", () => {
    expect(moveCursor(ids, "gone", "down")).toBe("a")
    expect(moveCursor([], null, "down")).toBeNull()
  })
})
