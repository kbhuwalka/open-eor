import { FinanceOverviewTiles } from "@/components/finance-portal/overview-tiles"
import { PageHeader } from "@/components/page-header"
import { TaskInboxHome } from "@/components/tasks/task-inbox-home"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function FinancePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Finance" description="Deposits and other tasks waiting on Finance, most urgent first." />
      <FinanceOverviewTiles />
      <TaskInboxHome portal="finance" searchParams={searchParams} />
    </div>
  )
}
