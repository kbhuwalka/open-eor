import { AuthError, requireRole } from "@/auth"
import payData from "@/server/pay-queries"
import { renderPayslipPdf } from "@/server/pay-pdf"

const NO_STORE = { "Cache-Control": "private, no-store" }

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: NO_STORE })
}

/** Pay slip PDF for the signed-in employee's own slip. Ownership and visibility live in `PayDataSource`. */
export async function GET(_request: Request, { params }: { params: Promise<{ payslipId: string }> }) {
  let userId: string
  try {
    userId = (await requireRole("worker")).id
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "unauthenticated"
        ? problem(401, "unauthenticated", "Sign in to download pay slips.")
        : problem(403, "forbidden", "Pay slips are only available to employees.")
    }
    throw error
  }

  const { payslipId } = await params
  const detail = await payData.getPayslipDetail(userId, payslipId)
  if (!detail) return problem(404, "not_found", "Pay slip not found.")

  const pdf = await renderPayslipPdf(detail)

  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
    },
  })
}
