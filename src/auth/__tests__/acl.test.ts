import { describe, expect, it } from "vitest"

import { AuthError, portalAccess, requireRole } from "../acl"
import { ROLE_HOME, type SessionUser } from "../session"
import type { UserRole } from "@/db"

function persona(
  id: string,
  role: UserRole,
  tenant: { clientCompanyId: string | null; providerId: string | null }
): SessionUser {
  return {
    id,
    email: `${id}@example`,
    displayName: id,
    role,
    clientCompanyId: tenant.clientCompanyId,
    providerId: tenant.providerId,
  }
}

const client = persona("user_client_hr", "client_hr", {
  clientCompanyId: "client_1",
  providerId: null,
})
const worker = persona("user_worker", "worker", {
  clientCompanyId: "client_1",
  providerId: null,
})
const ops = persona("user_eor_ops", "eor_ops", {
  clientCompanyId: null,
  providerId: "provider_1",
})
const reviewer = persona("user_eor_reviewer", "eor_reviewer", {
  clientCompanyId: null,
  providerId: "provider_1",
})

const people = [client, worker, ops, reviewer]

describe("requireRole", () => {
  it("lets each role pass for itself and rejects the other three", () => {
    for (const user of people) {
      expect(requireRole(user, user.role)).toEqual(user)
      for (const other of people) {
        if (other.role === user.role) continue
        expect(() => requireRole(user, other.role)).toThrow(AuthError)
        try {
          requireRole(user, other.role)
        } catch (error) {
          expect(error).toBeInstanceOf(AuthError)
          expect((error as AuthError).code).toBe("forbidden")
        }
      }
    }
  })

  it("rejects a missing session as unauthenticated", () => {
    expect(() => requireRole(null, "client_hr")).toThrow(AuthError)
    try {
      requireRole(null, "worker")
    } catch (error) {
      expect((error as AuthError).code).toBe("unauthenticated")
    }
  })
})

describe("portalAccess", () => {
  it("sends a missing session to /pick", () => {
    expect(portalAccess(null, "client_hr")).toEqual({
      ok: false,
      redirectTo: "/pick",
    })
  })

  it("sends a wrong role to that role's home and admits the matching role", () => {
    for (const user of people) {
      expect(portalAccess(user, user.role)).toEqual({ ok: true, user })
      for (const other of people) {
        if (other.role === user.role) continue
        expect(portalAccess(user, other.role)).toEqual({
          ok: false,
          redirectTo: ROLE_HOME[user.role],
        })
      }
    }
  })
})
