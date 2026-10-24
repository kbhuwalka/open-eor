import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors `PayDashboardView`: four tiles, the section heading, a table, the direct-deposit card. */
export function PayDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy data-testid="pay-skeleton">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-24" />
        <div className="overflow-hidden rounded-lg border border-border">
          <Skeleton className="h-10 w-full rounded-none" />
          <div className="flex flex-col gap-5 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="ml-auto h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-14 w-full" />
    </div>
  )
}

/** Mirrors `PayslipDetailView`: back link, title, line cards on the left and the summary rail. */
export function PayslipDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy data-testid="payslip-skeleton">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          {[3, 3, 6].map((rows, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className={rows > 3 ? "h-64 w-full" : "h-36 w-full"} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  )
}
