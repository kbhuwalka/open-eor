/**
 * The "Review the order" task screen's data (onboarding-portal.md §2): the order as the client placed
 * it, the quote, the deposit (read-only; Finance owns it) and the checks the specialist reads before
 * approving. Nothing here completes anything: approval goes through the shared task action.
 */
import type { AppDatabase } from "@/db/client"
import { US_2026 } from "@/domain/cost-rates"
import type { BenefitPackage, WageUnit } from "@/domain/types"
import { orderChecks, type OrderCheck } from "@/lib/onboarding-portal/order-checks"

import { depositState } from "../billing-core"
import { agreementFor } from "../queries"

import { loadStaffTask, type StaffViewer } from "./core"

export type DepositView = {
  /** Plain words for the state: "Not yet paid", "Processing", "Paid and held". */
  label: string
  state: "none" | "open" | "processing" | "paid" | "cancelled"
  amountCents: number | null
}

export type OrderReviewData = {
  taskId: string
  caseId: string
  canAct: boolean
  done: boolean
  client: string
  person: { name: string; email: string }
  role: string
  stateCode: string
  wageCents: number
  wageUnit: WageUnit
  startDate: string | null
  endDate: string | null
  package: BenefitPackage
  packageLabel: string
  quote: {
    committedMonthlyCents: number
    committedAnnualCents: number
    withBenefitsMonthlyCents: number
    withBenefitsAnnualCents: number
    markupPct: number
  } | null
  deposit: DepositView
  agreement: { status: "signed" | "draft" | "none"; signedAt: string | null }
  checks: OrderCheck[]
  /** The note a specialist left when approving (a done task only). */
  approvalNote: string | null
}

const DEPOSIT_LABEL: Record<DepositView["state"], string> = {
  none: "No deposit",
  open: "Not yet paid",
  processing: "Payment processing",
  paid: "Paid and held",
  cancelled: "Cancelled",
}

export function depositViewFor(db: AppDatabase, hireId: string): DepositView {
  const { state, invoice } = depositState(db, hireId)
  return { state, label: DEPOSIT_LABEL[state], amountCents: invoice?.totalCents ?? null }
}

export function loadOrderReview(
  db: AppDatabase,
  viewer: StaffViewer,
  taskId: string,
  now: Date = new Date(),
): OrderReviewData | null {
  const found = loadStaffTask(db, viewer, taskId, ["review_order"], now)
  if (!found) return null
  const { basics, page, task } = found
  const snapshot = basics.snapshot
  const agreement = agreementFor(db, basics.clientCompanyId)
  const wageCents = snapshot?.comp.wageCents ?? basics.wageCents
  const wageUnit = snapshot?.comp.wageUnit ?? basics.wageUnit
  const stateCode = snapshot?.comp.stateCode ?? basics.stateCode
  const pkg = snapshot?.package ?? basics.package
  const note = task.result && typeof task.result.note === "string" ? task.result.note : null

  return {
    taskId,
    caseId: basics.caseId,
    canAct: page.canAct,
    done: task.status === "done",
    client: basics.clientName,
    person: { name: basics.workerName, email: basics.workerEmail },
    role: basics.roleName,
    stateCode,
    wageCents,
    wageUnit,
    startDate: basics.startDate,
    endDate: basics.endDate,
    package: pkg,
    packageLabel: US_2026.packages[pkg].label,
    quote: snapshot?.quote
      ? {
          committedMonthlyCents: snapshot.quote.totals.committed.monthlyCents,
          committedAnnualCents: snapshot.quote.totals.committed.annualCents,
          withBenefitsMonthlyCents: snapshot.quote.totals.withBenefits.monthlyCents,
          withBenefitsAnnualCents: snapshot.quote.totals.withBenefits.annualCents,
          markupPct: snapshot.quote.markupPct,
        }
      : null,
    deposit: depositViewFor(db, basics.hireId),
    agreement: agreement
      ? { status: agreement.status, signedAt: agreement.signedAt }
      : { status: "none", signedAt: null },
    checks: orderChecks({
      stateCode: basics.stateCode,
      wageCents: basics.wageCents,
      wageUnit: basics.wageUnit,
      startDate: basics.startDate,
      snapshot,
      agreementSigned: agreement?.status === "signed",
      now,
    }),
    approvalNote: note,
  }
}
