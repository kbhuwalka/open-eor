import { TaskPage } from "@/components/tasks/task-page"

export default function OnboardingTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <TaskPage portal="onboarding" params={params} searchParams={searchParams} />
}
