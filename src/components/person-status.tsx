import { cn } from "cn"

import { PERSON_STATUS_LABEL, type PersonStatus } from "@/domain/person-status"

const TONE: Record<PersonStatus, { badge: string; dot: string }> = {
  onboarding: {
    badge: "bg-status-info text-status-info-foreground",
    dot: "bg-status-info-foreground",
  },
  active: {
    badge: "bg-status-success text-status-success-foreground",
    dot: "bg-status-success-foreground",
  },
  inactive: {
    badge: "bg-status-neutral text-status-neutral-foreground",
    dot: "bg-status-neutral-foreground",
  },
}

/** ui-guidelines §6: the three-state person status, the only status a client sees in lists. */
export function PersonStatusBadge({
  status,
  className,
}: {
  status: PersonStatus
  className?: string
}) {
  const t = TONE[status]
  return (
    <span
      data-slot="person-status"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        t.badge,
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} />
      {PERSON_STATUS_LABEL[status]}
    </span>
  )
}
