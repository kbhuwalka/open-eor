"use client"

import { useCallback, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import type { ActionResult } from "@/server/action-result"
import type { TaskOutcome } from "@/server/task-actions"

export type FlowError = {
  message: string
  fields: Record<string, string>
  /** Changes with every failure, so the summary can be re-mounted (and focused) each time. */
  seq: number
  source: "client" | "server"
}

let failures = 0

function toError(result: Extract<ActionResult<unknown>, { ok: false }>): FlowError {
  const fields = result.details?.errors
  return {
    message: result.message,
    fields: typeof fields === "object" && fields !== null ? (fields as Record<string, string>) : {},
    seq: (failures += 1),
    source: "server",
  }
}

/**
 * Runs a task action and, on success, sends the employee to the next task or home. Failures stay on
 * the screen as `error` (the action's message plus any per-field messages) and move focus to the
 * error summary. Orchestration only: every decision is the server's.
 */
export function useTaskFlow() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<FlowError | null>(null)
  const navigating = useRef(false)

  const go = useCallback(
    (outcome: TaskOutcome) => {
      navigating.current = true
      router.push(outcome.nextHref)
    },
    [router],
  )

  /** Fire-and-navigate, for buttons: shows `pending` until the page changes. */
  function run(action: () => Promise<ActionResult<TaskOutcome>>) {
    setError(null)
    start(async () => {
      const result = await action()
      if (result.ok) go(result.data)
      else setError(toError(result))
    })
  }

  /** For dialogs that await the action: throws the message so the dialog shows it and stays open. */
  async function settle(action: () => Promise<ActionResult<TaskOutcome>>): Promise<void> {
    setError(null)
    const result = await action()
    if (!result.ok) {
      const failure = toError(result)
      setError(failure)
      throw new Error(failure.message)
    }
    go(result.data)
  }

  /** A failure found in the browser before anything was sent. */
  function fail(message: string, fields: Record<string, string> = {}) {
    setError({ message, fields, seq: (failures += 1), source: "client" })
  }

  return { run, settle, go, pending, error, fail, clearError: () => setError(null) }
}
