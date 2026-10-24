/**
 * What the specialist home's drawer needs to work one task without leaving the list: the task's state
 * and the read model of its type. The drawer is where all five specialist tasks are done, so this is the
 * single entry; each branch is the same loader the task's rules already live in, which also decides
 * whether this viewer may see the task at all (null is "not found").
 */
import type { AppDatabase } from "@/db/client"
import type { TaskInboxRow } from "@/lib/task-inbox-view"

import { loadTaskPage } from "../task-page"
import { loadFiling, type FilingData } from "./filings"
import { loadI9Review, type I9ReviewData } from "./i9-review"
import { loadOrderReview, type OrderReviewData } from "./order-review"
import { loadPayrollSetup, type PayrollSetupData } from "./payroll-setup"
import type { StaffViewer } from "./core"

export type DrawerBody =
  | { kind: "order"; data: OrderReviewData }
  | { kind: "i9"; data: I9ReviewData }
  | { kind: "payroll"; data: PayrollSetupData }
  | { kind: "filing"; data: FilingData }

export type DrawerTask = {
  taskId: string
  status: TaskInboxRow["status"]
  /** "Waiting on …", for a task the viewer cannot act on yet. */
  waitingOn: string
  body: DrawerBody
}

function bodyFor(db: AppDatabase, viewer: StaffViewer, type: string, taskId: string, now: Date): DrawerBody | null {
  switch (type) {
    case "review_order": {
      const data = loadOrderReview(db, viewer, taskId, now)
      return data && { kind: "order", data }
    }
    case "verify_i9_section2": {
      const data = loadI9Review(db, viewer, taskId, now)
      return data && { kind: "i9", data }
    }
    case "setup_payroll": {
      const data = loadPayrollSetup(db, viewer, taskId, now)
      return data && { kind: "payroll", data }
    }
    case "file_new_hire_report":
    case "submit_benefit_enrollments": {
      const data = loadFiling(db, viewer, taskId, now)
      return data && { kind: "filing", data }
    }
    default:
      return null
  }
}

export function loadDrawerTask(db: AppDatabase, viewer: StaffViewer, taskId: string, now: Date = new Date()): DrawerTask | null {
  const page = loadTaskPage(db, viewer, "onboarding", taskId, now)
  if (!page) return null
  const body = bodyFor(db, viewer, page.row.type, taskId, now)
  if (!body) return null
  return { taskId, status: page.row.status, waitingOn: page.row.assigneeLabel, body }
}
