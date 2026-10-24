import { describe, expect, it } from "vitest"

import { DEFAULT_PAGE_SIZE, parsePaging, sliceRows } from "../pagination"

describe("parsePaging", () => {
  it("defaults to page 1 and the default size", () => {
    expect(parsePaging({})).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE })
  })

  it("reads page and size, and ignores nonsense without throwing", () => {
    expect(parsePaging({ page: "3", size: "25" })).toEqual({ page: 3, size: 25 })
    expect(parsePaging({ page: "-2", size: "7" })).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE })
    expect(parsePaging({ page: "abc", size: ["50", "10"] })).toEqual({ page: 1, size: 50 })
  })

  it("a prefix lets one screen hold two lists", () => {
    expect(parsePaging({ page: "2", ipage: "4", isize: "100" }, "i")).toEqual({ page: 4, size: 100 })
  })
})

describe("sliceRows", () => {
  const rows = Array.from({ length: 23 }, (_, index) => index + 1)

  it("returns one page and the totals", () => {
    expect(sliceRows(rows, { page: 2, size: 10 })).toEqual({ rows: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], page: 2, pageSize: 10, total: 23, totalPages: 3 })
  })

  it("clamps a page past the end to the last one", () => {
    expect(sliceRows(rows, { page: 9, size: 10 })).toMatchObject({ rows: [21, 22, 23], page: 3 })
  })

  it("an empty list is one empty page", () => {
    expect(sliceRows([], { page: 1, size: 10 })).toEqual({ rows: [], page: 1, pageSize: 10, total: 0, totalPages: 1 })
  })
})
