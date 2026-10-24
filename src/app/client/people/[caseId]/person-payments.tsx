"use client"

import type { InvoiceRow, SavedPaymentMethodView } from "@/lib/finance-view"
import { invoiceDrawerHref } from "@/lib/invoice-links"

import { invoicePdfHref, loadInvoiceDetail, payInvoices } from "../../finance/client-bindings"
import { PersonPaymentsTab } from "./person-payments-tab"

/** The person Payments tab bound to the client's finance actions; the page passes the person's invoices and the saved method. */
export function PersonPayments({ invoices, method }: { invoices: readonly InvoiceRow[]; method: SavedPaymentMethodView | null }) {
  return (
    <PersonPaymentsTab
      invoices={invoices}
      method={method}
      loadDetail={loadInvoiceDetail}
      pdfHref={invoicePdfHref}
      invoiceHref={invoiceDrawerHref}
      payInvoices={payInvoices}
    />
  )
}
