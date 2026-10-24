import { cn } from "cn"
import { TriangleAlert } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Warning icon with the reason on hover or focus. Renders nothing unless the start date is at
 * risk, which the server derives from the tasks (ui-guidelines S1).
 */
export function AtRiskFlag({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        aria-label={`Start date at risk. ${message}`}
        data-testid="start-at-risk"
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-md text-status-warning-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className
        )}
      >
        <TriangleAlert className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  )
}
