import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireRole, payInvoices, getInvoiceDetail, revalidatePath } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  payInvoices: vi.fn(),
  getInvoiceDetail: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/auth", () => ({
  requireRole,
  AuthError: class AuthError extends Error {
    constructor(
      public code: "unauthenticated" | "forbidden",
      message: string,
    ) {
      super(message)
    }
  },
}))
vi.mock("@/server/cases", () => ({ NotFoundError: class NotFoundError extends Error {} }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/server/finance-queries", () => ({ financeQueries: { payInvoices, getInvoiceDetail } }))

import { getInvoiceDetailAction, payInvoicesAction } from "../actions"

const harper = { id: "user_1", displayName: "Harper", role: "client_hr", clientCompanyId: "client_1" }

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue(harper)
  payInvoices.mockResolvedValue({ ok: false, error: "NOT_AVAILABLE" })
})

describe("payInvoicesAction", () => {
  it("requires the client_hr role before anything else", async () => {
    await payInvoicesAction(["a"])
    expect(requireRole).toHaveBeenCalledWith("client_hr")
  })

  it("passes the session's client id and actor, never anything from the request", async () => {
    payInvoices.mockResolvedValue({ ok: true, paymentId: "pay_1", invoiceIds: ["a", "b"], totalCents: 300, initiatedAt: "x" })
    const result = await payInvoicesAction(["a", "b", "a"])
    expect(payInvoices).toHaveBeenCalledWith("client_1", ["a", "b"], { userId: "user_1", displayName: "Harper" })
    expect(result).toEqual({ ok: true, data: { paymentId: "pay_1", invoiceIds: ["a", "b"], totalCents: 300 } })
    expect(revalidatePath).toHaveBeenCalledWith("/client/finance")
  })

  it("rejects an empty or malformed selection without touching the seam", async () => {
    for (const bad of [[], "a", null, [1], [""]]) {
      const result = await payInvoicesAction(bad)
      expect(result).toMatchObject({ ok: false, code: "validation" })
    }
    expect(payInvoices).not.toHaveBeenCalled()
  })

  it("turns NOT_AVAILABLE into a user-safe message and keeps the machine code", async () => {
    payInvoices.mockResolvedValue({ ok: false, error: "NOT_AVAILABLE" })
    const result = await payInvoicesAction(["a"])
    expect(result).toMatchObject({
      ok: false,
      code: "validation",
      message: expect.stringContaining("not available"),
      details: { error: "NOT_AVAILABLE" },
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("refuses a session without a client company", async () => {
    requireRole.mockResolvedValue({ ...harper, clientCompanyId: null })
    expect(await payInvoicesAction(["a"])).toMatchObject({ ok: false, code: "forbidden" })
    expect(payInvoices).not.toHaveBeenCalled()
  })
})

describe("getInvoiceDetailAction", () => {
  it("reads through the seam with the session's client id", async () => {
    getInvoiceDetail.mockResolvedValue({ id: "a" })
    expect(await getInvoiceDetailAction("a")).toEqual({ id: "a" })
    expect(getInvoiceDetail).toHaveBeenCalledWith("client_1", "a")
  })

  it("returns null for a bad id without reading", async () => {
    expect(await getInvoiceDetailAction("")).toBeNull()
    expect(await getInvoiceDetailAction(42)).toBeNull()
    expect(getInvoiceDetail).not.toHaveBeenCalled()
  })
})
