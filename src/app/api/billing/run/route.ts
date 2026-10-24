import { timingSafeEqual } from "node:crypto"

import { getDb } from "@/db"
import { runBilling } from "@/server/billing"

const NO_STORE = { "Cache-Control": "private, no-store" }

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Runs the billing run for today (docs/billing-and-invoicing.md §12). Nothing schedules it: an
 * external scheduler (or Finance later) calls this with `Authorization: Bearer $BILLING_RUN_SECRET`.
 * The route does not exist unless that variable is set. Idempotent, so retrying is safe.
 */
export async function POST(request: Request) {
  const secret = process.env.BILLING_RUN_SECRET
  if (!secret || secret.length < 16) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE })
  }
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!sameSecret(bearer, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE })
  }
  const result = runBilling({ db: getDb(), now: () => new Date() })
  return Response.json(
    { today: result.today, invoices: result.invoices.length, payrollEntries: result.payrollEntries },
    { headers: NO_STORE },
  )
}
