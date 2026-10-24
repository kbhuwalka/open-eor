import { ArrowLeftRight } from "lucide-react"

import { clearPersona } from "@/auth/actions"
import type { SessionUser } from "@/auth"
import { SwitchEmployeeButton } from "@/components/employee-picker"

const ROLE_LABEL: Record<SessionUser["role"], string> = {
  client_hr: "Client HR",
  worker: "Employee",
  onboarding_specialist: "Onboarding Specialist",
  finance: "Finance",
}

/**
 * Sidebar persona block. The persona button clears the session cookie and returns to `/pick`.
 * Employees also get "Switch employee", the picker's employee search without leaving the portal.
 */
export function PersonaSwitcher({ user }: { user: SessionUser }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border p-2">
      {user.role === "worker" ? <SwitchEmployeeButton /> : null}
      <form action={clearPersona}>
        <button
          type="submit"
          aria-label={`Signed in as ${user.displayName}. Switch persona`}
          className="group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {ROLE_LABEL[user.role]}
            </span>
          </span>
          <ArrowLeftRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
          />
        </button>
      </form>
    </div>
  )
}
