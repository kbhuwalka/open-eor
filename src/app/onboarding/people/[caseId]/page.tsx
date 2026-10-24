import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { AtRiskFlag } from "@/components/at-risk-flag"
import { CaseTimeline } from "@/components/case-timeline"
import { CaseDocumentsTab } from "@/components/onboarding-portal/case/case-documents-tab"
import { CaseFormsTab } from "@/components/onboarding-portal/case/case-forms-tab"
import { CaseOrderTab } from "@/components/onboarding-portal/case/case-order-tab"
import { CaseTabs } from "@/components/onboarding-portal/case/case-tabs"
import { CaseTasksTab } from "@/components/onboarding-portal/case/case-tasks-tab"
import { PersonStatusBadge } from "@/components/person-status"
import { Skeleton } from "@/components/ui/skeleton"
import { getDb } from "@/db"
import { formatDay } from "@/lib/format"
import { parseDay } from "@/lib/task-view"
import { staffCaseDetail } from "@/server/onboarding-portal/case-detail"

type Params = Promise<{ caseId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function CaseDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<CaseSkeleton />}>
      <CaseDetail params={params} searchParams={searchParams} />
    </Suspense>
  )
}

function CaseSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6" aria-busy>
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-8 w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

async function CaseDetail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ caseId }, query, user] = await Promise.all([params, searchParams, requirePortalUser("onboarding_specialist")])
  const now = new Date()
  const detail = staffCaseDetail(getDb(), user, caseId, now)
  if (!detail) notFound()
  const tab = typeof query.tab === "string" ? query.tab : "tasks"

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6" data-testid="case-detail">
      <Link href="/onboarding/people" className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="size-3.5" />
        Back to People
      </Link>

      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight" data-testid="case-person">
            {detail.person.name}
            <AtRiskFlag message={detail.atRisk} />
          </h2>
          <PersonStatusBadge status={detail.status} />
        </div>
        <p className="text-sm text-muted-foreground" data-testid="case-summary">
          {detail.client.name}
          {` · ${detail.roleName} · ${detail.startDate ? `Starts ${formatDay(parseDay(detail.startDate), now)}` : "No start date"}`}
        </p>
      </header>

      <CaseTabs
        initial={tab}
        tabs={[
          { id: "tasks", label: "Tasks", content: <CaseTasksTab stages={detail.stages} now={now} /> },
          {
            id: "documents",
            label: "Documents",
            content: <CaseDocumentsTab uploads={detail.uploads} documents={detail.documents} nowIso={now.toISOString()} />,
          },
          { id: "forms", label: "Forms", content: <CaseFormsTab forms={detail.forms} now={now} /> },
          { id: "order", label: "Order", content: <CaseOrderTab order={detail.order} now={now} /> },
          { id: "activity", label: "Activity", content: <CaseTimeline entries={detail.activity} now={now} /> },
        ]}
      />
    </div>
  )
}
