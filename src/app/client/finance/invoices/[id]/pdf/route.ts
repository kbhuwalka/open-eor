import { AuthError, requireRole } from "@/auth"
import { renderInvoicePdf } from "@/server/finance-pdf"
import { financeQueries } from "@/server/finance-queries"

const NO_STORE = { "Cache-Control": "private, no-store" }

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: NO_STORE })
}

/** Invoice PDF for one of the signed-in client's own invoices. Ownership lives in `FinanceDataSource`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let clientId: string
  try {
    const user = await requireRole("client_hr")
    if (!user.clientCompanyId) return problem(403, "forbidden", "Invoices are only available to client users.")
    clientId = user.clientCompanyId
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "unauthenticated"
        ? problem(401, "unauthenticated", "Sign in to download invoices.")
        : problem(403, "forbidden", "Invoices are only available to client users.")
    }
    throw error
  }

  const { id } = await params
  const input = await financeQueries.getInvoicePdfInput(clientId, id)
  if (!input) return problem(404, "not_found", "Invoice not found.")

  const pdf = await renderInvoicePdf(input)
  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
    },
  })
}
