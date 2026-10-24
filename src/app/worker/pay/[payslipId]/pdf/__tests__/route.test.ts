import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildPayFixtures, SAMPLE_USER_ID } from "@/app/dev/pay/fixtures"

class FakeAuthError extends Error {
  constructor(readonly code: "unauthenticated" | "forbidden") {
    super(code)
  }
}

const requireRole = vi.fn()
const renderPayslipPdf = vi.fn()
const getPayslipDetail = vi.fn()

vi.mock("@/auth", () => ({ AuthError: FakeAuthError, requireRole }))
vi.mock("@/server/pay-queries", () => ({ default: { getPayslipDetail } }))
vi.mock("@/server/pay-pdf", () => ({ renderPayslipPdf }))

const detail = buildPayFixtures().slips[0]
const call = async (id = detail.id) => {
  const { GET } = await import("../route")
  return GET(new Request("http://localhost/worker/pay/x/pdf"), { params: Promise.resolve({ payslipId: id }) })
}

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: SAMPLE_USER_ID })
  getPayslipDetail.mockReset().mockResolvedValue(detail)
  renderPayslipPdf.mockReset()
})

describe("GET /worker/pay/[payslipId]/pdf", () => {
  it("is 401 without a session and 403 for another role, before reading any slip", async () => {
    requireRole.mockRejectedValueOnce(new FakeAuthError("unauthenticated"))
    expect((await call()).status).toBe(401)
    requireRole.mockRejectedValueOnce(new FakeAuthError("forbidden"))
    expect((await call()).status).toBe(403)
    expect(getPayslipDetail).not.toHaveBeenCalled()
  })

  it("is 404 for a slip the data source does not return (not yours, not visible yet, unknown)", async () => {
    getPayslipDetail.mockResolvedValueOnce(null)
    const response = await call("other")
    expect(response.status).toBe(404)
    expect(getPayslipDetail).toHaveBeenCalledWith(SAMPLE_USER_ID, "other")
  })

  it("streams the PDF as an attachment, never cached", async () => {
    renderPayslipPdf.mockResolvedValueOnce({ bytes: new Uint8Array([37, 80, 68, 70]), filename: "payslip-2026-01-02.pdf" })
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="payslip-2026-01-02.pdf"')
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]))
  })
})
