import type { ReactNode } from "react"

import type { UserRole } from "@/db"

/** Role tones reuse the status tokens (ui-guidelines §6 S3). */
const AVATAR_TONE: Record<UserRole, string> = {
  client_hr: "bg-status-info text-status-info-foreground",
  worker: "bg-status-success text-status-success-foreground",
  onboarding_specialist: "bg-status-warning text-status-warning-foreground",
  finance: "bg-status-danger text-status-danger-foreground",
}

/**
 * The look of one picker tile: a square role-toned avatar over a name and a subtitle. The caller
 * wraps it in the control (a submit button for a persona, a dialog trigger for Employees) and gives
 * that control the `group` class so the hover treatment applies.
 */
export function PersonaTileFace({
  role,
  title,
  subtitle,
  children,
}: {
  role: UserRole
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <>
      <span
        className={`flex aspect-square w-full max-w-[9rem] items-center justify-center rounded-lg text-3xl font-semibold transition motion-safe:group-hover:scale-[1.03] group-hover:brightness-110 ${AVATAR_TONE[role]}`}
        aria-hidden
      >
        {children}
      </span>
      <span className="text-center">
        <span className="block text-base font-medium text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{subtitle}</span>
      </span>
    </>
  )
}
