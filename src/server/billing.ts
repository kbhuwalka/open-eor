/**
 * Billing operations (billing-and-invoicing.md §12): the billing run, the client's payment, and
 * Finance's settle / fail / void. Each runs in one transaction on top of the primitives in
 * `billing-core.ts` and authorizes the actor first (acl §4): a client may only pay invoices of its
 * own company, and everything that changes what money has moved is Finance's. `now` is injected
 * through `deps` so tests and the seed can simulate any day.
 */
import { and, eq, inArray } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import { hireRequests, onboardingCases, tasks as tasksTable } from "@/db/schema"
import { reopenTask } from "@/domain/tasks"
import { DomainError } from "@/domain/types"

import {
  depositState,
  failPaymentRow,
  loadInvoice,
  loadPaymentsForInvoices,
  runBillingInTx,
  settlePaymentRow,
  voidInvoiceRow,
  voidUnpaidDeposit,
  createPayment,
  defaultMethodIdFor,
  loadSavedMethodForCompany,
  type BillingRunResult,
} from "./billing-core"
import { actorOf, commitEngineResult, completeTaskInTx, engineContext, loadCase, loadTasks, project } from "./case-engine"
import { idFor, NotFoundError, type CaseServiceDeps, type Tx } from "./deps"

function assertRole(actor: Pick<SessionUser, "role">, role: SessionUser["role"]): void {
  if (actor.role !== role) throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
}

function companyOf(actor: Pick<SessionUser, "role" | "clientCompanyId">): string {
  assertRole(actor, "client_hr")
  if (!actor.clientCompanyId) throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
  return actor.clientCompanyId
}

export type { BillingRunResult }

/** The client company's default saved payment method id, or `null` when none is on file. */
export function defaultSavedMethodId(db: CaseServiceDeps["db"], actor: SessionUser): string | null {
  return defaultMethodIdFor(db, companyOf(actor))
}

/**
 * Generates the invoices (and the pay slip behind each payroll invoice) that are due as of
 * `deps.now()`. Idempotent: a second run for the same day creates nothing. Nothing schedules it;
 * the seed calls it with simulated days and `POST /api/billing/run` exposes it behind a secret.
 * `hireIds` narrows the run to some people.
 */
export function runBilling(deps: CaseServiceDeps, input: { hireIds?: readonly string[] } = {}): BillingRunResult {
  return deps.db.transaction((tx) => runBillingInTx(tx, deps.now(), input))
}

export type InitiatedPayment = { paymentId: string; totalCents: number; invoiceIds: string[] }

/**
 * The client starts one payment covering `invoiceIds` in full (all or nothing) with a saved method
 * of its company (default: the company's default method). Faked ACH: the payment is `initiated`
 * until Finance settles or fails it. Another company's invoice reads as not found; an invoice that
 * is void, paid or already in a payment is `INVALID_PAYMENT_SELECTION`.
 */
export function initiatePaymentForInvoices(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; invoiceIds: readonly string[]; savedMethodId?: string },
): InitiatedPayment {
  const companyId = companyOf(input.actor)
  return deps.db.transaction((tx) => {
    const methodId = input.savedMethodId ?? defaultMethodIdFor(tx, companyId)
    if (!methodId) throw new NotFoundError("Payment method")
    if (!loadSavedMethodForCompany(tx, methodId, companyId)) throw new NotFoundError("Payment method")
    const payment = createPayment(tx, {
      id: idFor(deps, "pay"),
      companyId,
      invoiceIds: [...new Set(input.invoiceIds)],
      savedMethodId: methodId,
      actorUserId: input.actor.id,
      now: deps.now(),
    })
    return { paymentId: payment.id, totalCents: payment.totalCents, invoiceIds: payment.allocations.map((a) => a.invoiceId) }
  })
}

/** A deposit's `confirm_deposit` task completes with the payment that settles it. */
function confirmDepositsFor(
  tx: Tx,
  deps: CaseServiceDeps,
  actor: SessionUser,
  invoiceIds: readonly string[],
): void {
  for (const invoiceId of invoiceIds) {
    const invoice = loadInvoice(tx, invoiceId)
    if (!invoice || invoice.kind !== "deposit") continue
    const task = tx
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
      .where(
        and(
          eq(onboardingCases.hireRequestId, invoice.hireId),
          eq(tasksTable.key, "confirm_deposit"),
          eq(tasksTable.status, "ready"),
        ),
      )
      .get()
    if (task) completeTaskInTx(tx, deps, { taskId: task.id, actor: actorOf(actor), payload: { resolution: "settled" } })
  }
}

/** Finance: the payment cleared. Its invoices read as paid; a ready `confirm_deposit` completes. */
export function settlePayment(deps: CaseServiceDeps, input: { actor: SessionUser; paymentId: string }): { paymentId: string } {
  assertRole(input.actor, "finance")
  return deps.db.transaction((tx) => {
    const payment = settlePaymentRow(tx, input.paymentId, input.actor.id, deps.now())
    confirmDepositsFor(tx, deps, input.actor, payment.allocations.map((a) => a.invoiceId))
    return { paymentId: payment.id }
  })
}

/**
 * A failed payment of a deposit invoice puts the order back where it was before the client paid:
 * the invoice derives to Due again (nothing is stored for that) and the client's `pay_deposit` is
 * reopened as a new instance with a note, which blocks `confirm_deposit` again. Only while the
 * order is open and has not gone live; the engine also leaves a task alone once a task that
 * depends on it is done. An order that was cancelled meanwhile has no one left to pay, so its
 * unpaid deposit is voided like any other cancelled order's.
 */
