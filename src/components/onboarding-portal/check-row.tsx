import { cn } from "cn"
import { CircleAlert, CircleCheck, CircleX } from "lucide-react"

import type { CheckStatus } from "@/lib/onboarding-portal/order-checks"

const ICON = {
  pass: { Icon: CircleCheck, tone: "text-status-success-foreground", label: "Passed" },
  warn: { Icon: CircleAlert, tone: "text-status-warning-foreground", label: "Needs a look" },
  fail: { Icon: CircleX, tone: "text-status-danger-foreground", label: "Failed" },
} as const

/** One line of a check list: the status as an icon with a text alternative, then what was checked. */
export function CheckRow({
  status,
  label,
  detail,
  testId,
}: {
  status: CheckStatus
  label: string
  detail: string
  testId?: string
}) {
  const { Icon, tone, label: statusLabel } = ICON[status]
  return (
    <li className="flex items-start gap-3 px-4 py-3 not-first:border-t not-first:border-border" data-testid={testId} data-status={status}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone)} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {label}
          <span className="sr-only">: {statusLabel}</span>
        </span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
    </li>
  )
}
