import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireRole, readCompanyDocument, AuthError } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  readCompanyDocument: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      public code: "unauthenticated" | "forbidden",
      message: string,
    ) {
      super(message)
    }
  },
}))

vi.mock("@/auth", () => ({ requireRole, AuthError }))
vi.mock("@/db", () => ({ getDb: () => "db" }))
vi.mock("@/server/master-agreement", () => ({ readCompanyDocument }))

import { GET } from "../route"

const call = (id = "cdoc_1") => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) })
const user = { id: "u1", role: "client_hr", clientCompanyId: "client_1" }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(user)
  readCompanyDocument.mockResolvedValue({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]), fileName: "msa.pdf", sha256: "abc" })
})

describe("GET /api/company-documents/[id]", () => {
  it("only asks for client and onboarding specialist sessions, and is 401/403 otherwise before reading anything", async () => {
    await call()
    expect(requireRole).toHaveBeenCalledWith("client_hr", "onboarding_specialist")

    requireRole.mockRejectedValueOnce(new AuthError("unauthenticated", "x"))
    expect((await call()).status).toBe(401)
    requireRole.mockRejectedValueOnce(new AuthError("forbidden", "x"))
    expect((await call()).status).toBe(403)
    expect(readCompanyDocument).toHaveBeenCalledTimes(1)
  })

  it("serves the verified PDF as a private attachment", async () => {
    const response = await call()
    expect(readCompanyDocument).toHaveBeenCalledWith("db", user, "cdoc_1")
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="msa.pdf"')
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]))
  })

  it("maps the read outcomes: forbidden 403, not found 404, failed integrity check 409 with no bytes", async () => {
    for (const [reason, status] of [["forbidden", 403], ["not_found", 404], ["tampered", 409]] as const) {
      readCompanyDocument.mockResolvedValueOnce({ ok: false, reason, message: "nope" })
      const response = await call()
      expect(response.status).toBe(status)
      expect(response.headers.get("Content-Type")).toContain("application/json")
      expect(await response.json()).toEqual({ error: reason, message: "nope" })
    }
  })

  it("rethrows unexpected errors", async () => {
    requireRole.mockRejectedValueOnce(new Error("boom"))
    await expect(call()).rejects.toThrow("boom")
  })
})
