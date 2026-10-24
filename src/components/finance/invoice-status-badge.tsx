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

export function InvoiceStatusBadge({ status, className }: { status: InvoiceDisplayStatus; className?: string }) {
  return (
    <StatusPill
      tone={INVOICE_TONE[status]}
      label={INVOICE_STATUS_LABEL[status]}
      slot="invoice-status"
      value={status}
      className={className}
    />
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
