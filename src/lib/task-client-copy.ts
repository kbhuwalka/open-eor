/**
 * The client Home's wording per task type (ui-guidelines C28), the sibling of `TASK_UI_REGISTRY`:
 * together they are the only places that name a task type. The registry decides where a task is
 * done; this module decides how the client Home's To do talks about it: the client's own tasks as
 * jobs ("Pay the deposit for Maya Chen", why it matters, the button), and the wording of a group
 * of the same job for several people ("Pay deposits", one why line for all of them).
 *
 * Every phrase is fixed text plus the person's name from the database; nothing is built from URL
 * data and nothing quotes a task's stored context beyond an amount. A type without an entry keeps
 * the template's wording, never a raw key, and is never grouped.
 */
import type { InvoiceKind } from "@/domain/billing/types"

import { formatCents } from "./format"
import type { TaskUiSubject } from "./task-ui-registry"

/** The person a task is about, as the copy names them. */
export type PersonNames = { name: string; firstName: string }

export function personNames(name: string): PersonNames {
  const trimmed = name.trim()
  return { name: trimmed, firstName: trimmed.split(/\s+/)[0] ?? trimmed }
}

export type ClientTodoCopy = {
  /** Verb first, naming the thing (and the person when the job is about one): "Pay the deposit for Maya Chen". */
  title(person: PersonNames): string
  /** One sentence on what it unblocks: "Maya's start date can't be confirmed until this is paid." */
  why(person: PersonNames): string
  /** The row's button: "Pay $4,200.00". */
  action(task: Pick<TaskUiSubject, "context">): string
  /**
   * The task is done by paying the case's invoice of this kind: the Home shows it once, as the to-do
   * row, and leaves that invoice out of the "Invoices due" card.
   */
  paysInvoice?: InvoiceKind
  /**
   * Consecutive To do rows of this type under one header: its title ("Pay deposits") and the why
   * line said once for every person in it ("Start dates can't be confirmed until these are paid.").
   */
  group: { title: string; why: string }
}

function amountOf(task: Pick<TaskUiSubject, "context">): number | null {
  const amount = task.context.amountCents
  return typeof amount === "number" ? amount : null
}

export const CLIENT_TODO_COPY = {
  accept_agreement: {
    title: () => "Sign the services agreement",
    why: (person) => `Northwind can't start ${person.firstName}'s onboarding until it is signed.`,
    action: () => "Review and sign",
    group: { title: "Sign the services agreement", why: "Northwind can't start these onboardings until it is signed." },
  },
  pay_deposit: {
    title: (person) => `Pay the deposit for ${person.name}`,
    why: (person) => `${person.firstName}'s start date can't be confirmed until this is paid.`,
    action: (task) => {
      const amount = amountOf(task)
      return amount === null ? "Pay deposit" : `Pay ${formatCents(amount)}`
    },
    paysInvoice: "deposit",
    group: { title: "Pay deposits", why: "Start dates can't be confirmed until these are paid." },
  },
} as const satisfies Record<string, ClientTodoCopy>

export function clientTodoCopyFor(type: string): ClientTodoCopy | null {
  return Object.hasOwn(CLIENT_TODO_COPY, type) ? CLIENT_TODO_COPY[type as keyof typeof CLIENT_TODO_COPY] : null
}
