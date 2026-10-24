"use client"

import { useState } from "react"
import { Download } from "lucide-react"

import { formatDay } from "@/lib/format"
import type { CaseGeneratedDocument, CaseUpload, UploadReview } from "@/server/onboarding-portal/case-detail"

import { DocumentViewer, documentLabel } from "../document-viewer"
import { StatusPill, type PillTone } from "./status-pill"

const REVIEW: Record<UploadReview, { label: string; tone: PillTone }> = {
  accepted: { label: "Accepted", tone: "success" },
  awaiting: { label: "Awaiting review", tone: "neutral" },
  sent_back: { label: "Sent back", tone: "danger" },
  replaced: { label: "Replaced", tone: "neutral" },
}

/**
 * Uploads with their review state and a preview, then the generated and signed documents with a
 * hash-verified download (onboarding-portal.md §3). A file that is missing from storage
 * says "File not available" in words instead of a dead link.
 */
export function CaseDocumentsTab({
  uploads,
  documents,
  nowIso,
}: {
  uploads: CaseUpload[]
  documents: CaseGeneratedDocument[]
  nowIso: string
}) {
  const now = new Date(nowIso)
  const [selected, setSelected] = useState(uploads.find((upload) => upload.review !== "replaced")?.id ?? uploads[0]?.id)
  const shown = uploads.filter((upload) => upload.id === selected)

  return (
    <div className="flex flex-col gap-8" data-testid="case-documents">
      <section className="flex flex-col gap-3" aria-labelledby="uploads-heading">
        <h3 id="uploads-heading" className="text-base font-semibold">Uploads</h3>
        {uploads.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-uploads">The employee has not uploaded anything yet.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <ul className="flex flex-col overflow-hidden rounded-lg border border-border self-start" data-testid="upload-list">
              {uploads.map((upload) => {
                const review = REVIEW[upload.review]
                return (
                  <li key={upload.id} className="not-first:border-t not-first:border-border">
                    <button
                      type="button"
                      onClick={() => setSelected(upload.id)}
                      aria-pressed={upload.id === selected}
                      data-testid={`upload-${upload.id}`}
                      className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-muted"
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm font-medium">{documentLabel(upload)}</span>
                        <StatusPill tone={review.tone} testId="upload-review">{review.label}</StatusPill>
                      </span>
                      <span className="max-w-full truncate text-xs text-muted-foreground">
                        {upload.fileName} · {formatDay(new Date(upload.uploadedAt), now)}
                      </span>
                      {upload.mime === null ? <span className="text-xs text-status-danger-foreground" data-testid="upload-no-file">File not available</span> : null}
                      {upload.reviewNote ? <span className="text-xs text-muted-foreground">{upload.reviewNote}</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
            <DocumentViewer documents={shown} nowIso={nowIso} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="generated-heading">
        <h3 id="generated-heading" className="text-base font-semibold">Generated and signed documents</h3>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-generated">Nothing has been generated for this case yet.</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border" data-testid="generated-list">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 not-first:border-t not-first:border-border" data-testid="generated-document">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{doc.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {doc.signers.length > 0
                      ? doc.signers.map((signer) => `Signed by ${signer.name} on ${formatDay(new Date(signer.signedAt), now)}`).join(" · ")
                      : `Generated ${formatDay(new Date(doc.createdAt), now)}`}
                  </span>
                </div>
                {doc.downloadable ? (
                  <a href={doc.url} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline" data-testid="document-download">
                    <Download aria-hidden className="size-3.5" />
                    Download
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground" data-testid="document-no-copy">File not available</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
