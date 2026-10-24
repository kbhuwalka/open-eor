import { describe, expect, it } from "vitest"

import { pageWindow, showPagination, totalPagesFor } from "../pagination"
import {
  DEFAULT_PEOPLE_QUERY,
  cycleSort,
  hasActiveFilters,
  parsePeopleQuery,
  peopleSearch,
  withPeopleChange,
} from "../people-query"

describe("parsePeopleQuery", () => {
  it("falls back to defaults for an empty or hostile query", () => {
    expect(parsePeopleQuery({})).toEqual(DEFAULT_PEOPLE_QUERY)
    expect(
      parsePeopleQuery({
        status: "pending",
        role: "../etc",
        location: "california",
        sort: "password",
        page: "-4",
        size: "7",
        dir: "sideways",
      })
    ).toEqual(DEFAULT_PEOPLE_QUERY)
  })

  it("reads valid values, normalising case and whitespace", () => {
    expect(
      parsePeopleQuery({
        q: "  priya ",
        status: "active",
        role: "role_data_engineer",
        location: "ny",
        sort: "status",
        dir: "desc",
        page: "3",
        size: "25",
      })
    ).toEqual({
      q: "priya",
      status: "active",
      role: "role_data_engineer",
      location: "NY",
      sort: "status",
      dir: "desc",
      page: 3,
      size: 25,
    })
  })

  it("takes the first of repeated params", () => {
    expect(parsePeopleQuery({ status: ["inactive", "active"] }).status).toBe("inactive")
  })
})

describe("peopleSearch", () => {
  it("omits defaults so the plain list URL is clean", () => {
    expect(peopleSearch(DEFAULT_PEOPLE_QUERY)).toBe("")
  })

  it("round-trips through parsePeopleQuery", () => {
    const query = {
      q: "a b",
      status: "onboarding" as const,
      role: "role_software_engineer",
      location: "CA",
      sort: "name" as const,
      dir: "desc" as const,
      page: 2,
      size: 50 as const,
    }
    const params = Object.fromEntries(new URLSearchParams(peopleSearch(query)))
    expect(parsePeopleQuery(params)).toEqual(query)
  })
})

describe("withPeopleChange", () => {
  it("resets to page 1 for filter, sort and size changes, but not for page changes", () => {
    const base = { ...DEFAULT_PEOPLE_QUERY, page: 4 }
    expect(withPeopleChange(base, { status: "active" }).page).toBe(1)
    expect(withPeopleChange(base, { size: 25 }).page).toBe(1)
    expect(withPeopleChange(base, { page: 5 }).page).toBe(5)
  })
})

describe("cycleSort", () => {
  it("cycles none → asc → desc → none, and restarts on a new column", () => {
    const one = cycleSort({ sort: null, dir: "asc" }, "name")
    expect(one).toEqual({ sort: "name", dir: "asc" })
    const two = cycleSort(one, "name")
    expect(two).toEqual({ sort: "name", dir: "desc" })
    expect(cycleSort(two, "name")).toEqual({ sort: null, dir: "asc" })
    expect(cycleSort(two, "role")).toEqual({ sort: "role", dir: "asc" })
  })
})

describe("hasActiveFilters", () => {
  it("counts search, status and location but not sort or paging", () => {
    expect(hasActiveFilters({ ...DEFAULT_PEOPLE_QUERY, sort: "name", page: 3 })).toBe(false)
    expect(hasActiveFilters({ ...DEFAULT_PEOPLE_QUERY, q: "x" })).toBe(true)
    expect(hasActiveFilters({ ...DEFAULT_PEOPLE_QUERY, location: "TX" })).toBe(true)
    expect(hasActiveFilters({ ...DEFAULT_PEOPLE_QUERY, role: "role_x" })).toBe(true)
  })
})

describe("pagination helpers", () => {
  it("shows every page up to seven, then collapses with ellipses", () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pageWindow(1, 20)).toEqual([1, 2, "ellipsis", 20])
    expect(pageWindow(10, 20)).toEqual([1, "ellipsis", 9, 10, 11, "ellipsis", 20])
    expect(pageWindow(20, 20)).toEqual([1, "ellipsis", 19, 20])
  })

  it("computes pages and hides the bar when everything fits", () => {
    expect(totalPagesFor(0, 10)).toBe(1)
    expect(totalPagesFor(21, 10)).toBe(3)
    expect(showPagination(10)).toBe(false)
    expect(showPagination(11)).toBe(true)
  })
})
