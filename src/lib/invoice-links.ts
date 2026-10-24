export const invoiceDrawerHref = (invoiceId: string) => `/client/finance?open=${encodeURIComponent(invoiceId)}`

/** Finance: the Invoices list with the invoice open in the drawer, whatever the filters. */
export const financeInvoiceHref = (invoiceId: string) => `/finance/invoices?open=${encodeURIComponent(invoiceId)}`

/** Finance: the Payments list with the payment open in the drawer, whichever tab lists it. */
export const financePaymentHref = (paymentId: string) => `/finance/payments?open=${encodeURIComponent(paymentId)}`

export const financeInvoicePdfHref = (invoiceId: string) => `/finance/invoices/${encodeURIComponent(invoiceId)}/pdf`
