"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { StaffDrawerView, StaffInvoiceRow, StaffPaymentRow } from "@/lib/finance-staff-view"
import type { FinancePaymentRecord } from "@/server/finance-lists"

export type RecordLoaders = {
  loadPayment: (paymentId: string) => Promise<FinancePaymentRecord | null>
  loadInvoice: (invoiceId: string) => Promise<StaffInvoiceRow | null>
}

/** A record the drawer asked for: on the page, loaded, still loading, gone, or failed to load. */
export type Lookup<T> = { state: "ready"; value: T } | { state: "loading" } | { state: "missing" } | { state: "error" }

type Loaded<T> = Record<string, { state: "ready"; value: T } | { state: "missing" } | { state: "error" }>

export type FinanceRecords = {
  payment: (id: string) => Lookup<StaffPaymentRow>
  invoice: (id: string) => Lookup<StaffInvoiceRow>
  /** The rows of the invoices a payment covers that are known; the panel shows the rest by number. */
  coveredInvoices: (payment: Pick<StaffPaymentRow, "invoices">) => StaffInvoiceRow[]
  retry: (view: StaffDrawerView) => void
  /** Bumped after every action so open panels remount and reload. */
  version: number
  /** After an action: forget what was loaded (it may have changed) and remount. */
  invalidate: () => void
}

/**
 * The records behind the Finance drawer. The page's own rows (and a deep-linked record the server
 * loaded) always win, so after `router.refresh()` the drawer shows fresh data; anything else the
 * drawer opens (a payment of an invoice, an invoice of a payment on another page) is loaded on
 * demand through `loaders` and kept until the next action.
 */
export function useFinanceRecords({
  view,
  payments,
  invoices,
  loaders,
}: {
  view: StaffDrawerView | null
  payments: readonly StaffPaymentRow[]
  invoices: readonly StaffInvoiceRow[]
  loaders: RecordLoaders
}): FinanceRecords {
  const [loadedPayments, setLoadedPayments] = useState<Loaded<StaffPaymentRow>>({})
  const [loadedInvoices, setLoadedInvoices] = useState<Loaded<StaffInvoiceRow>>({})
  const [version, setVersion] = useState(0)
  const inFlight = useRef(new Set<string>())

  const pagePayment = (id: string) => payments.find((row) => row.id === id)
  const pageInvoice = (id: string) =>
    invoices.find((row) => row.id === id) ??
    Object.values(loadedInvoices).find((entry): entry is { state: "ready"; value: StaffInvoiceRow } => entry.state === "ready" && entry.value.id === id)
      ?.value

  const payment = (id: string): Lookup<StaffPaymentRow> => {
    const row = pagePayment(id)
    if (row) return { state: "ready", value: row }
    return loadedPayments[id] ?? { state: "loading" }
  }
  const invoice = (id: string): Lookup<StaffInvoiceRow> => {
    const row = pageInvoice(id)
    if (row) return { state: "ready", value: row }
    return loadedInvoices[id] ?? { state: "loading" }
  }
  const coveredInvoices = (row: Pick<StaffPaymentRow, "invoices">) =>
    row.invoices.map((ref) => pageInvoice(ref.id)).filter((found): found is StaffInvoiceRow => found !== undefined)

  const wantedKind = view?.kind ?? null
  const wantedId = view?.id ?? null
  const known =
    wantedKind === "payment" ? payment(wantedId as string).state !== "loading" : wantedKind === "invoice" ? invoice(wantedId as string).state !== "loading" : true
  const { loadPayment, loadInvoice } = loaders

  useEffect(() => {
    if (known || wantedKind === null || wantedId === null) return
    const key = `${wantedKind}:${wantedId}:${version}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    const done = () => inFlight.current.delete(key)
    if (wantedKind === "payment") {
      loadPayment(wantedId)
        .then((record) => {
          setLoadedPayments((current) => ({ ...current, [wantedId]: record ? { state: "ready", value: record.payment } : { state: "missing" } }))
          if (record) {
            setLoadedInvoices((current) => {
              const next = { ...current }
              for (const row of record.invoices) next[row.id] = { state: "ready", value: row }
              return next
            })
          }
        })
        .catch(() => setLoadedPayments((current) => ({ ...current, [wantedId]: { state: "error" } })))
        .finally(done)
    } else {
      loadInvoice(wantedId)
        .then((row) => setLoadedInvoices((current) => ({ ...current, [wantedId]: row ? { state: "ready", value: row } : { state: "missing" } })))
        .catch(() => setLoadedInvoices((current) => ({ ...current, [wantedId]: { state: "error" } })))
        .finally(done)
    }
  }, [known, wantedKind, wantedId, version, loadPayment, loadInvoice])

  const retry = useCallback((target: StaffDrawerView) => {
    const drop = <T,>(current: Loaded<T>) => {
      const next = { ...current }
      delete next[target.id]
      return next
    }
    if (target.kind === "payment") setLoadedPayments(drop)
    else setLoadedInvoices(drop)
  }, [])

  const invalidate = useCallback(() => {
    setLoadedPayments({})
    setLoadedInvoices({})
    setVersion((n) => n + 1)
  }, [])

  return { payment, invoice, coveredInvoices, retry, version, invalidate }
}
