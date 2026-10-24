"use server"

/**
 * The Server Actions every portal's task screens share (task-inbox.md §5; architecture N2: shared
 * actions live in `src/server`). Each one follows acl §6: identity comes from the session only (R5),
 * the caller supplies a task id and the task's payload, the task page's authorization is re-checked
 * on the server, the engine enforces actors and readiness, and the result is an `ActionResult`
 * (R1) with the next place to send the person.
 */
import { revalidatePath } from "next/cache"

import { requireUser, type SessionUser } from "@/auth"
import { getDb } from "@/db"
import { fail, toActionError, type ActionResult } from "@/server/action-result"
import { completeTaskAsActor, rejectTaskAsActor } from "@/server/tasks"
import { withNotice } from "@/lib/task-notice"
import { portalForRole, portalHomeHref } from "@/lib/task-ui-registry"

import { DEDICATED_COMPLETION_TYPES } from "./dedicated-task-types"
import { nextTaskFor } from "./task-inbox"
import { loadTaskPage } from "./task-page"

/** Where to go after a task is finished, and what to tell the person. */
export type TaskOutcome = {
  /** The next task for this person, else their inbox home; carries `?notice=<taskId>`. */
  nextHref: string
  /** The next task's title, or null when this was the last one. */
  nextTitle: string | null
  message: string
}

function finish(
  user: SessionUser,
  taskId: string,
  doneMessage: (title: string) => string,
): TaskOutcome {
  const db = getDb()
  const now = new Date()
  const portal = portalForRole(user.role)
  const next = nextTaskFor(db, user, taskId, now)
  const title = loadTaskPage(db, user, portal, taskId, now)?.row.title ?? "The task"
  revalidatePath(`/${portal}`, "layout")
  return {
    nextHref: withNotice(next ? next.href : portalHomeHref(portal), taskId),
    nextTitle: next ? next.title : null,
    message: `${doneMessage(title)} ${next ? `Next up: ${next.title}.` : "You're all caught up."}`,
  }
}

/**
 * Completes a task the person may act on. `payload` is the task's own payload (a form's values);
 * the handler validates it. The generic fallback sends the registry's `completeWith`.
 */
export async function completeTaskAction(taskId: string, payload?: unknown): Promise<ActionResult<TaskOutcome>> {
  try {
    const user = await requireUser()
    if (typeof taskId !== "string" || taskId.length === 0) return fail("validation", "Choose a task.")
    const db = getDb()
    const page = loadTaskPage(db, user, portalForRole(user.role), taskId)
    if (!page) return fail("not_found", "That task was not found.")
    if (DEDICATED_COMPLETION_TYPES.has(page.row.type)) {
      return fail("validation", "This step is finished from its own form, where you sign or confirm what you entered.")
    }
    completeTaskAsActor({ db, now: () => new Date() }, { actor: user, taskId, payload: payload ?? {} })
    return { ok: true, data: finish(user, taskId, (title) => `${title} is done.`) }
  } catch (error) {
    return toActionError(error)
  }
}

/** Sends back a rejectable task with a reason (`{ code, note? }`); the engine validates it. */
export async function rejectTaskAction(taskId: string, reason: unknown): Promise<ActionResult<TaskOutcome>> {
  try {
    const user = await requireUser()
    if (typeof taskId !== "string" || taskId.length === 0) return fail("validation", "Choose a task.")
    const db = getDb()
    if (!loadTaskPage(db, user, portalForRole(user.role), taskId)) return fail("not_found", "That task was not found.")
    rejectTaskAsActor({ db, now: () => new Date() }, { actor: user, taskId, reason })
    return { ok: true, data: finish(user, taskId, (title) => `${title} was sent back.`) }
  } catch (error) {
    return toActionError(error)
  }
}
