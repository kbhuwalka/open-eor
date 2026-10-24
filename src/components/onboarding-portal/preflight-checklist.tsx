import Link from "next/link"
import { cn } from "cn"
import { CircleCheck, Clock } from "lucide-react"

import type { PreflightItem } from "@/lib/onboarding-portal/preflight"

/**
 * What payroll needs, each with its state in words and a link to where to look (onboarding-portal.md
 * §4). The state is text as well as an icon (S2); a pending item says who it waits on.
 */
export function PreflightChecklist({ items }: { items: readonly PreflightItem[] }) {
  return (
    <ul className="overflow-hidden rounded-lg border border-border" data-testid="preflight">
      {items.map((item) => {
        const Icon = item.done ? CircleCheck : Clock
        return (
          <li
            key={item.id}
            className="flex items-start gap-3 px-4 py-3 not-first:border-t not-first:border-border"
            data-testid={`preflight-${item.id}`}
            data-done={item.done}
          >
            <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", item.done ? "text-status-success-foreground" : "text-muted-foreground")} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {item.label}
                <span className="sr-only">: {item.done ? "done" : "not done"}</span>
              </span>
              <span className="text-xs text-muted-foreground">{item.detail}</span>
            </div>
            <Link href={item.href} className="shrink-0 text-sm text-primary hover:underline" data-testid={`preflight-link-${item.id}`}>
              {item.done ? "View" : "Open"}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
