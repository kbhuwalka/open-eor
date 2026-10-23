/**
 * Role ACL helpers for the EOR demo.
 *
 * Document bytes: never served to `client_hr`. `eor_reviewer` and `eor_ops`
 * may read; download routes land in later Issues — this module only exposes
 * the predicate.
 */
import type { UserRole } from "@/db"

import type { SessionUser } from "./session"

export class AuthError extends Error {
  readonly code: "unauthenticated" | "forbidden"

  constructor(code: "unauthenticated" | "forbidden", message: string) {
    super(message)
    this.name = "AuthError"
    this.code = code
  }
}

/** True when role may read work-auth / document bytes. */
export function canAccessDocumentBytes(role: UserRole): boolean {
  return role === "eor_reviewer" || role === "eor_ops"
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

export function isRoleAllowed(
  user: SessionUser | null,
  ...roles: UserRole[]
): boolean {
  return Boolean(user && roles.includes(user.role))
}
