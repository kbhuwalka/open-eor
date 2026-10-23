import type { SessionUser } from "@/auth"
import { PersonaSwitcher } from "@/components/persona-switcher"

type PortalShellProps = {
  title: string
  user: SessionUser
  children?: React.ReactNode
}

/** Minimal portal chrome shared by role shells (not a design pass). */
export function PortalShell({ title, user, children }: PortalShellProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-sm text-muted-foreground">Northwind EOR</p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {user.displayName}{" "}
            <span className="font-mono text-xs">({user.role})</span>
          </p>
        </div>
        <PersonaSwitcher />
      </header>
      {children}
    </div>
  )
}
