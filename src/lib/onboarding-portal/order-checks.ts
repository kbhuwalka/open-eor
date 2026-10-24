/**
 * The checks an onboarding specialist sees beside an order before approving it (onboarding-portal.md
 * §2). Pure: the server read model passes in what it loaded and this decides pass / warn / fail and
 * the wording. A failing check does not block the engine (the engine only knows the task's
 * dependencies); it tells the specialist what to look at.
 */
import { earliestStartDate } from "@/domain/business-days"
import { todayIso } from "@/domain/employment-term"
import type { PolicySnapshotV1, WageUnit } from "@/domain/types"
import { effectiveHourlyCents, resolveWageFloor } from "@/domain/wage"

import { formatCents } from "../format"
import { stateName } from "../us-states"

export type CheckStatus = "pass" | "warn" | "fail"

export type OrderCheck = {
  id: "location" | "wage_floor" | "snapshot" | "start_date" | "agreement"
  status: CheckStatus
  label: string
  detail: string
}

export type OrderCheckInput = {
  stateCode: string
  wageCents: number
  wageUnit: WageUnit
  startDate: string | null
  snapshot: PolicySnapshotV1 | null
  /** The client company's master agreement is signed. */
  agreementSigned: boolean
  now: Date
}

function hourly(cents: number): string {
  return `${formatCents(cents)} / hr`
}

export function orderChecks(input: OrderCheckInput): OrderCheck[] {
  const { stateCode, wageCents, wageUnit, startDate, snapshot, now } = input
  const checks: OrderCheck[] = []

  checks.push({
    id: "location",
    status: "pass",
    label: "Work location registered",
    detail: `Northwind is registered to employ in ${stateName(stateCode)}.`,
  })

  const floor = resolveWageFloor(stateCode)
  const effective = effectiveHourlyCents(wageCents, wageUnit)
  checks.push(
    effective >= floor.effectiveHourlyCents
      ? {
          id: "wage_floor",
          status: "pass",
          label: "Meets the wage floor",
          detail: `${hourly(effective)} against a ${hourly(floor.effectiveHourlyCents)} floor (${floor.source === "FEDERAL" ? "federal" : stateName(floor.source)}).`,
        }
      : {
          id: "wage_floor",
          status: "fail",
          label: "Below the wage floor",
          detail: `${hourly(effective)} is under the ${hourly(floor.effectiveHourlyCents)} floor (${floor.source === "FEDERAL" ? "federal" : stateName(floor.source)}).`,
        },
  )

  if (!snapshot) {
    checks.push({
      id: "snapshot",
      status: "warn",
      label: "No policy snapshot",
      detail: "This order was placed before terms were frozen, so there is nothing to compare against.",
    })
  } else {
    const drift: string[] = []
    if (snapshot.comp.wageCents !== wageCents || snapshot.comp.wageUnit !== wageUnit) drift.push("pay")
    if (snapshot.comp.stateCode !== stateCode) drift.push("work location")
    if (snapshot.wageFloor.effectiveHourlyCents !== floor.effectiveHourlyCents) drift.push("wage floor")
    checks.push(
      drift.length === 0
        ? {
            id: "snapshot",
            status: "pass",
            label: "Matches the policy snapshot",
            detail: `Terms frozen ${snapshot.capturedAt.slice(0, 10)} still match the order.`,
          }
        : {
            id: "snapshot",
            status: "fail",
            label: "Differs from the policy snapshot",
            detail: `The order's ${drift.join(" and ")} no longer matches what was frozen when it was placed.`,
          },
    )
  }

  const today = todayIso(now)
  if (!startDate) {
    checks.push({ id: "start_date", status: "warn", label: "No start date", detail: "The client has not set a start date." })
  } else if (startDate < today) {
    checks.push({
      id: "start_date",
      status: "fail",
      label: "Start date has passed",
      detail: "Ask the client for a new start date before approving.",
    })
  } else if (startDate < earliestStartDate(now)) {
    checks.push({
      id: "start_date",
      status: "warn",
      label: "Start date is tight",
      detail: "Less than five business days of notice remain. Approve today to give the employee time to finish their forms.",
    })
  } else {
    checks.push({
      id: "start_date",
      status: "pass",
      label: "Start date is feasible",
      detail: "There is enough notice to onboard before the start date.",
    })
  }

  checks.push(
    input.agreementSigned
      ? { id: "agreement", status: "pass", label: "Client agreement signed", detail: "The master EOR agreement is on file." }
      : { id: "agreement", status: "fail", label: "Client agreement not signed", detail: "The client has not signed the master EOR agreement." },
  )

  return checks
}

/** Any failing check: the specialist should look before approving. */
export function hasFailingCheck(checks: readonly OrderCheck[]): boolean {
  return checks.some((check) => check.status === "fail")
}
