import { beforeEach, describe, expect, it, vi } from "vitest"

class FakeAuthError extends Error {
  constructor(readonly code: "unauthenticated" | "forbidden") {
    super(code)
  }
}

const requireRole = vi.fn()
const readEmployeeDocument = vi.fn()

vi.mock("@/auth", () => ({ AuthError: FakeAuthError, requireRole }))
vi.mock("@/db", () => ({ getDb: () => ({}) }))
vi.mock("@/server/employee-documents", () => ({ readEmployeeDocument }))

const PDF = new Uint8Array([37, 80, 68, 70, 45])
const user = { id: "user_worker", role: "worker" }

const view = async (id = "doc_1") => {
  const { GET } = await import("../route")
  return GET(new Request("http://localhost/worker/documents/x/view"), { params: Promise.resolve({ id }) })
}
const download = async (id = "doc_1") => {
  const { GET } = await import("../../download/route")
  return GET(new Request("http://localhost/worker/documents/x/download"), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue(user)
  readEmployeeDocument.mockReset().mockResolvedValue({ ok: true, bytes: PDF, fileName: "employment-agreement.pdf", sha256: "abc123" })
})

describe("GET /worker/documents/[id]/view", () => {
  it("serves the verified PDF inline, never cached", async () => {
    const response = await view()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toBe('inline; filename="employment-agreement.pdf"')
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("x-document-sha256")).toBe("abc123")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF)
    expect(readEmployeeDocument).toHaveBeenCalledWith(expect.anything(), user, "doc_1")
  })

  it("serves an image with its own content type", async () => {
    readEmployeeDocument.mockResolvedValueOnce({ ok: true, bytes: PDF, fileName: "passport.PNG", sha256: "def" })
    const response = await view()
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("content-disposition")).toBe('inline; filename="passport.PNG"')
  })

  it("is 401 without a session and 403 for another role, before reading anything", async () => {
    requireRole.mockRejectedValueOnce(new FakeAuthError("unauthenticated"))
    expect((await view()).status).toBe(401)
    requireRole.mockRejectedValueOnce(new FakeAuthError("forbidden"))
    expect((await view()).status).toBe(403)
    expect(readEmployeeDocument).not.toHaveBeenCalled()
  })

  it("is 404 for a document that is not the signed-in employee's and 403 for a role the service refuses", async () => {
    readEmployeeDocument.mockResolvedValueOnce({ ok: false, reason: "not_found", message: "Document not found." })
    const missing = await view("someone-elses")
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: "not_found" })
    readEmployeeDocument.mockResolvedValueOnce({ ok: false, reason: "forbidden", message: "no" })
    expect((await view()).status).toBe(403)
  })

  it("is 409 with no file when the stored copy fails its integrity check", async () => {
    readEmployeeDocument.mockResolvedValueOnce({ ok: false, reason: "tampered", message: "This document failed its integrity check." })
    const response = await view()
    expect(response.status).toBe(409)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(response.headers.get("content-disposition")).toBeNull()
    expect(await response.json()).toMatchObject({ error: "tampered" })
  })
})

describe("GET /worker/documents/[id]/download", () => {
  it("keeps serving the same file as an attachment", async () => {
    const response = await download()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="employment-agreement.pdf"')
  })

  it("answers 401, 404 and 409 the same way as the view route", async () => {
    requireRole.mockRejectedValueOnce(new FakeAuthError("unauthenticated"))
    expect((await download()).status).toBe(401)
    readEmployeeDocument.mockResolvedValueOnce({ ok: false, reason: "not_found", message: "x" })
    expect((await download()).status).toBe(404)
    readEmployeeDocument.mockResolvedValueOnce({ ok: false, reason: "tampered", message: "x" })
    expect((await download()).status).toBe(409)
  })
})
