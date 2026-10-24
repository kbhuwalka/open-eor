/**
 * What the client Home's Invoices card stands for: what the client can pay now, minus what "To do"
 * already asks for. Pure: the server passes the client's invoice rows
 * (`financeQueries.listClientInvoices`) and the To do rows; every figure is an integer sum over the
 * same rows, so the total and its overdue part can never disagree.
 */
import { isPayableRow, type InvoiceRow } from "@/lib/finance-view"
import type { TaskInboxRow } from "@/lib/task-inbox-view"
import { clientTodoCopyFor } from "@/lib/task-client-copy"

export type InvoicesToPay = {
  /** How many invoices the total covers; at least 1. */
  count: number
  totalCents: number
  overdueCents: number
  overdueCount: number
}

const sum = (rows: readonly InvoiceRow[]) => rows.reduce((total, row) => total + row.totalCents, 0)

/**
 * The payable invoices (`isPayableRow`) the card totals. An invoice that a To do row pays (the
 * deposit of a case whose `pay_deposit` task is in To do, `paysInvoice` in the client copy) is left
 * out: the Home shows that money once, on its To do row. Null when nothing is left to pay.
 */
export function invoicesToPay(invoices: readonly InvoiceRow[], todo: readonly Pick<TaskInboxRow, "type" | "caseId">[]): InvoicesToPay | null {
  const inTodo = new Set(
    todo.flatMap((row) => {
      const kind = clientTodoCopyFor(row.type)?.paysInvoice
      return kind ? [`${row.caseId}:${kind}`] : []
    }),
  )
  const listed = invoices.filter((row) => isPayableRow(row) && !inTodo.has(`${row.caseId}:${row.kind}`))
  if (listed.length === 0) return null
  const overdue = listed.filter((row) => row.displayStatus === "overdue")
  return {
    count: listed.length,
    totalCents: sum(listed),
    overdueCents: sum(overdue),
    overdueCount: overdue.length,
  }
}
