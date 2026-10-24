import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import type { TaskScreenProps } from "@/components/tasks/task-screens"
import { getDb } from "@/db"
import { loadFiling } from "@/server/onboarding-portal/filings"
import { loadI9Review } from "@/server/onboarding-portal/i9-review"
import { loadOrderReview } from "@/server/onboarding-portal/order-review"
import { loadPayrollSetup } from "@/server/onboarding-portal/payroll-setup"

import { FilingScreen } from "./filing-screen"
import { I9VerifyScreen } from "./i9-verify-screen"
import { OrderReviewScreen } from "./order-review-screen"
import { PayrollSetupScreen } from "./payroll-setup-screen"

/**
 * The one entry the generic task route (`TASK_SCREENS`) uses for every onboarding-specialist task
 * type. It loads the screen's data for the signed-in specialist (a task that is not theirs to see
 * is a 404) and picks the component by the task's type; the screens are client components over
 * plain data (onboarding-portal.md §2).
 */
export async function SpecialistTaskScreen(props: TaskScreenProps) {
  const user = await requirePortalUser("onboarding_specialist")
  const db = getDb()
  const now = new Date(props.nowIso)
  const taskId = props.task.id

  switch (props.task.type) {
    case "review_order": {
      const data = loadOrderReview(db, user, taskId, now)
      if (!data) notFound()
      return <OrderReviewScreen props={props} data={data} />
    }
    case "verify_i9_section2": {
      const data = loadI9Review(db, user, taskId, now)
      if (!data) notFound()
      return <I9VerifyScreen props={props} data={data} />
    }
    case "setup_payroll": {
      const data = loadPayrollSetup(db, user, taskId, now)
      if (!data) notFound()
      return <PayrollSetupScreen props={props} data={data} />
    }
    case "file_new_hire_report":
    case "submit_benefit_enrollments": {
      const data = loadFiling(db, user, taskId, now)
      if (!data) notFound()
      return <FilingScreen props={props} data={data} />
    }
    default:
      notFound()
  }
}
