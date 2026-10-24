"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import type { ActionResult } from "@/server/action-result"
import type { TaskOutcome } from "@/server/task-actions"

type Run = (input?: unknown) => Promise<ActionResult<TaskOutcome>>

/**
 * Runs a task action (`onComplete` or `onReject` from `TaskScreenProps`) and, on success, sends the
 * person where the action says: the next task for them, else their inbox home, with the notice in
 * the URL. Failures stay on the screen as `error` (the `ActionResult.message`) for the screen to show.
 * Orchestration only: no decisions here (engineering: Layer 3).
 */
export function useTaskOutcome(run: Run | undefined) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(input?: unknown) {
    if (!run) return
    start(async () => {
      const result = await run(input)
      if (result.ok) {
        setError(null)
        router.push(result.data.nextHref)
      } else {
        setError(result.message)
      }
    })
  }

  return { submit, pending, error, clearError: () => setError(null) }
}
