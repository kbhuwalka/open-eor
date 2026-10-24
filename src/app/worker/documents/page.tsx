import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { EmployeeDocuments } from "@/components/employee-tasks/employee-documents"
import { EmployeeDocumentsSkeleton } from "@/components/employee-tasks/employee-skeletons"
import { PageHeader } from "@/components/page-header"
import { getDb } from "@/db"
import { listEmployeeDocuments } from "@/server/employee-documents"

export default function WorkerDocumentsPage() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <PageHeader title="Documents" description="The forms you signed, kept as signed copies you can download." />
      <Suspense fallback={<EmployeeDocumentsSkeleton />}>
        <Documents />
      </Suspense>
    </div>
  )
}

async function Documents() {
  const user = await requirePortalUser("worker")
  return <EmployeeDocuments documents={listEmployeeDocuments(getDb(), user.id)} />
}
