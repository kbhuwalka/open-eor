/**
 * Read models behind the persona picker (`/pick`, ui-guidelines §5 C14) and the in-portal persona
 * switcher. Nothing is hardcoded: tiles, recent employees and the employee search come from `users`
 * (joined to `client_companies` and the cases). Plain serialisable objects; how a tile reads (title,
 * subtitle, initials) is `src/lib/persona-tiles.ts`.
 */
import { and, asc, desc, eq, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm"

import {
  clientCompanies,
  hireRequests,
  onboardingCases,
  users,
  type AppDatabase,
  type UserRole,
} from "@/db"
import { todayIso } from "@/domain/employment-term"
import type { PersonStatus } from "@/domain/person-status"

import { personStatusByWorker } from "./queries"

export const EMPLOYEE_SEARCH_DEFAULT_LIMIT = 50
export const EMPLOYEE_SEARCH_MAX_LIMIT = 100
export const EMPLOYEE_QUERY_MAX_LENGTH = 100
export const RECENT_EMPLOYEES_LIMIT = 3

/** A client HR user. `companyName` is null when the user is not linked to a company. */
export type ClientPersona = {
  kind: "client"
  id: string
  displayName: string
  companyName: string | null
}

/** Northwind staff: the onboarding specialist and Finance each work one shared role queue. */
export type StaffPersona = {
  kind: "staff"
  id: string
  displayName: string
  role: "onboarding_specialist" | "finance"
}

/** An employee (role `worker`); `companyName` is null when the user is not linked to a company. */
export type EmployeePersona = {
  kind: "employee"
  id: string
  displayName: string
  companyName: string | null
}

export type Persona = ClientPersona | StaffPersona | EmployeePersona

/** The picker's signed-in-directly rows, each in display order. Employees are searched instead. */
export type PickerPersonas = {
  clients: ClientPersona[]
  northwind: StaffPersona[]
}

/** An employee whose latest case went live, for the picker's "Recently started" tiles. */
export type RecentEmployee = {
  id: string
  displayName: string
  companyName: string
  /** `YYYY-MM-DD`. */
  startDate: string
}

export type EmployeeResult = {
  id: string
  displayName: string
  email: string
  companyName: string
  /** Null when the employee has no onboarding case yet. */
  status: PersonStatus | null
}

export type EmployeeSearchPage = {
  rows: EmployeeResult[]
  /** Every employee matching the query, which can exceed `rows.length` (refine your search). */
  total: number
}

const STAFF_ORDER: readonly StaffPersona["role"][] = ["onboarding_specialist", "finance"]

function byName(a: string, b: string): number {
  return a.localeCompare(b, "en-US", { sensitivity: "base" })
}

/**
 * Client tile order: by company name (case-insensitive), then person name, then id. A user without a
 * company (the schema forbids it today; the type allows it) sorts after every company.
 */
export function compareClientPersonas(a: ClientPersona, b: ClientPersona): number {
  if (a.companyName === null || b.companyName === null) {
    if (a.companyName !== b.companyName) return a.companyName === null ? 1 : -1
  } else {
    const byCompany = byName(a.companyName, b.companyName)
    if (byCompany !== 0) return byCompany
  }
  return byName(a.displayName, b.displayName) || a.id.localeCompare(b.id)
}

/**
 * Every non-employee user, grouped for the picker. Clients are ordered by company name (users
 * without a company last, by name); Northwind staff are the specialist role, then Finance, each by
 * name. Ties fall back to the id, so the order is stable.
 */
export function listPickerPersonas(db: AppDatabase): PickerPersonas {
  const rows = db
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      companyName: clientCompanies.name,
    })
    .from(users)
    .leftJoin(clientCompanies, eq(clientCompanies.id, users.clientCompanyId))
    .where(inArray(users.role, ["client_hr", ...STAFF_ORDER]))
    .orderBy(asc(users.id))
    .all()

  const clients: ClientPersona[] = []
  const northwind: StaffPersona[] = []
  for (const row of rows) {
    if (row.role === "client_hr") {
      clients.push({ kind: "client", id: row.id, displayName: row.displayName, companyName: row.companyName })
    } else if (row.role === "onboarding_specialist" || row.role === "finance") {
      northwind.push({ kind: "staff", id: row.id, displayName: row.displayName, role: row.role })
    }
  }

  clients.sort(compareClientPersonas)
  northwind.sort(
    (a, b) =>
      STAFF_ORDER.indexOf(a.role) - STAFF_ORDER.indexOf(b.role) ||
      byName(a.displayName, b.displayName) ||
      a.id.localeCompare(b.id)
  )
  return { clients, northwind }
}

/**
 * A signed-in user as the picker shows them (the switcher's "signed in as" block). Reads only the
 * company name; a missing or unknown company is `companyName: null`.
 */
