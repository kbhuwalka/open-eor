"use server"

/**
 * The employee's Benefits Server Action (employee-portal.md §7, acl §6). Identity is the session:
 * the caller sends only the percent, and the server records it against the signed-in employee's own
 * case from the next pay period that has not started.
 */
import { revalidatePath } from "next/cache"

import { requireRole } from "@/auth"
import { getDb } from "@/db"
import { fail, toActionError, type ActionResult } from "@/server/action-result"
import { changeRetirementElection, type RetirementChange } from "@/server/employee-benefits"
import { EmployeeInputError } from "@/server/employee-tasks"

export type ChangeContributionResult = RetirementChange

export async function changeContributionAction(deferralPct: number): Promise<ActionResult<ChangeContributionResult>> {
  try {
    const user = await requireRole("worker")
    const data = changeRetirementElection({ db: getDb(), now: () => new Date() }, user, { deferralPct })
    if (data.changed) {
      revalidatePath("/worker", "layout")
      revalidatePath("/worker/benefits")
    }
    return { ok: true, data }
  } catch (error) {
    if (error instanceof EmployeeInputError) {
      return fail("validation", error.message, Object.keys(error.errors).length > 0 ? { errors: error.errors } : undefined)
    }
    return toActionError(error)
  }
}