function reopenDepositsFor(
  tx: Tx,
  deps: CaseServiceDeps,
  actor: SessionUser,
  invoiceIds: readonly string[],
  reason: string,
): void {
  for (const invoiceId of invoiceIds) {
    const invoice = loadInvoice(tx, invoiceId)
    if (!invoice || invoice.kind !== "deposit") continue
    const caseId = tx
      .select({ id: onboardingCases.id })
      .from(onboardingCases)
      .where(eq(onboardingCases.hireRequestId, invoice.hireId))
      .get()?.id
    if (!caseId) continue
    const record = loadCase(tx, caseId)
    if (record.lifecycle === "cancelled") {
      voidUnpaidDeposit(tx, invoice.hireId)
      continue
    }
    if (record.lifecycle !== "open") continue
    const tasks = loadTasks(tx, caseId)
    if (project(record, tasks, deps.now()).goLiveReached) continue
    const note = `The deposit payment failed (${reason.replace(/[.\s]+$/, "")}). Please pay it again.`
    const result = reopenTask(tasks, { key: "pay_deposit", actor: actorOf(actor), note }, engineContext(tx, deps, record))
    if (result.changed.length > 0) commitEngineResult(tx, deps, record, result, actorOf(actor))
  }
}

function failPaymentInTx(tx: Tx, deps: CaseServiceDeps, actor: SessionUser, paymentId: string, reason: string) {
  const payment = failPaymentRow(tx, paymentId, reason, actor.id, deps.now())
  reopenDepositsFor(tx, deps, actor, payment.allocations.map((a) => a.invoiceId), reason)
  return payment
}

/** Finance: the payment did not clear. Its invoices are payable again, and a deposit's payment step reopens. */
export function failPayment(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; paymentId: string; reason: string },
): { paymentId: string } {
  assertRole(input.actor, "finance")
  const reason = input.reason.trim()
  if (!reason) throw new DomainError("INVALID_TASK_PAYLOAD", { field: "reason", message: "Say why the payment failed." })
  return deps.db.transaction((tx) => ({ paymentId: failPaymentInTx(tx, deps, input.actor, input.paymentId, reason).id }))
}

export const DEPOSIT_NOT_RECEIVED = "Deposit not received"

/**
 * Finance: the client's deposit payment is in flight and the money did not arrive. Fails that
 * payment through the same path as "Mark failed" (so the invoice is Due or Overdue again and the
 * client can pay again); there is no state of its own. Refused when the order has no initiated
 * deposit payment (nothing to fail). `reason`, when given, follows "Deposit not received".
 */
export function markDepositNotReceived(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; caseId: string; reason?: string },
): { caseId: string; paymentId: string } {
  assertRole(input.actor, "finance")
  const detail = input.reason?.trim()
  const reason = detail ? `${DEPOSIT_NOT_RECEIVED}: ${detail}` : DEPOSIT_NOT_RECEIVED
  return deps.db.transaction((tx) => {
    const record = loadCase(tx, input.caseId)
    const { state, invoice } = depositState(tx, record.hireId)
    const payment =
      state === "processing" && invoice ? loadPaymentsForInvoices(tx, [invoice.id]).find((p) => p.status === "initiated") : undefined
    if (!payment) throw new DomainError("ILLEGAL_TRANSITION", { entity: "deposit", caseId: input.caseId, to: "not_received" })
    failPaymentInTx(tx, deps, input.actor, payment.id, reason)
    return { caseId: input.caseId, paymentId: payment.id }
  })
}

/** Finance: cancels an invoice nothing has paid or started to pay (and its pay slip). */
export function voidInvoice(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; invoiceId: string; reason: string },
): { invoiceId: string } {
  assertRole(input.actor, "finance")
  const reason = input.reason.trim()
  if (!reason) throw new DomainError("INVALID_TASK_PAYLOAD", { field: "reason", message: "Say why the invoice is void." })
  return deps.db.transaction((tx) => {
    voidInvoiceRow(tx, input.invoiceId, reason)
    return { invoiceId: input.invoiceId }
  })
}

function resolveDepositTask(
  deps: CaseServiceDeps,
  input: { actor: SessionUser; caseId: string; resolution: "received" },
): { caseId: string } {
  assertRole(input.actor, "finance")
  return deps.db.transaction((tx) => {
    const exists = tx
      .select({ id: hireRequests.id })
      .from(onboardingCases)
      .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
      .where(eq(onboardingCases.id, input.caseId))
      .get()
    if (!exists) throw new NotFoundError("Case")
    const tasks = tx
      .select({ id: tasksTable.id, key: tasksTable.key })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.caseId, input.caseId),
          inArray(tasksTable.key, ["confirm_deposit", "pay_deposit"]),
          eq(tasksTable.status, "ready"),
        ),
      )
      .all()
    const task = tasks.find((t) => t.key === "confirm_deposit") ?? tasks[0]
    if (!task) throw new DomainError("ILLEGAL_TRANSITION", { entity: "deposit", caseId: input.caseId, to: input.resolution })
    const payload = { resolution: input.resolution }
    completeTaskInTx(tx, deps, { taskId: task.id, actor: actorOf(input.actor), payload })
    if (task.key === "pay_deposit") {
      // Completing the payment step unblocks Confirm deposit only after the money is recorded, so settle it in the same click.
      const next = tx
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(and(eq(tasksTable.caseId, input.caseId), eq(tasksTable.key, "confirm_deposit"), eq(tasksTable.status, "ready")))
        .get()
      if (next) completeTaskInTx(tx, deps, { taskId: next.id, actor: actorOf(input.actor), payload })
    }
    return { caseId: input.caseId }
  })
}

/** Finance: records the deposit as received outside the product (a settled payment without a saved method). */
export function markDepositReceived(deps: CaseServiceDeps, input: { actor: SessionUser; caseId: string }): { caseId: string } {
  return resolveDepositTask(deps, { ...input, resolution: "received" })
}
