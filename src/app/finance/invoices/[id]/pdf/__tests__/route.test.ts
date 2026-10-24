import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireRole, financeInvoicePdfInput, generateInvoicePdf, AuthError } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  financeInvoicePdfInput: vi.fn(),
  generateInvoicePdf: vi.fn(),
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
vi.mock("@/server/finance-portal-queries", () => ({ financeInvoicePdfInput }))
vi.mock("@/server/documents", () => ({ generateInvoicePdf }))

import { GET } from "../route"

const call = (id = "payroll%3Ahire_1%3A3") => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue({ id: "u1", role: "finance" })
  financeInvoicePdfInput.mockReturnValue({ invoice: { number: "INV-2026-0001" } })
})

describe("GET /finance/invoices/[id]/pdf", () => {
  it("requires the finance role: 401 without a session, 403 for another role", async () => {
    requireRole.mockRejectedValueOnce(new AuthError("unauthenticated", "x"))
    expect((await call()).status).toBe(401)
    requireRole.mockRejectedValueOnce(new AuthError("forbidden", "x"))
    expect((await call()).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith("finance")
    expect(financeInvoicePdfInput).not.toHaveBeenCalled()
  })

  it("is 404 for an unknown invoice, looking it up by the decoded id", async () => {
    financeInvoicePdfInput.mockReturnValue(null)
    expect((await call()).status).toBe(404)
    expect(financeInvoicePdfInput).toHaveBeenCalledWith("db", { id: "u1", role: "finance" }, "payroll:hire_1:3")
    expect(generateInvoicePdf).not.toHaveBeenCalled()
  })

  it("streams the PDF as a private attachment named after the invoice number", async () => {
    generateInvoicePdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="INV-2026-0001.pdf"')
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]))
  })
})
