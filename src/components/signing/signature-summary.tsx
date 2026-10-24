import { BadgeCheck } from "lucide-react"
import { cn } from "cn"

import { SummaryCard, SummaryRow } from "@/components/summary-card"

import { signatureFont } from "./signature-font"

/** What the read-only signature views need; a subset of the server's `SignatureRecord`. */
export type SignatureSummaryData = {
  signerName: string
  signerRole?: string
  typedSignature: string
  /** ISO 8601. */
  signedAt: string
  documentTitle?: string
  documentId?: string
  /** SHA-256 (hex) of the signed PDF. */
  sha256?: string
}

const DEFAULT_ZONE = "America/New_York"

export function formatSignedAt(iso: string, timeZone = DEFAULT_ZONE): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date)
}

/** One-line proof that something is signed. */
export function SignedBadge({
  signerName,
  signedAt,
  timeZone,
  className,
}: {
  signerName: string
  signedAt: string
  timeZone?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-status-success px-2 py-0.5 text-xs font-medium text-status-success-foreground",
        className
      )}
      data-testid="signed-badge"
    >
      <BadgeCheck className="size-3.5" aria-hidden />
      Signed by {signerName} · {formatSignedAt(signedAt, timeZone)}
    </span>
  )
}

/** Read-only signature record: the typed signature in script, who, when, and the document fingerprint. */
export function SignatureSummary({
  signature,
  timeZone,
  className,
}: {
  signature: SignatureSummaryData
  timeZone?: string
  className?: string
}) {
  return (
    <SummaryCard className={className} data-testid="signature-summary">
      {signature.documentTitle ? <SummaryRow label="Document">{signature.documentTitle}</SummaryRow> : null}
      <SummaryRow label="Signer">
        {signature.signerName}
        {signature.signerRole ? <span className="text-muted-foreground"> · {signature.signerRole}</span> : null}
      </SummaryRow>
      <SummaryRow label="Signature">
        <span className={cn(signatureFont.className, "text-2xl")}>{signature.typedSignature}</span>
      </SummaryRow>
      <SummaryRow label="Signed">{formatSignedAt(signature.signedAt, timeZone)}</SummaryRow>
      {signature.documentId ? (
        <SummaryRow label="Document ID">
          <span className="font-mono text-xs">{signature.documentId}</span>
        </SummaryRow>
      ) : null}
      {signature.sha256 ? (
        <SummaryRow label="SHA-256">
          <span className="font-mono text-xs break-all" title={signature.sha256}>
            {signature.sha256.slice(0, 16)}…
          </span>
        </SummaryRow>
      ) : null}
    </SummaryCard>
  )
}
