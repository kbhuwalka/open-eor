"use client"

import { useEffect, useState } from "react"
import { Download, ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"

/** A PDF as a URL, a Blob, or raw bytes. */
export type PdfSource = string | Blob | Uint8Array

/** Object URL for a Blob/bytes source (revoked on change and unmount); string sources pass through. */
export function usePdfUrl(source: PdfSource | null | undefined): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const direct = typeof source === "string" ? source : null

  useEffect(() => {
    if (source == null || typeof source === "string") return
    const blob = source instanceof Blob ? source : new Blob([source as BlobPart], { type: "application/pdf" })
    const created = URL.createObjectURL(blob)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL only exists once the effect has created it
    setObjectUrl(created)
    return () => {
      URL.revokeObjectURL(created)
      setObjectUrl(null)
    }
  }, [source])

  return direct ?? objectUrl
}

export function PdfViewer({
  source,
  title,
  fileName = "document.pdf",
  className,
}: {
  source: PdfSource
  title: string
  fileName?: string
  className?: string
}) {
  const url = usePdfUrl(source)
  return (
    <div className={className} data-testid="pdf-viewer">
      <div className="overflow-hidden rounded-lg border border-border bg-muted">
        {url ? (
          <iframe title={title} src={`${url}#navpanes=0&view=FitH`} className="h-[34rem] w-full bg-muted" />
        ) : (
          <div className="h-[34rem] w-full animate-pulse" aria-hidden />
        )}
      </div>
      {url ? (
        <div className="mt-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<a href={url} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink data-icon="inline-start" />
            Open in a new tab
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<a href={url} download={fileName} />}>
            <Download data-icon="inline-start" />
            Download
          </Button>
        </div>
      ) : null}
    </div>
  )
}
