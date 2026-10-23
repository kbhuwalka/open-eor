import { describe, expect, it } from "vitest"

import {
  AuthError,
  canAccessDocumentBytes,
  isRoleAllowed,
  requireRole,
} from "../acl"
import type { SessionUser } from "../session"

const clientHr: SessionUser = {
  id: "user_client_hr",
  email: "hr@acme.example",
  displayName: "Alex Harper",
  role: "client_hr",
}

const reviewer: SessionUser = {
  id: "user_eor_reviewer",
  email: "review@northwind.example",
  displayName: "Riley Chen",
  role: "eor_reviewer",
}

const ops: SessionUser = {
  id: "user_eor_ops",
  email: "ops@northwind.example",
  displayName: "Sam Ortiz",
  role: "eor_ops",
}

describe("requireRole", () => {
  it("passes when role is allowed", () => {
    expect(requireRole(clientHr, "client_hr")).toEqual(clientHr)
    expect(isRoleAllowed(reviewer, "eor_reviewer")).toBe(true)
  })

  it("fails unauthenticated when session is missing", () => {
    expect(() => requireRole(null, "client_hr")).toThrow(AuthError)
    try {
      requireRole(null, "client_hr")
    } catch (error) {
      expect((error as AuthError).code).toBe("unauthenticated")
    }
  })

  it("fails forbidden when role is wrong", () => {
    expect(() => requireRole(ops, "eor_reviewer")).toThrow(AuthError)
    try {
      requireRole(ops, "eor_reviewer")
    } catch (error) {
      expect((error as AuthError).code).toBe("forbidden")
    }
    expect(isRoleAllowed(ops, "eor_reviewer")).toBe(false)
  })
})

describe("document ACL", () => {
  it("allows reviewer and ops; denies client_hr and worker", () => {
    expect(canAccessDocumentBytes("eor_reviewer")).toBe(true)
    expect(canAccessDocumentBytes("eor_ops")).toBe(true)
    expect(canAccessDocumentBytes("client_hr")).toBe(false)
    expect(canAccessDocumentBytes("worker")).toBe(false)
  })
})
