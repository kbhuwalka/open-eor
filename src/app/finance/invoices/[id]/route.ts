import { decodeIdParam } from "@/lib/finance-portal-view"
import { financeInvoiceHref } from "@/lib/invoice-links"

/** The old invoice page: the invoice now opens in the drawer of the Invoices list, which checks the role. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return new Response(null, { status: 307, headers: { Location: financeInvoiceHref(decodeIdParam(id)) } })
}
