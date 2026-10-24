import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors `EmployeeHome`: headline, progress bar, the Continue card and a few stepper rows (ui-guidelines L2a). */
export function EmployeeHomeSkeleton() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-8" aria-busy data-testid="employee-home-skeleton">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-1.5 w-full" />
      </div>
      <Skeleton className="h-28 w-full" />
      <div className="flex flex-col gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Mirrors the documents list: one row per signed document. */
export function EmployeeDocumentsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy data-testid="employee-documents-skeleton">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}

/** Mirrors the Benefits page: three titled sections of rows and the history list. */
export function BenefitsSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy data-testid="benefits-skeleton">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}
