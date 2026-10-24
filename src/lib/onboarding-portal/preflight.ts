/**
 * The pre-flight checklist of the "Set up payroll" task (onboarding-portal.md §4): the five things
 * payroll needs before it can be created, each derived from the case's real tasks and stored forms,
 * with a link to where the specialist can look. Pure; the engine independently refuses to complete
 * `setup_payroll` until its dependencies are done, so this explains the same rule in words.
 */
import type { Task } from "@/domain/tasks"

export type DepositStateName = "none" | "open" | "processing" | "paid" | "cancelled"

export type PreflightItemId = "agreement" | "deposit" | "w4" | "direct_deposit" | "i9"

export type PreflightItem = {
  id: PreflightItemId
  label: string
  done: boolean
  /** What is true now: "Signed", or who the case is waiting on. */
  detail: string
  href: string
}

type TaskLite = Pick<Task, "id" | "key" | "status" | "party">

export type PreflightInput = {
  caseId: string
  workerName: string
  /** Every task of the case; the latest instance of a key wins. */
  tasks: readonly TaskLite[]
  deposit: { state: DepositStateName; amountLabel: string | null }
  forms: { w4: boolean; directDeposit: boolean }
}

function latestByKey(tasks: readonly TaskLite[]): Map<string, TaskLite> {
  const latest = new Map<string, TaskLite>()
  for (const task of tasks) latest.set(task.key, task)
  return latest
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

export const caseHref = (caseId: string, tab?: string) => `/onboarding/people/${caseId}${tab ? `?tab=${tab}` : ""}`

export function preflightItems(input: PreflightInput): PreflightItem[] {
  const latest = latestByKey(input.tasks)
  const done = (key: string) => latest.get(key)?.status === "done"
  const worker = firstName(input.workerName)

  const agreement: PreflightItem = {
    id: "agreement",
    label: "Employment agreement signed",
    done: done("sign_agreement"),
    detail: done("sign_agreement") ? "Signed by the employee" : `Waiting on ${worker} to sign`,
    href: caseHref(input.caseId, "documents"),
  }

  const depositDone = done("confirm_deposit")
  let depositDetail: string
  if (depositDone) {
    depositDetail = "Paid and confirmed by Finance"
  } else if (input.deposit.state === "processing") {
    depositDetail = "Payment is processing; Finance confirms it when it settles"
  } else if (done("pay_deposit")) {
    depositDetail = "Paid; waiting on Finance to confirm"
  } else {
    depositDetail = `Waiting on the client to pay${input.deposit.amountLabel ? ` ${input.deposit.amountLabel}` : " the deposit"}`
  }
  const deposit: PreflightItem = {
    id: "deposit",
    label: "Deposit paid and confirmed",
    done: depositDone,
    detail: depositDetail,
    href: caseHref(input.caseId, "order"),
  }

  const w4Done = input.forms.w4 || done("w4")
  const w4: PreflightItem = {
    id: "w4",
    label: "W-4 on file",
    done: w4Done,
    detail: w4Done ? "On file" : `Waiting on ${worker} to complete the W-4`,
    href: caseHref(input.caseId, "forms"),
  }

  const directDone = input.forms.directDeposit || done("direct_deposit")
  const directDeposit: PreflightItem = {
    id: "direct_deposit",
    label: "Direct deposit on file",
    done: directDone,
    detail: directDone ? "On file" : `Waiting on ${worker} to add bank details`,
    href: caseHref(input.caseId, "forms"),
  }

  const i9Task = latest.get("verify_i9_section2")
  const i9Done = i9Task?.status === "done"
  const i9: PreflightItem = {
    id: "i9",
    label: "I-9 verified",
    done: i9Done,
    detail: i9Done
      ? "Section 2 completed"
      : i9Task?.status === "ready"
        ? "Documents are ready to verify"
        : `Waiting on ${worker} to upload identity documents`,
    href: i9Task && i9Task.status === "ready" ? `/onboarding?open=${i9Task.id}` : caseHref(input.caseId, "documents"),
  }

  return [agreement, deposit, w4, directDeposit, i9]
}

/** What stands between the specialist and "Create payroll", in the order the checklist lists them. */
export function payrollBlockers(items: readonly PreflightItem[]): string[] {
  return items.filter((item) => !item.done).map((item) => `${item.label}: ${item.detail.charAt(0).toLowerCase()}${item.detail.slice(1)}`)
}
