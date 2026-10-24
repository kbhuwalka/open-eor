/**
 * The People & cases directory's state, carried in the URL (onboarding-portal.md §5), and the one
 * ordering rule it uses. Pure and total: anything unrecognised falls back to the default.
 */
import { isIsoDate } from "@/domain/employment-term"
import { isPersonStatus, type PersonStatus } from "@/domain/person-status"

import { DEFAULT_PAGE_SIZE, isPageSize, type PageSize } from "../pagination"

export type CasesQuery = {
  q: string
  status: PersonStatus | null
  atRisk: boolean
  /** Stage id of the case's current stage (from the workflow template). */
  stage: string | null
  client: string | null
  /** Inclusive `YYYY-MM-DD` bounds on the start date. */
  startFrom: string | null
  startTo: string | null
  page: number
  size: PageSize
}

export const DEFAULT_CASES_QUERY: CasesQuery = {
  q: "",
  status: null,
  atRisk: false,
  stage: null,
  client: null,
  startFrom: null,
  startTo: null,
  page: 1,
  size: DEFAULT_PAGE_SIZE,
}

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const ID = /^[\w-]{1,64}$/

export function parseCasesQuery(params: RawParams): CasesQuery {
  const status = first(params.status)
  const stage = first(params.stage)
  const client = first(params.client)
  const from = first(params.startFrom)
  const to = first(params.startTo)
  const page = Number.parseInt(first(params.page) ?? "", 10)
  const size = Number.parseInt(first(params.size) ?? "", 10)
  return {
    q: (first(params.q) ?? "").trim().slice(0, 100),
    status: isPersonStatus(status) ? status : null,
    atRisk: first(params.atRisk) === "1",
    stage: stage && ID.test(stage) ? stage : null,
    client: client && ID.test(client) ? client : null,
    startFrom: isIsoDate(from) ? from : null,
    startTo: isIsoDate(to) ? to : null,
    page: Number.isFinite(page) && page > 1 ? page : 1,
    size: isPageSize(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/** Query string with defaults omitted. */
export function casesSearch(query: CasesQuery): string {
  const p = new URLSearchParams()
  if (query.q) p.set("q", query.q)
  if (query.status) p.set("status", query.status)
  if (query.atRisk) p.set("atRisk", "1")
  if (query.stage) p.set("stage", query.stage)
  if (query.client) p.set("client", query.client)
  if (query.startFrom) p.set("startFrom", query.startFrom)
  if (query.startTo) p.set("startTo", query.startTo)
  if (query.page > 1) p.set("page", String(query.page))
  if (query.size !== DEFAULT_PAGE_SIZE) p.set("size", String(query.size))
  const text = p.toString()
  return text ? `?${text}` : ""
}

/** A filter change goes back to page 1; only `page` itself keeps it. */
export function withCasesChange(query: CasesQuery, patch: Partial<CasesQuery>): CasesQuery {
  return { ...query, ...patch, ...("page" in patch ? {} : { page: 1 }) }
}

export function hasCaseFilters(query: CasesQuery): boolean {
  return Boolean(query.q || query.status || query.atRisk || query.stage || query.client || query.startFrom || query.startTo)
}

export type CaseOrderKey = {
  name: string
  status: PersonStatus
  atRisk: boolean
  /** `YYYY-MM-DD` or null (no start date sorts last). */
  startDate: string | null
}

const STATUS_RANK: Record<PersonStatus, number> = { onboarding: 0, active: 1, inactive: 2 }

/**
 * At risk first, then people still onboarding before those already active or inactive (a past start
 * date would otherwise bury the people who still need work), then the earliest start date, no date
 * last, then the name.
 */
export function compareCases(a: CaseOrderKey, b: CaseOrderKey): number {
  if (a.atRisk !== b.atRisk) return a.atRisk ? -1 : 1
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status]
  if (a.startDate !== b.startDate) {
    if (a.startDate === null) return 1
    if (b.startDate === null) return -1
    return a.startDate < b.startDate ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}
