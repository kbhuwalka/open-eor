/**
 * Read models behind the persona picker (`/pick`, ui-guidelines §5 C14).
 * Nothing is hardcoded: tiles and the employee search come from `users`.
 * Plain serialisable objects; no business rules beyond the person-status mapping.
 */
import { and, asc, desc, eq, ne, sql, type SQL } from "drizzle-orm"

import {
  clientCompanies,
  users,
  type AppDatabase,
  type UserRole,
} from "@/db"
import type { PersonStatus } from "@/domain/person-status"

import { personStatusByWorker } from "./queries"

/** Roles that get their own tile on the picker, in tile order. */
const NON_EMPLOYEE_ORDER: readonly Exclude<UserRole, "worker">[] = [
  "client_hr",
  "onboarding_specialist",
  "finance",
]

export const EMPLOYEE_SEARCH_DEFAULT_LIMIT = 50
export const EMPLOYEE_SEARCH_MAX_LIMIT = 100
export const EMPLOYEE_QUERY_MAX_LENGTH = 100

export type NonEmployeePersona = {
  id: string
  displayName: string
  email: string
  role: Exclude<UserRole, "worker">
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

/** One tile per user whose role is not `worker`: Client HR, Onboarding Specialists, then Finance. */
export function listNonEmployeePersonas(db: AppDatabase): NonEmployeePersona[] {
  const rows = db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(ne(users.role, "worker"))
    .orderBy(asc(users.displayName), asc(users.id))
    .all()
  return rows
    .filter((r): r is NonEmployeePersona => r.role !== "worker")
    .sort((a, b) => NON_EMPLOYEE_ORDER.indexOf(a.role) - NON_EMPLOYEE_ORDER.indexOf(b.role))
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
