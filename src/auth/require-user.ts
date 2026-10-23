/**
 * Session boundary: requireUser / requireRole against the signed cookie.
 * Portal layouts use requirePortalUser for redirect-based guards.
 */
import { redirect } from "next/navigation"

import type { AppDatabase, UserRole } from "@/db"
import { isRoleAllowed, requireRole as assertRoles, AuthError } from "./acl"
import {
  getSessionUser,
  ROLE_HOME,
  type SessionUser,
} from "./session"

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

export async function requireRole(
  ...roles: UserRole[]
): Promise<SessionUser> {
  const user = await getSessionUser()
  return assertRoles(user, ...roles)
}

/** Layout/page guard: missing session → /pick; wrong role → that role's home. */
export async function requirePortalUser(
  ...allowedRoles: UserRole[]
): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) {
    redirect("/pick")
  }
  if (!isRoleAllowed(user, ...allowedRoles)) {
    redirect(ROLE_HOME[user.role])
  }
  return user
}

export { AuthError }
