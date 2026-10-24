import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { earliestStartDate } from "@/domain/business-days"
import { signedMasterAgreementFor } from "@/server/master-agreement"
import { agreementFor, rolesFor } from "@/server/queries"

import { NewPersonForm } from "./new-person-form"

export default function NewPersonPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <NewPerson />
    </Suspense>
  )
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy>
      <Skeleton className="h-7 w-40" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full max-w-md" />
        </div>
      ))}
    </div>
  )
}

async function NewPerson() {
  const user = await requirePortalUser("client_hr")
  const db = getDb()
  const clientCompanyId = user.clientCompanyId ?? ""
  const roles = rolesFor(db, clientCompanyId)
  const agreement = agreementFor(db, clientCompanyId)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Start a hire"
        description="Tell us who you are hiring. The request goes to Northwind as soon as you send it."
      />
      {!agreement ? (
        <EmptyState message="Your company has no EOR agreement on file. Contact Northwind." />
      ) : (
        <NewPersonForm
          roles={roles}
          agreement={agreement}
          signedAgreement={signedMasterAgreementFor(db, clientCompanyId)}
          earliestStart={earliestStartDate(new Date())}
        />
      )}
    </div>
  )
}
