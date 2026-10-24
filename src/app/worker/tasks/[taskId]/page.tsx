import { TaskPage } from "@/components/tasks/task-page"

export default function WorkerTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <TaskPage portal="worker" params={params} searchParams={searchParams} />
}
