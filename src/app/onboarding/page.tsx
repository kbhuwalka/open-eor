import { Suspense } from "react"
import { notFound } from "next/navigation"

import { requirePortalUser } from "@/auth"
import { OnboardingHomeSummary, OnboardingHomeSummarySkeleton } from "@/components/onboarding-portal/home-summary"
import { PageHeader } from "@/components/page-header"
import { TaskInboxHome } from "@/components/tasks/task-inbox-home"
import { getDb } from "@/db"
import { homeSummary } from "@/server/onboarding-portal/directory"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function OnboardingHomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Home" description="What needs the onboarding team today, most urgent first." />
      <Suspense fallback={<OnboardingHomeSummarySkeleton />}>
        <Summary />
      </Suspense>
      <TaskInboxHome portal="onboarding" searchParams={searchParams} />
    </div>
  )
}

async function Summary() {
  const user = await requirePortalUser("onboarding_specialist")
  const summary = homeSummary(getDb(), user, new Date())
  if (!summary) notFound()
  return <OnboardingHomeSummary summary={summary} />
}
