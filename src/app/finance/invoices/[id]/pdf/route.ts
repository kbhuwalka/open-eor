import { AuthError, requireRole } from "@/auth"
import { getDb } from "@/db"
import { decodeIdParam } from "@/lib/finance-portal-view"
import { generateInvoicePdf } from "@/server/documents"
import { financeInvoicePdfInput } from "@/server/finance-portal-queries"

const NO_STORE = { "Cache-Control": "private, no-store" }

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: NO_STORE })
}

/** Invoice PDF for any company's invoice. Finance only; the client portal has its own route. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let user
  try {
    user = await requireRole("finance")
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "unauthenticated"
        ? problem(401, "unauthenticated", "Sign in to download invoices.")
        : problem(403, "forbidden", "Invoices are only available to Finance.")
    }
    throw error
  }

  const { id } = await params
  const input = financeInvoicePdfInput(getDb(), user, decodeIdParam(id))
  if (!input) return problem(404, "not_found", "Invoice not found.")

  const bytes = await generateInvoicePdf(input)
  return new Response(Buffer.from(bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${input.invoice.number}.pdf"`,
    },
  })
}
