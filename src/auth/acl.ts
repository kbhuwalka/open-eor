/**
 * Role gate for the persona session.
 *
 * Document-byte predicates are owned by the integration issue (acl §4).
 * This module only decides whether a resolved user may enter a role.
 */
import type { UserRole } from "@/db"

import { ROLE_HOME, type SessionUser } from "./session"

export class AuthError extends Error {
  readonly code: "unauthenticated" | "forbidden"

  constructor(code: "unauthenticated" | "forbidden", message: string) {
    super(message)
    this.name = "AuthError"
    this.code = code
  }
}

export function requireRole(
  user: SessionUser | null,
  ...roles: UserRole[]
): SessionUser {
  if (!user) {
    throw new AuthError("unauthenticated", "Sign in via persona picker")
  }
  if (!roles.includes(user.role)) {
    throw new AuthError(
      "forbidden",
      `Role ${user.role} cannot access this resource`
    )
  }
  return user
}

/**
 * Portal guard decision (acl F2). Null redirect means the user may render.
 * Missing session goes to `/pick`; a wrong role goes to that role's home.
 */
export function portalAccess(
  user: SessionUser | null,
  role: UserRole
): { ok: true; user: SessionUser } | { ok: false; redirectTo: string } {
  if (!user) return { ok: false, redirectTo: "/pick" }
  if (user.role !== role) return { ok: false, redirectTo: ROLE_HOME[user.role] }
  return { ok: true, user }
}
