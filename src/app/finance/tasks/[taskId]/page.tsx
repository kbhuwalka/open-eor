import { TaskPage } from "@/components/tasks/task-page"

export default function FinanceTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <TaskPage portal="finance" params={params} searchParams={searchParams} />
}
