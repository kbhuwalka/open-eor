import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireRole, getInvoicePdfInput, renderInvoicePdf, AuthError } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getInvoicePdfInput: vi.fn(),
  renderInvoicePdf: vi.fn(),
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
vi.mock("@/server/finance-queries", () => ({
  financeQueries: { getInvoicePdfInput },
}))
vi.mock("@/server/finance-pdf", () => ({ renderInvoicePdf }))

import { GET } from "../route"

const call = (id = "payroll:hire_1:3") => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue({ id: "u1", clientCompanyId: "client_1" })
  getInvoicePdfInput.mockResolvedValue({ invoice: { number: "INV-2026-0001" } })
})

describe("GET /client/finance/invoices/[id]/pdf", () => {
  it("is 401 without a session and 403 for another role", async () => {
    requireRole.mockRejectedValueOnce(new AuthError("unauthenticated", "x"))
    expect((await call()).status).toBe(401)
    requireRole.mockRejectedValueOnce(new AuthError("forbidden", "x"))
    expect((await call()).status).toBe(403)
    expect(getInvoicePdfInput).not.toHaveBeenCalled()
  })

  it("is 404 when the invoice is not this client's (or does not exist)", async () => {
    getInvoicePdfInput.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(getInvoicePdfInput).toHaveBeenCalledWith("client_1", "payroll:hire_1:3")
  })

  it("streams the PDF as a private attachment", async () => {
    renderInvoicePdf.mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]), filename: "INV-2026-0001.pdf" })
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="INV-2026-0001.pdf"')
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]))
  })
})
