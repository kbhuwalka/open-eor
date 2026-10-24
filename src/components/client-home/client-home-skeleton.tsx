import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors the client Home below its header: the three glance cards, then To do with a group of three rows. */
export function ClientHomeSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy data-testid="client-home-skeleton">
      <div className="@container">
        <div className="divide-y divide-border rounded-lg border border-border @2xl:grid @2xl:grid-cols-2 @2xl:gap-3 @2xl:divide-y-0 @2xl:border-0">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 @2xl:flex @2xl:flex-col @2xl:items-stretch @2xl:gap-1 @2xl:rounded-lg @2xl:border @2xl:border-border${i === 2 ? " @2xl:col-span-2" : ""}`}
            >
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-7 w-20 @2xl:h-8" />
              <Skeleton className="col-span-2 h-5 w-40 max-w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col">
        <Skeleton className="mb-2 h-8 w-32" />
        <div className="border-t border-border">
          <div className="flex min-h-14 flex-col justify-center gap-1.5 border-b border-border py-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-14 items-center justify-between gap-4 border-b border-border py-2 pl-4">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-8 w-56 max-w-[50%]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
