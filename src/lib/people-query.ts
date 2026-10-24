import { isPersonStatus, type PersonStatus } from "@/domain/person-status"

import { DEFAULT_PAGE_SIZE, isPageSize, type PageSize } from "./pagination"

export const PEOPLE_SORT_KEYS = ["name", "role", "location", "status"] as const
export type PeopleSortKey = (typeof PEOPLE_SORT_KEYS)[number]
export type SortDir = "asc" | "desc"

/**
 * People list state, carried in the URL. `sort: null` means "most recent
 * activity first" (the default ordering).
 */
export type PeopleQuery = {
  q: string
  status: PersonStatus | null
  /** Role id. */
  role: string | null
  location: string | null
  sort: PeopleSortKey | null
  dir: SortDir
  page: number
  size: PageSize
}

export const DEFAULT_PEOPLE_QUERY: PeopleQuery = {
  q: "",
  status: null,
  role: null,
  location: null,
  sort: null,
  dir: "asc",
  page: 1,
  size: DEFAULT_PAGE_SIZE,
}

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isSortKey(value: unknown): value is PeopleSortKey {
  return typeof value === "string" && (PEOPLE_SORT_KEYS as readonly string[]).includes(value)
}

/** Never throws: anything unrecognised falls back to the default. */
export function parsePeopleQuery(params: RawParams): PeopleQuery {
  const status = first(params.status)
  const role = first(params.role)
  const location = first(params.location)?.toUpperCase()
  const sort = first(params.sort)
  const page = Number.parseInt(first(params.page) ?? "", 10)
  const size = Number.parseInt(first(params.size) ?? "", 10)
  return {
    q: (first(params.q) ?? "").trim().slice(0, 100),
    status: isPersonStatus(status) ? status : null,
    role: role && /^[\w-]{1,64}$/.test(role) ? role : null,
    location: location && /^[A-Z]{2}$/.test(location) ? location : null,
    sort: isSortKey(sort) ? sort : null,
    dir: first(params.dir) === "desc" ? "desc" : "asc",
    page: Number.isFinite(page) && page > 1 ? page : 1,
    size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/** Query string with defaults omitted, so the plain list URL stays clean. */
export function peopleSearch(query: PeopleQuery): string {
  const p = new URLSearchParams()
  if (query.q) p.set("q", query.q)
  if (query.status) p.set("status", query.status)
  if (query.role) p.set("role", query.role)
  if (query.location) p.set("location", query.location)
  if (query.sort) {
    p.set("sort", query.sort)
    p.set("dir", query.dir)
  }
  if (query.page > 1) p.set("page", String(query.page))
  if (query.size !== DEFAULT_PAGE_SIZE) p.set("size", String(query.size))
  const text = p.toString()
  return text ? `?${text}` : ""
}

/** Filters and sort changes go back to page 1; only `page` itself keeps it. */
export function withPeopleChange(query: PeopleQuery, patch: Partial<PeopleQuery>): PeopleQuery {
  const resetsPage = !("page" in patch)
  return { ...query, ...patch, ...(resetsPage ? { page: 1 } : {}) }
}

/** Header click: none → ascending → descending → none. */
export function cycleSort(
  query: Pick<PeopleQuery, "sort" | "dir">,
  key: PeopleSortKey
): Pick<PeopleQuery, "sort" | "dir"> {
  if (query.sort !== key) return { sort: key, dir: "asc" }
  if (query.dir === "asc") return { sort: key, dir: "desc" }
  return { sort: null, dir: "asc" }
}

export function hasActiveFilters(query: PeopleQuery): boolean {
  return Boolean(query.q || query.status || query.role || query.location)
}
