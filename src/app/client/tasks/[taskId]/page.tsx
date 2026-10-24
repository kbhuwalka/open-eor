import { TaskPage } from "@/components/tasks/task-page"

export default function ClientTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <TaskPage portal="client" params={params} searchParams={searchParams} />
}
