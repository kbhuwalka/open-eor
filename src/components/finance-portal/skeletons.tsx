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

/** Invoices: the one control row, the summary caption, then the table's header band over ten 44px rows. */
export function InvoicesSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy data-testid="finance-skeleton">
      <div className="flex flex-wrap gap-3 lg:flex-nowrap">
        <Skeleton className="h-10 min-w-56 flex-1" />
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-3 w-80" />
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex h-10 items-center gap-6 border-b border-border bg-muted/60 px-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="hidden h-3 w-28 md:block" />
          <Skeleton className="hidden h-3 w-32 md:block" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-6 border-b border-border px-3 last:border-b-0">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="hidden h-4 w-28 md:block" />
            <Skeleton className="hidden h-4 w-32 md:block" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Receivables: the figures line, the By age section (four rows), then the table's heading and its header band over rows. */
export function ReceivablesSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy data-testid="finance-skeleton">
      <div className="flex items-baseline gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex h-8 items-center gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex flex-col gap-0.5 border-t border-border pt-4">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex flex-col gap-1.5 py-2">
              <div className="flex justify-between gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex h-8 items-center">
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex h-10 items-center gap-6 border-b border-border bg-muted/60 px-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="hidden h-3 w-28 md:block" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto h-3 w-20" />
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex h-[61px] items-center gap-6 border-b border-border px-3 last:border-b-0">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="hidden h-4 w-28 md:block" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Billing run: the Run card over By client on the left (3/5), the chart over Recent issue dates on the right (2/5). */
export function BillingRunSkeleton() {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => (
      <div key={i} className="flex h-10 items-center gap-6 border-b border-border px-2">
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-24" />
      </div>
    ))
  return (
    <div className="grid gap-8 lg:grid-cols-5 lg:items-start" aria-busy data-testid="finance-skeleton">
      <div className="flex flex-col gap-8 lg:col-span-3">
        <div className="rounded-lg border border-border">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-10 w-48" />
          </div>
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <div className="border-t border-border">{rows(3)}</div>
        </div>
      </div>
      <div className="flex flex-col gap-8 lg:col-span-2">
        <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <div className="border-t border-border">{rows(5)}</div>
        </div>
      </div>
    </div>
  )
}

/** Home row 1: the figures line. */
export function HomeFiguresSkeleton() {
  return (
    <div className="flex items-baseline gap-3" aria-busy data-testid="home-figures-skeleton">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-4 w-36" />
    </div>
  )
}

/** Home row 2: billed vs collected, full width: a section head over a hairline and the plot. */
export function HomeChartsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy data-testid="home-charts-skeleton">
      <div className="flex h-8 items-center gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="border-t border-border pt-4">
        <Skeleton className="h-60 w-full" />
      </div>
    </div>
  )
}

/** Home row 3: the To do header and five rows. */
export function WaitingSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy data-testid="waiting-skeleton">
      <div className="flex h-8 items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="h-10 border-b border-border bg-muted/60" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex h-[61px] items-center gap-3 border-b border-border px-3 last:border-0">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
