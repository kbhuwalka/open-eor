import { Download, ExternalLink, FileCheck2 } from "lucide-react"

import { cn } from "cn"

import { EmptyState } from "@/components/empty-state"
import { buttonVariants } from "@/components/ui/button"
import { businessDayOf } from "@/domain/business-time"
import { shortDay } from "@/lib/employee-view"
import type { EmployeeDocumentRow } from "@/server/employee-documents"

/** The employee's signed documents: the name opens the signed copy in a new tab, an icon button downloads it. */
export function EmployeeDocuments({ documents }: { documents: EmployeeDocumentRow[] }) {
  if (documents.length === 0) {
    return <EmptyState message="Nothing signed yet. Each form you sign during onboarding is kept here." />
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="employee-documents">
      {documents.map((doc) => (
        <li
          key={doc.id}
          className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="employee-document"
          data-kind={doc.kind}
        >
          <div className="flex min-w-0 items-start gap-3">
            <FileCheck2 aria-hidden className="mt-0.5 size-4 shrink-0 text-status-success-foreground" />
            <div className="flex min-w-0 flex-col gap-0.5">
              {doc.downloadable ? (
                <a
                  href={`/worker/documents/${encodeURIComponent(doc.id)}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${doc.title} (opens in a new tab)`}
                  className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="view-document"
                >
                  {doc.title}
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              ) : (
                <span className="text-sm font-medium">{doc.title}</span>
              )}
              <span className="text-xs text-muted-foreground">{doc.description}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                Signed {shortDay(businessDayOf(doc.signedAt))} as {doc.signedAs}
              </span>
            </div>
          </div>
          {doc.downloadable ? (
            <a
              href={`/worker/documents/${encodeURIComponent(doc.id)}/download`}
              download
              className={cn(buttonVariants({ variant: "outline", size: "icon" }), "shrink-0 self-start sm:self-center")}
              data-testid="download-document"
              aria-label={`Download ${doc.title}`}
              title="Download"
            >
              <Download aria-hidden />
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
