import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import type { TaskScreenProps } from "@/components/tasks/task-screens"
import { getDb } from "@/db"
import { loadEmployeeScreen } from "@/server/employee-portal"

import { AcceptInvitationScreen } from "./accept-invitation-screen"
import { BenefitsScreen } from "./benefits-screen"
import { DirectDepositScreen } from "./direct-deposit-screen"
import { I9Screen } from "./i9-screen"
import { PersonalDetailsScreen } from "./personal-details-screen"
import { SignAgreementScreen } from "./sign-agreement-screen"
import { UploadDocumentsScreen } from "./upload-documents-screen"
import { W4Screen } from "./w4-screen"

/**
 * The one entry the generic task route (`TASK_SCREENS`) uses for every employee task type. It reads
 * the screen's data for the signed-in employee (anything that is not theirs is a 404, I6) and picks
 * the component by the data's `kind`; the screens themselves are client components over plain data.
 * The `fix_documents` rework has type `upload_documents`, so it lands on the same screen.
 */
export async function EmployeeTaskScreen({ task, nowIso }: TaskScreenProps) {
  const user = await requirePortalUser("worker")
  const data = loadEmployeeScreen(getDb(), user.id, task.id, new Date(nowIso))
  if (!data) notFound()

  switch (data.kind) {
    case "accept_invitation":
      return <AcceptInvitationScreen data={data} />
    case "sign_agreement":
      return <SignAgreementScreen data={data} />
    case "personal_details":
      return <PersonalDetailsScreen data={data} />
    case "i9_section1":
      return <I9Screen data={data} />
    case "upload_documents":
      return <UploadDocumentsScreen data={data} />
    case "w4":
      return <W4Screen data={data} />
    case "direct_deposit":
      return <DirectDepositScreen data={data} />
    case "benefits_decision":
      return <BenefitsScreen data={data} />
  }
}
