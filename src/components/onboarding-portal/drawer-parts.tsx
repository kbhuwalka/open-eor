"use client"

import { createContext, useContext, useState, useTransition, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { CircleCheck } from "lucide-react"

import type { ActionResult } from "@/server/action-result"

/** Runs one task action for a drawer panel: `pending` and the failure message for the panel, and `onFinished` once it worked. */
export type DrawerAct = {
  pending: boolean
  error: string | null
  run: (call: () => Promise<ActionResult<unknown>>, done: string) => void
  /** For a panel that ran its own action (the signed I-9): the task is done, move on. */
  finish: (message: string) => void
}

export function useDrawerAct(onFinished: (message: string) => void): DrawerAct {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return {
    pending,
    error,
    finish: onFinished,
    run(call, done) {
      start(async () => {
        const result = await call()
        if (result.ok) {
          setError(null)
          onFinished(done)
        } else {
          setError(result.message)
        }
      })
    },
  }
}

/** The panel's content column, inside the drawer's scrolling area. */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5 px-6 py-6">{children}</div>
}

/**
 * Where the drawer's header keeps the task's actions, so they stay in view while the content scrolls.
 * `undefined` means no drawer around (a panel rendered on its own); `null` is the slot not mounted yet.
 */
export const ActionsSlot = createContext<HTMLElement | null | undefined>(undefined)

/** The task's buttons: in the drawer's sticky header, or inline when there is no drawer. */
export function PanelActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlot)
  if (slot === undefined) return <div className="flex items-center gap-2">{children}</div>
  return slot ? createPortal(children, slot) : null
}

export function PanelError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive" data-testid="action-error">
      {error}
    </p>
  ) : null
}

export function DoneNote({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <p className="flex items-center gap-2 text-sm" data-testid={testId}>
      <CircleCheck aria-hidden className="size-4 shrink-0 text-status-success-foreground" />
      {children}
    </p>
  )
}

/** What a task nobody can act on yet says, in place of an action. */
export function WaitingNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid="task-waiting-note">
      {children}
    </p>
  )
}
