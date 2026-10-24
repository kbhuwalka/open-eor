import { decodeIdParam } from "@/lib/finance-portal-view"
import { financePaymentHref } from "@/lib/invoice-links"

/** The old payment page: the payment now opens in the drawer of the Payments list, which checks the role. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return new Response(null, { status: 307, headers: { Location: financePaymentHref(decodeIdParam(id)) } })
}
