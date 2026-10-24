/**
 * View models of the client Home (`/client`, ui-guidelines C28): the three glance cards
 * (Onboarding, At risk, Invoices due) and "To do" (the client's own tasks as jobs, runs of the same
 * job grouped). Pure functions over data the server read model (`src/server/client-home.ts`)
 * loads; wording per task type comes from `src/lib/task-client-copy.ts`. Not owned here: the task
 * rows themselves (`task-inbox-view.ts`), the invoice rows and payability (`finance-view.ts`), and
 * which people are onboarding or at risk (`peopleCounts` beside `listPeople`).
 */
export * from "./cards"
export * from "./invoices"
export * from "./todo"
