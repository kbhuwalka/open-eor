import { cn } from "cn"

import type { UserRole } from "@/domain/types"
import type { AvatarShape, PersonaTileView } from "@/lib/persona-tiles"

/** The role cue reuses the status tokens (ui-guidelines §6 S3). */
const ROLE_DOT: Record<UserRole, string> = {
  client_hr: "bg-status-info-foreground",
  worker: "bg-status-success-foreground",
  onboarding_specialist: "bg-status-warning-foreground",
  finance: "bg-status-danger-foreground",
}

const AVATAR_SIZE = {
  md: { box: "size-11 text-sm", dot: "size-2.5" },
  sm: { box: "size-8 text-xs", dot: "size-2" },
} as const

/** Neutral initials avatar with a small role-toned dot; square for a company, round for a person. */
export function PersonaAvatar({
  initials,
  shape,
  role,
  size = "md",
}: {
  initials: string
  shape: AvatarShape
  role: UserRole
  size?: keyof typeof AVATAR_SIZE
}) {
  return (
    <span aria-hidden className="relative shrink-0">
      <span
        className={cn(
          "flex items-center justify-center bg-muted font-semibold text-foreground",
          shape === "company" ? "rounded-lg" : "rounded-full",
          AVATAR_SIZE[size].box
        )}
      >
        {initials}
      </span>
      <span
        className={cn(
          "absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-card",
          ROLE_DOT[role],
          AVATAR_SIZE[size].dot
        )}
      />
    </span>
  )
}

/**
 * One picker tile: a bordered card that is a single submit button inside a `<form>` posting to
 * `action` (a bound sign-in Server Action), so it signs in with one click and works without JS.
 */
export function PersonaTile({
  tile,
  action,
  personaId,
}: {
  tile: PersonaTileView
  action: () => Promise<void>
  personaId: string
}) {
  return (
    <form action={action} className="h-full">
      <button
        type="submit"
        data-testid="persona-tile"
        data-persona-id={personaId}
        className="flex h-full w-full cursor-pointer items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors duration-150 ease-out hover:border-ring/60 hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <PersonaAvatar initials={tile.initials} shape={tile.shape} role={tile.role} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">{tile.title}</span>
            {tile.meta ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{tile.meta}</span>
            ) : null}
          </span>
          <span className="block truncate text-sm text-muted-foreground">{tile.subtitle}</span>
        </span>
      </button>
    </form>
  )
}