export function personaOf(
  db: AppDatabase,
  user: { id: string; displayName: string; role: UserRole; clientCompanyId: string | null }
): Persona {
  const companyName =
    user.clientCompanyId === null
      ? null
      : db
          .select({ name: clientCompanies.name })
          .from(clientCompanies)
          .where(eq(clientCompanies.id, user.clientCompanyId))
          .get()?.name ?? null
  switch (user.role) {
    case "client_hr":
      return { kind: "client", id: user.id, displayName: user.displayName, companyName }
    case "worker":
      return { kind: "employee", id: user.id, displayName: user.displayName, companyName }
    case "onboarding_specialist":
    case "finance":
      return { kind: "staff", id: user.id, displayName: user.displayName, role: user.role }
  }
}

/** How many open cases are read to find `limit` live ones; bounds the status derivation. */
const RECENT_CANDIDATES = 40

/**
 * Up to `limit` employees who most recently started work: their latest case is live (person status
 * `active`, so go-live was reached), newest start date first, then name. Derived from the cases;
 * returns fewer (or none) when fewer employees are active among the most recent open cases.
 */
export function listRecentlyStartedEmployees(
  db: AppDatabase,
  limit: number = RECENT_EMPLOYEES_LIMIT,
  now: Date = new Date()
): RecentEmployee[] {
  const candidates = db
    .select({
      id: users.id,
      displayName: users.displayName,
      companyName: clientCompanies.name,
      startDate: hireRequests.startDate,
    })
    .from(onboardingCases)
    .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
    .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
    .innerJoin(clientCompanies, eq(clientCompanies.id, users.clientCompanyId))
    .where(
      and(
        eq(users.role, "worker"),
        eq(onboardingCases.lifecycle, "open"),
        isNotNull(hireRequests.startDate),
        lte(hireRequests.startDate, todayIso(now))
      )
    )
    .orderBy(desc(hireRequests.startDate), asc(sql`lower(${users.displayName})`), asc(users.id))
    .limit(RECENT_CANDIDATES)
    .all()

  const statuses = personStatusByWorker(
    db,
    candidates.map((row) => row.id),
    now
  )
  const seen = new Set<string>()
  const result: RecentEmployee[] = []
  for (const row of candidates) {
    if (result.length >= limit) break
    if (seen.has(row.id) || statuses.get(row.id) !== "active" || row.startDate === null) continue
    seen.add(row.id)
    result.push({ id: row.id, displayName: row.displayName, companyName: row.companyName, startDate: row.startDate })
  }
  return result
}

export function countEmployees(db: AppDatabase): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, "worker"))
    .get()?.n ?? 0
}

/** The employee `userId` when it exists and has role `worker`; `null` otherwise. */
export function findEmployee(
  db: AppDatabase,
  userId: string
): { id: string; displayName: string } | null {
  if (typeof userId !== "string" || userId.length === 0) return null
  const row = db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "worker")))
    .get()
  return row ?? null
}

function likePattern(term: string): string {
  return `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return EMPLOYEE_SEARCH_DEFAULT_LIMIT
  return Math.min(EMPLOYEE_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

/**
 * Employees (role `worker`) matching `query`. The query is split on whitespace and every term must
 * appear (case-insensitive substring) in the name, the email or the company name, so "jordan acme"
 * narrows rather than widens. Rows whose name starts with the first term come first, then name order.
 * Returns at most `limit` rows (default 50, max 100) plus the full match count. SQLite cannot use an
 * index for a substring match, so this scans the worker rows once; that is milliseconds at tens of
 * thousands of rows, and the result set is always capped.
 */
export function searchEmployees(
  db: AppDatabase,
  query: string,
  limit: number = EMPLOYEE_SEARCH_DEFAULT_LIMIT,
  now: Date = new Date()
): EmployeeSearchPage {
  const cap = clampLimit(limit)
  const terms = String(query ?? "")
    .slice(0, EMPLOYEE_QUERY_MAX_LENGTH)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)

  const conditions: SQL[] = [eq(users.role, "worker")]
  for (const term of terms) {
    const pattern = likePattern(term)
    conditions.push(
      sql`(lower(${users.displayName}) LIKE ${pattern} ESCAPE '\\' OR lower(${users.email}) LIKE ${pattern} ESCAPE '\\' OR lower(${clientCompanies.name}) LIKE ${pattern} ESCAPE '\\')`
    )
  }
  const where = and(...conditions)

  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .innerJoin(clientCompanies, eq(clientCompanies.id, users.clientCompanyId))
      .where(where)
      .get()?.n ?? 0

  const first = terms[0]
  const prefixFirst = first
    ? [
        desc(
          sql`(lower(${users.displayName}) LIKE ${first.replace(/[\\%_]/g, (c) => `\\${c}`) + "%"} ESCAPE '\\')`
        ),
      ]
    : []

  const found = db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      companyName: clientCompanies.name,
    })
    .from(users)
    .innerJoin(clientCompanies, eq(clientCompanies.id, users.clientCompanyId))
    .where(where)
    .orderBy(...prefixFirst, asc(sql`lower(${users.displayName})`), asc(users.id))
    .limit(cap)
    .all()

  const statuses = personStatusByWorker(
    db,
    found.map((r) => r.id),
    now
  )
  return {
    total,
    rows: found.map((r) => ({ ...r, status: statuses.get(r.id) ?? null })),
  }
}
