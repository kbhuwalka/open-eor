/** Where the pay components link. The employee portal uses the defaults; the dev review page overrides them. */
export type PayHrefs = {
  slip: (payslipId: string) => string
  pdf: (payslipId: string) => string
  /** Back link of the detail view. */
  list: string
}

export const WORKER_PAY_HREFS: PayHrefs = {
  slip: (id) => `/worker/pay/${encodeURIComponent(id)}`,
  pdf: (id) => `/worker/pay/${encodeURIComponent(id)}/pdf`,
  list: "/worker/pay",
}
