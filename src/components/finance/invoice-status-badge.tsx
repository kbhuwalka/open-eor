import { cn } from "cn"

import {
  INVOICE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type InvoiceDisplayStatus,
  type PaymentViewStatus,
} from "@/lib/finance-view"

type Tone = { badge: string; dot: string }

const NEUTRAL: Tone = {
  badge: "bg-status-neutral text-status-neutral-foreground",
  dot: "bg-status-neutral-foreground",
}
const INFO: Tone = { badge: "bg-status-info text-status-info-foreground", dot: "bg-status-info-foreground" }
const SUCCESS: Tone = {
  badge: "bg-status-success text-status-success-foreground",
  dot: "bg-status-success-foreground",
}
const DANGER: Tone = {
  badge: "bg-status-danger text-status-danger-foreground",
  dot: "bg-status-danger-foreground",
}

/** ui-guidelines C24: the only place an invoice status is mapped to a status token. */
const INVOICE_TONE: Record<InvoiceDisplayStatus, Tone> = {
  open: NEUTRAL,
  overdue: DANGER,
  processing: INFO,
  paid: SUCCESS,
  void: NEUTRAL,
}

const PAYMENT_TONE: Record<PaymentViewStatus, Tone> = {
  initiated: INFO,
  settled: SUCCESS,
  failed: DANGER,
}

function StatusPill({
  tone,
  label,
  slot,
  value,
  className,
}: {
  tone: Tone
  label: string
  slot: string
  value: string
  className?: string
}) {
  return (
    <span
      data-slot={slot}
      data-status={value}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone.badge,
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", tone.dot)} />
      {label}
    </span>
  )
}

type InvoiceStatusProps = {
  status: InvoiceDisplayStatus
  /** The word for an audience with its own vocabulary (Finance's "Unpaid"); the client's by default. */
  labels?: Record<InvoiceDisplayStatus, string>
  className?: string
}

export function InvoiceStatusBadge({ status, labels = INVOICE_STATUS_LABEL, className }: InvoiceStatusProps) {
  return (
    <StatusPill
      tone={INVOICE_TONE[status]}
      label={labels[status]}
      slot="invoice-status"
      value={status}
      className={className}
    />
  )
}

/** The status in a dense row or a table cell: the tone's dot and the word, without the pill. */
export function InvoiceStatusDot({ status, labels = INVOICE_STATUS_LABEL, className }: InvoiceStatusProps) {
  return (
    <span data-slot="invoice-status" data-status={status} className={cn("inline-flex items-center gap-1.5 text-sm whitespace-nowrap", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", INVOICE_TONE[status].dot)} />
      {labels[status]}
    </span>
  )
}

export function PaymentStatusBadge({ status, className }: { status: PaymentViewStatus; className?: string }) {
  return (
    <StatusPill
      tone={PAYMENT_TONE[status]}
      label={PAYMENT_STATUS_LABEL[status]}
      slot="payment-status"
      value={status}
      className={className}
    />
  )
}
