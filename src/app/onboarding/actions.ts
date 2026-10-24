"use server"

/**
 * The onboarding specialist's own Server Actions (onboarding-portal.md §3). Approving an order,
 * setting up payroll and the filings use the shared `completeTaskAction`, and sending the I-9
 * documents back uses the shared `rejectTaskAction`; only signing Section 2 needs more than a payload,
 * so only it lives here. Identity comes from the session (R5); the service re-checks the role, the
 * task, its type and its readiness, and never accepts a signature rectangle from the caller.
 */
import { revalidatePath } from "next/cache"

import { requireRole, type SessionUser } from "@/auth"
import { getDb } from "@/db"
import type { SignatureField } from "@/domain/forms"
import { fail, toActionError, type ActionResult } from "@/server/action-result"
import { DocumentInputError, SignatureError } from "@/server/documents"
import {
  I9InputError,
  acceptSection2,
  prepareSection2,
  type FieldValuesInput,
  type SignatureInput,
} from "@/server/onboarding-portal/i9-review"
import { loadDrawerTask, type DrawerTask } from "@/server/onboarding-portal/drawer"
import { nextTaskFor } from "@/server/task-inbox"
import type { TaskOutcome } from "@/server/task-actions"
import { withNotice } from "@/lib/task-notice"

const deps = () => ({ db: getDb(), now: () => new Date() })

export type PreparedSection2Data = {
  pdf: string
  fields: SignatureField[]
  title: string
  signer: { name: string; role: "Employer representative" }
}

export type SignedSection2Input = { signature: SignatureInput; fieldValues: FieldValuesInput }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function failure(error: unknown): ActionResult<never> {
  if (error instanceof I9InputError) {
    return fail("validation", error.message, Object.keys(error.errors).length > 0 ? { errors: error.errors } : undefined)
  }
  if (error instanceof SignatureError || error instanceof DocumentInputError) return fail("validation", error.message)
  return toActionError(error)
}

async function run<T>(work: (user: SessionUser) => Promise<T> | T): Promise<ActionResult<T>> {
  try {
    const user = await requireRole("onboarding_specialist")
    return { ok: true, data: await work(user) }
  } catch (error) {
    return failure(error)
  }
}

/** Section 2 filled from the employee's entries, unsigned, for the specialist to sign. */
export async function prepareSection2Action(taskId: string): Promise<ActionResult<PreparedSection2Data>> {
  if (typeof taskId !== "string" || taskId.length === 0) return fail("validation", "Choose a task.")
  return run(async (user) => {
    const prepared = await prepareSection2(deps(), user, { taskId })
    return { pdf: Buffer.from(prepared.pdf).toString("base64"), fields: prepared.fields, title: prepared.title, signer: prepared.signer }
  })
}

/**
 * Signs Section 2 as the employer representative, stores it and completes the verification task.
 * Takes no document fields: the server fills them from what the employee entered.
 */
export async function acceptSection2Action(taskId: string, input: SignedSection2Input): Promise<ActionResult<TaskOutcome>> {
  if (typeof taskId !== "string" || taskId.length === 0) return fail("validation", "Choose a task.")
  if (!isRecord(input) || !isRecord(input.signature) || !isRecord(input.fieldValues)) {
    return fail("validation", "Sign the document where it is marked before finishing.")
  }
  const { typedName, consentedAt } = input.signature
  if (typeof typedName !== "string" || typeof consentedAt !== "string" || !typedName.trim()) {
    return fail("validation", "Sign the document where it is marked before finishing.")
  }
  return run(async (user) => {
    await acceptSection2(deps(), user, {
      taskId,
      signature: { typedName, consentedAt },
      fieldValues: input.fieldValues,
    })
    const next = nextTaskFor(getDb(), user, taskId, new Date())
    revalidatePath("/onboarding", "layout")
    return {
      nextHref: withNotice(next ? next.href : "/onboarding", taskId),
      nextTitle: next ? next.title : null,
      message: `Section 2 is signed and the documents are verified. ${next ? `Next up: ${next.title}.` : "You're all caught up."}`,
    }
  })
}

/** Everything the home's drawer shows for one task, for the signed-in specialist; another viewer's task is "not found". */
export async function loadTaskDrawerAction(taskId: string): Promise<ActionResult<DrawerTask>> {
  if (typeof taskId !== "string" || taskId.length === 0) return fail("validation", "Choose a task.")
  try {
    const user = await requireRole("onboarding_specialist")
    const data = loadDrawerTask(getDb(), user, taskId, new Date())
    return data ? { ok: true, data } : fail("not_found", "That task was not found.")
  } catch (error) {
    return failure(error)
  }
}
