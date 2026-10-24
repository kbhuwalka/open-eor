import { Skeleton } from "@/components/ui/skeleton"

/** Table-shaped placeholder for the Finance lists (L2a). */
export function TableSkeleton({ rows = 5, filters = false }: { rows?: number; filters?: boolean }) {
  return (
    <div className="flex flex-col gap-4" aria-busy data-testid="finance-skeleton">
      {filters ? (
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-48" />
        </div>
      ) : (
        <Skeleton className="h-8 w-72" />
      )}
      <div className="overflow-hidden rounded-lg border border-border">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="flex flex-col gap-4 p-4">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex gap-6">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy data-testid="finance-skeleton">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}
