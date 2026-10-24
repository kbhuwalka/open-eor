import { Skeleton } from "@/components/ui/skeleton"

/** The Onboarding home while it loads: search and three filters, then a few rows (ui-guidelines L2a). */
export function TaskInboxSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy data-testid="task-inbox-skeleton">
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-10 min-w-56 flex-[2_1_16rem]" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-10 w-44" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="flex flex-col gap-4 p-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-6">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Mirrors `TaskTodoList`: progress line, the up-next card, two rows. */
export function TaskTodoSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy data-testid="task-todo-skeleton">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-1.5 w-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  )
}

/** Mirrors `TaskPage`: back link, title, then the two columns of the L3 detail shape. */
export function TaskPageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy data-testid="task-page-skeleton">
      <Skeleton className="h-4 w-28" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  )
}
