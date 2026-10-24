/**
 * Read model for the Finance payments list's covered invoices (the "N invoices" dialog): for each
 * payment, its invoices with the person, title, period and the amount the payment allocates to each.
 * Finance only (acl §4); everyone else is refused like every other billing read.
 */
import { asc, eq, inArray } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { hireRequests, invoices, onboardingCases, paymentAllocations, roles, users } from "@/db/schema"
import { DomainError } from "@/domain/types"
import type { CoveredInvoice } from "@/lib/covered-invoices"

type Reader = Pick<AppDatabase, "select">

/** Payment id to the invoices it covers, in invoice-id order. */
export function coveredInvoicesByPayment(
  db: Reader,
  actor: Pick<SessionUser, "role">,
  paymentIds: readonly string[],
): Record<string, CoveredInvoice[]> {
  if (actor.role !== "finance") throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
  if (paymentIds.length === 0) return {}
  const allocations = db
    .select({ paymentId: paymentAllocations.paymentId, invoiceId: paymentAllocations.invoiceId, amountCents: paymentAllocations.amountCents })
    .from(paymentAllocations)
    .where(inArray(paymentAllocations.paymentId, [...paymentIds]))
    .orderBy(asc(paymentAllocations.paymentId), asc(paymentAllocations.invoiceId))
    .all()
  const details = new Map(
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        kind: invoices.kind,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
        daysEmployed: invoices.daysEmployed,
        periodDays: invoices.periodDays,
        personName: users.displayName,
        personTitle: roles.name,
      })
      .from(invoices)
      .innerJoin(onboardingCases, eq(onboardingCases.hireRequestId, invoices.hireId))
      .innerJoin(users, eq(users.id, onboardingCases.workerUserId))
      .innerJoin(hireRequests, eq(hireRequests.id, invoices.hireId))
      .leftJoin(roles, eq(roles.id, hireRequests.roleId))
      .where(inArray(invoices.id, [...new Set(allocations.map((allocation) => allocation.invoiceId))]))
      .all()
      .map((row) => [row.id, row] as const),
  )
  const byPayment: Record<string, CoveredInvoice[]> = {}
  for (const { paymentId, invoiceId, amountCents } of allocations) {
    const detail = details.get(invoiceId)
    if (!detail) continue
    byPayment[paymentId] = [...(byPayment[paymentId] ?? []), { ...detail, amountCents }]
  }
  return byPayment
}
