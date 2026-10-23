/**
 * Session boundary used by pages and later server actions.
 * Portal layouts call `requirePortalUser` for redirect guards.
 */
import { redirect } from "next/navigation"

import type { AppDatabase, UserRole } from "@/db"

import { AuthError, portalAccess, requireRole as assertRoles } from "./acl"
import { getSessionUser, type SessionUser } from "./session"

export async function requireUser(deps?: {
  db?: AppDatabase
  password?: string
}): Promise<SessionUser> {
  const user = await getSessionUser(deps)
  if (!user) {
    throw new AuthError("unauthenticated", "Sign in via persona picker")
  }
  return user
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await getSessionUser()
  return assertRoles(user, ...roles)
}

/** No session → `/pick`. Wrong role → that role's home. */
export async function requirePortalUser(role: UserRole): Promise<SessionUser> {
  const user = await getSessionUser()
  const decision = portalAccess(user, role)
  if (!decision.ok) redirect(decision.redirectTo)
  return decision.user
}

export { AuthError }
