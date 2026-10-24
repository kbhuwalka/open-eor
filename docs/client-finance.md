# Client finance

## 1. Purpose and assumptions

This spec owns what a client sees of its invoices and payments: the Finance page, the invoice drawer, the Pay dialog, the person Payments tab, and the single data seam they read through. Invoice and payment rules (pay calendar, statuses, payment lifecycle, billing run) live in [billing-and-invoicing.md](./billing-and-invoicing.md); this document only says how they are shown and how the seam maps the billing tables onto them.

Assumptions:

- Everything database-shaped sits behind `FinanceDataSource` in `src/server/finance-queries.ts`. The screens were built first against empty results and the `/dev/finance` fixtures; the default `financeQueries` is now wired to the billing tables ([§4](#4-the-data-seam-srcserverfinance-queriests)), so `/client/finance` shows the seeded invoices and payments.
- Money is whole US cents everywhere and is formatted only by `formatCents`. Dates are `YYYY-MM-DD` days or ISO timestamps; the UI prints both through `formatIsoDay` (UTC, always with the year, so server and browser render the same text).
- Only a `client_hr` user sees this area. One saved ACH method per client, read-only in the UI (no add or edit).

## 2. Routes and screens

| Route | Kind | Notes |
| --- | --- | --- |
| `/client/finance` | page | `PageHeader` "Finance", a summary (Due now, and Overdue when there is any), underline `Tabs` (ui-guidelines C13): **Invoices** and **Payments**. Nav item "Finance" in the client sidebar. |
| `/client/finance/invoices/[id]` | page | The full invoice (`InvoiceDocument`, section 2a). Server-rendered inside `Suspense` with a skeleton; another company's id and an unknown id both render the 404 screen. Linked from the drawer ("View full invoice") and from every invoice number on the person Payments tab. |
| `/client/finance/invoices/[id]/pdf` | route handler | Invoice PDF as a private attachment. 401 no session, 403 wrong role, 404 when the invoice is not the client's (the same JSON as for an unknown id), 200 `application/pdf` from `generateInvoicePdf` otherwise. |
| `/client/people/[caseId]` | tab | **Payments** tab (`PersonPaymentsTab`), present only when the person has a deposit invoice. |
| `/dev/finance` | dev page | Every component over fixtures built from the real billing domain; 404 in production. |

Summary (`FinanceSummaryTiles`, one `SummaryCard`; no counts and no hints):

| Figure | Meaning |
| --- | --- |
| Due now | Every payable invoice (status `open` or `overdue`): exactly what "Pay all due" pays. |
| Overdue | The part of Due now whose due date has passed. Shown only when it is above zero, in the danger tone, with a **View** button that opens the Invoices tab filtered to Overdue. |

Payments that are settling are not summarised at the top; they show as **Processing** in the Payments tab. The Invoices tab lists only what is still unpaid.

Invoices tab: **only unpaid invoices** (status `open` or `overdue`). Paid, processing and void invoices are not listed here; paid and processing ones are reached through the Payments tab, and any invoice is still available by its URL.

- F1. Filter bar: search (person name or invoice number, every word must match) and a status select: **All unpaid**, **Due** (open, not yet past due) and **Overdue**. Changing a filter clears the selection, so nothing hidden can be paid. The summary's **View** button on Overdue selects the Overdue filter.
- F2. Table (`InvoiceTable`): checkbox, Invoice (number, kind), Person (name, job title under it), Due, Amount and Status badge (Due or Overdue). There is no service period, pay date or period column: the period is on the drawer and the invoice page. Sortable on Invoice, Person, Due and Amount (none → asc → desc → none, C6); pagination bar above ten rows (C11). Clicking a row opens the drawer.
- F3. Sticky action bar (`InvoicesPanel`), part of the Invoices tab only (the Payments tab has no pay controls), shown while any invoice is payable: the summary ("N selected · $X" or "N invoices due · $X"), **Pay all due** (outline) and **Pay selected (n) · $X** (primary, disabled at zero). Totals are the integer sum of the selected invoices' cents.
- F4. When payment is unavailable (no saved method) every Pay control and checkbox is disabled and the bar says why.
- F5. Empty: no invoices at all: "No invoices yet. Invoices are issued 7 days before each pay date once a person starts." with an outline **Start a hire** button; invoices exist but none is unpaid: "Nothing to pay right now. Invoices you have paid, and payments still processing, are under Payments." No match for the filters: "No unpaid invoices match these filters." and a "Clear filters" link. Loading: `FinanceDashboardSkeleton` mirrors the layout.

Drawer (`InvoiceDrawer`): a quick preview in a right-hand panel opened by a row or by an invoice number in the Payments tab. The header comes from the row at once; the rest loads behind a skeleton through `getInvoiceDetail`. It shows who the invoice is for (name and job title) and the service period (or "Deposit"); there is no start date or terms, issue and due days, the lines grouped as on the page (title and basis, amount), the total and amount due, and the payment history (status, method, started and settled days, failure reason). Lines are never dropped silently: when the detail cannot be loaded the drawer says the invoice total and that its breakdown is missing, with **Try again**. Actions: **Pay $X** (payable), **View full invoice** (the page below) and **Download PDF**.

### 2a. The full invoice (`/client/finance/invoices/[id]`)

`InvoiceDocument` (`src/components/finance/invoice-document.tsx`) renders one `InvoiceDetail` as a document:

- I1. Header: the issuer ("Northwind EOR, Inc." and its address), the title, the number and the status badge; below it the prominent amount: "Amount due" (open, overdue, processing; a note says "Due <day>", "Overdue: was due <day>" or "A payment of $X is processing"), "Amount paid" with "Paid in full on <day>", or "Amount due $0.00" with "Void: <reason>".
- I2. **Bill to** (client legal name and address when stored), **For** (the person's legal name, job title, work state, the last day worked for a terminated person, and "Prorated: 9 of 14 days" for a part period), and the details: issue date, due date, terms ("2 business days before pay date" or "5 business days after the order", read from the pay calendar), service period (or "None (security deposit)"), pay date and tax year.
- I3. Line items grouped Wages, Employer payroll taxes, Benefits, Northwind service fee, or Security deposit. **Every stored line is its own row**: salary, each employer tax by name and rate or basis, benefits, workers' compensation, the EOR fee, one-time fees, and each component of a deposit (one month of each committed quote line, allocated by largest remainder so the rows add up to the deposit exactly; legacy single `DEPOSIT` rows still render). Each line has a title, a basis sentence and the Quantity and Rate columns (below `sm` the basis carries them), the amount, and each group of more than one line a subtotal. The total equals the stored `totalCents`, and the group subtotals add up to it.
- I4. Payments (status, method, started and settled days, the allocated amount, the failure reason), then the notes: the deposit note on a deposit, the void reason on a void invoice. There is no "Please pay $X by <date>" sentence, anywhere; the due date is a header fact and **Pay $X** is on the page only.
- I5. Actions (a slot, hidden when printing): **Download PDF** (the PDF route) and **Pay $X** on a payable invoice, which opens the same `PayDialog` and refreshes the page when paid. A **Back to Finance** link sits above the document.
- I6. Print: the sidebar, header and actions are hidden (`print:` variants on `SidebarShell`), the document has no border or rounding and its sections avoid page breaks.

The words come from `src/lib/invoice-lines.ts`, shared with the drawer and the PDF: `describeInvoiceLine(line)` returns `{ title, basis, quantity, rate }` from the line's `code` and its stored `inputs` (rates, wage bases, days, premiums, deferrals), never from constants, and `groupInvoiceLines`, `prorationNote`, `invoiceVoidReasonLabel` and `invoiceAmountSummary` do the rest. A line whose `inputs` are missing keeps its title and drops the basis. The stored `description` is only the fallback title of an unknown code (the stored salary description carries ISO dates and is not shown).

Data: `src/server/invoice-document.ts` is the one loader behind `getInvoiceDetail` and `getInvoicePdfInput`, so the page and the PDF cannot differ. `loadInvoiceDocument(db, id, scope, now)` joins the invoice to its hire request, case, worker, role and company. `scope.companyId` is the session client's company and is always applied; `null` (every company) is for Finance only, after its own `requireRole("finance")`.

Pay dialog (`PayDialog`): the invoices being paid, the total, the saved method read-only ("ACH ••1234 — Northwind demo bank"), and the timing note: the ACH payment is initiated now and settles after Finance confirms it. **Pay $X** runs `payInvoicesAction`; success replaces the body with "Payment initiated" and the invoices read as Processing; an error stays in the dialog as an alert and nothing changes. Confirm is disabled with no saved method.

Payments tab (`PaymentsTable`): every payment, newest first, with its status (Processing, Settled, Failed): Started, the invoices it covers, method, amount and the status badge (settled day or failure reason underneath). A payment that covers **one** invoice shows its number as a link to the invoice page that opens in a **new tab** (`target="_blank" rel="noopener noreferrer"`), so the table keeps its place. A payment that covers **several** shows a text button "N invoices" instead of a growing row of links; it opens `CoveredInvoicesDialog` (`src/components/finance/covered-invoices-dialog.tsx`, shared with the Finance portal's payments list; this tab adapts its rows with `itemsFromInvoiceRows`), titled with the payment ("Payment of $X", its date and status badge) and listing each covered invoice as one row: invoice number, person (job title beside the name), service period ("Deposit" for a deposit, "Prorated: 9 of 14 days" under a part period) and amount. Each row is a single link opening the invoice page in a new tab (whole row clickable, a normal tab stop with a focus ring); Escape closes the dialog and focus returns to the "N invoices" button. The person and period come from the client's invoice rows (`invoices` prop); a covered invoice that is not among them shows its number only. On a page without an invoice route (`/dev/finance`) the dialog rows are plain text. The table uses the shared pagination bar (`src/components/data-table/pagination`, `src/lib/pagination`: ten rows by default, the bar only above ten payments, a page-size selector; the page is clamped when the list shrinks). The table has no sort or filter, so there is nothing else to reset the page. A failed payment is not a dead end: a failed payment does not reduce what is owed, so its invoices read Due or Overdue again and are back in the Invoices tab (nothing is stored for this, the status is derived), while the failed attempt stays here with its reason. Empty: "No payments yet. When you pay invoices, each payment appears here with its status and the invoices it covers."

Person Payments tab: totals card (Total paid, Outstanding = open, overdue and processing; void counts in neither), then the person's deposit and payroll invoices with the same badges. The Period column uses the list's labels ("Deposit", the range, "Prorated: 9 of 14 days") and each invoice number links to the full invoice in a new tab, and the whole row is a click target for it. The table uses the same pagination bar (above ten invoices); the totals card always counts every invoice. The tab ends at the table: it has no closing paragraph pointing to Finance. It lists invoices, not payments, so the "N invoices" dialog does not apply here. Empty list: "No invoices yet. Invoices are issued 7 days before each pay date once this person starts." The profile adds the tab only when `listPersonInvoices` returns a deposit invoice.

## 3. View models (`src/lib/finance-view.ts`)

Plain serializable types; nothing redeclares billing rules. Statuses, kinds and line codes are the domain's own (`InvoiceDisplayStatus`, `InvoiceKind`, `InvoiceLine`), and the mappers build each view from domain `Invoice` and `Payment` objects.

| Type | Fields |
| --- | --- |
| `InvoiceRow` | `id`, `number`, `personName`, `caseId`, `kind` (`payroll` \| `deposit`), `periodStart`, `periodEnd`, `payDate` (all `null` for a deposit), `issueDate`, `dueDate`, `totalCents`, `displayStatus` (`open` \| `overdue` \| `processing` \| `paid` \| `void`), `paidDate?` (paid only) |
| `InvoiceRow` extras | `personTitle`, `daysEmployed`, `periodDays` (the proration; `null` for a deposit) |
| `InvoiceDetail` | `InvoiceRow` plus `lines` (`code`, `group`, `description`, `amountCents`, `title`, `basis`, `quantity`, `rate`), `groups` (`group`, `label`, `lines`, `subtotalCents`), `issuer` and `client` (`name`, `addressLines`), `person` (`name`, `title`, `workState`, `endDate`, `endKind`), `period` (`start`, `end`, `payDate`, `taxYear`, `daysEmployed`, `periodDays`, `prorationNote`; `null` for a deposit), `voidReason`, `paidCents`, `amountDueCents`, `inProgressCents` and `payments` (`InvoicePaymentEntry`: `paymentId`, `status`, `initiatedAt`, `settledAt`, `failedAt`, `amountCents` = this payment's allocation, `methodLabel`, `failureReason`; `settledAt` is set only for a succeeded payment and `failedAt` only for a failed one) |
| `PaymentRow` | `id`, `initiatedAt`, `settledAt` (null unless settled; a failed payment has none), `status` (`initiated` \| `settled` \| `failed`), `amountCents`, `methodLabel`, `invoices` (`{ id, number }[]`), `failureReason` |
| `SavedPaymentMethodView` | `label` ("ACH ••1234"), `bankName` (the domain `SavedPaymentMethod.label`) |
| `FinanceSummary` | `dueNowCents/Count`, `overdueCents/Count`, `inProgressCents/Count`, `lastPayment` (`{ amountCents, date }` or `null`; not shown in the UI) |
| `PayOutcome` | `{ ok: true, paymentId, invoiceIds, totalCents }` or `{ ok: false, message, code? }`, what the Pay dialog needs back |

- V1. The domain payment status `succeeded` is shown as `settled` (`PAYMENT_VIEW_STATUS`); `initiated` reads "Processing" so payments and invoices use one word.
- V2. Mappers: `toInvoiceRow`, `toInvoiceDetail` (lines in domain order, history newest first), `toPaymentRow`, `toSavedPaymentMethodView`, and `toFinanceSummary(rows, payments)`, which derives every tile from the same rows the tables show so the figures cannot disagree. `invoiceDisplayStatus` is the only status derivation.
- V3. Pure helpers shared by the UI and its tests: `filterInvoiceRows`, `isPayableRow`, `payAllDueIds`, `selectionTotals` (ignores unknown and non-payable ids), `parseInvoiceIds`.

## 4. The data seam (`src/server/finance-queries.ts`)

```ts
export interface FinanceDataSource {
  getClientFinanceSummary(clientId: string): Promise<FinanceSummary>
  listClientInvoices(clientId: string, filters?: InvoiceFilters): Promise<InvoiceRow[]>
  getInvoiceDetail(clientId: string, invoiceId: string): Promise<InvoiceDetail | null>
  listClientPayments(clientId: string): Promise<PaymentRow[]>
  getSavedPaymentMethod(clientId: string): Promise<SavedPaymentMethodView | null>
  listPersonInvoices(clientId: string, caseId: string): Promise<InvoiceRow[]>
  getInvoicePdfInput(clientId: string, invoiceId: string): Promise<InvoicePdfInput | null>
  payInvoices(clientId: string, invoiceIds: readonly string[], actor: FinanceActor): Promise<PayInvoicesResult>
}
// FinanceActor = { userId: string; displayName: string }
// InvoiceFilters = { status?: "all" | "due" | "overdue"; query?: string }  // "due" is open only; the panel lists unpaidInvoiceRows(...) so paid, processing and void never reach the Invoices tab
// PayInvoicesResult =
//   | { ok: true; paymentId: string; invoiceIds: string[]; totalCents: number; initiatedAt: string }
//   | { ok: false; error: PaymentSelectionError | "NO_PAYMENT_METHOD" | "NOT_AVAILABLE"; invoiceIds?: string[] }
export const financeQueries: FinanceDataSource
```

`getInvoicePdfInput` is the eighth method: the PDF generator needs the domain `Invoice`, its `Payment`s, the billed company and the person, which a view model cannot carry.

`financeQueries` is `createFinanceQueries()`: the factory takes injectable `getDb` and `now` (tests pass a temp database and a pinned clock); the default uses the process database and the real clock. How it maps the billing tables (`billing-core.ts` loads, `finance-view.ts` maps):

1. Every read joins `invoices` to the client's company (`invoices.company_id = clientId`), so an unknown, empty or foreign `clientId` reads as nothing. Domain `Invoice` and `Payment` objects come from `invoiceFromRows`, `loadInvoice` and `loadPaymentsForInvoices`; views come from the mappers in section 3. Invoices are newest issue date first, payments newest first, a person's invoices deposit first. Void invoices are listed under All and counted in no tile. The summary derives from the same rows as the table (V2), so Due now, Overdue and Payments in progress always equal the sums of the rows.
2. `payInvoices` resolves the actor to an existing `client_hr` user of that company (anything else is `UNKNOWN_INVOICE`), then calls `initiatePaymentForInvoices` ([billing.ts](../src/server/billing.ts)): one transaction that re-reads the invoices and payments, validates the selection in the domain (`EMPTY_SELECTION`, `UNKNOWN_INVOICE`, `ALREADY_PAID`, `ALREADY_PROCESSING`, ...), uses the company's default saved method (none: `NO_PAYMENT_METHOD`), and inserts the payment and its allocations. A `NotFoundError` for an invoice, which includes another client's, answers `UNKNOWN_INVOICE` without saying whether it exists. The invoices read Processing at once; the Finance portal settles the payment later and they turn Paid.
3. A deposit invoice is also the `pay_deposit` task of the hire's onboarding case. When a payment covers a deposit whose `pay_deposit` task is ready, the seam completes that task with the saved method and the payment id (`completeTaskAsActor`), so paying from Finance and paying from the task are the same act and the case advances to Finance's `confirm_deposit` step. A task that is not ready is left alone.
4. `getInvoicePdfInput` returns `{ invoice, client: { name }, person?: { name, roleTitle }, payments, today, now }` for `generateInvoicePdf`; the person is set for payroll invoices only.

`createFixtureFinanceDataSource` (`src/app/dev/finance/fixtures.ts`) stays the oracle for the same assertions on the fixture data.

## 5. ACL

- A1. A client reads and pays only its own invoices. Every seam method takes `clientId` first, and callers pass `session.clientCompanyId`, never a request value. An implementation MUST scope every query by it.
- A2. An invoice, payment or case of another client is indistinguishable from one that does not exist: `getInvoiceDetail` and `getInvoicePdfInput` return `null`, `listPersonInvoices` returns `[]`, `payInvoices` answers `UNKNOWN_INVOICE` (acl I6). Never `forbidden`.
- A3. `payInvoicesAction` and `getInvoiceDetailAction` call `requireRole("client_hr")` first, take the actor from the session, narrow ids with `parseInvoiceIds` (distinct non-empty strings, 1 to 200) and return `ActionResult`: a refused payment is `code: "validation"` with a user-safe `message` and the machine code in `details.error`. On success they revalidate `/client/finance` and the person pages.
- A4. The PDF route resolves the session before reading input and loads the invoice only through the seam. Client portal pages never link to `/api/documents/*` (acl F6); the PDF route is a different path.

## 6. UI rules for the finance components

`ui-guidelines.md` rule C24 (added there):

> - C24. Finance (`src/components/finance/`): invoice and payment statuses use the §6 status tokens with the S2 badge anatomy, mapped only by `InvoiceStatusBadge` and `PaymentStatusBadge`. Invoice: `open` "Due" → `neutral`, `overdue` "Overdue" → `danger`, `processing` "Processing" → `info`, `paid` "Paid" → `success`, `void` "Void" → `neutral`. Payment: `initiated` "Processing" → `info`, `settled` "Settled" → `success`, `failed` "Failed" → `danger`. Colour never carries the status alone (A3). The summary sits in one `SummaryCard`: Due now always, Overdue only when it is above zero. Each figure is a prominent value (`text-xl font-semibold tabular-nums`) with its label beneath in `text-sm` muted, and no counts or hints; Overdue takes the `danger` foreground and carries a "View" outline button that filters the invoice table. Payments in flight are not summarised there: Processing is a status. The Invoices tab lists unpaid invoices only (Due, Overdue; its filter reads All unpaid / Due / Overdue) with no service-period, pay-date or period column; the Payments tab lists every payment (paginated, C11): a payment with one invoice links its number to the invoice page in a new tab (`target="_blank" rel="noopener noreferrer"`), a payment with several shows a text `Button` "N invoices" that opens a `Dialog` titled with the payment (amount, date, status badge) listing each invoice as one whole-row new-tab link (number, person and title, period, amount); Escape closes it and focus returns to the button. The pay bar belongs to the Invoices tab only. Amounts are right-aligned `tabular-nums` (`MoneyCell`). The pay bar is a bordered `bg-card` strip pinned with `sticky bottom-4`, with no shadow (D3). The invoice drawer is a `Dialog` anchored to the right edge, with a sticky footer for Pay and Download PDF. Row and select-all checkboxes use `ui/checkbox` (added to the C1 allowed set).

Components in `src/components/finance/`:

| Component | Role |
| --- | --- |
| `InvoiceStatusBadge`, `PaymentStatusBadge` | The only status to token mapping |
| `MoneyCell` | Cents as right-aligned tabular dollars |
| `FinanceSummaryTiles`, `FinanceSummarySkeleton` | The summary and its skeleton |
| `InvoiceTable` | Sortable, paginated table with row checkboxes |
| `InvoicesPanel` | Filter bar, table, sticky pay bar, empty states |
| `InvoiceDrawer` | Quick preview drawer with a link to the full invoice |
| `InvoiceDocument`, `InvoiceDocumentSkeleton` | The full invoice (page and, later, Finance) |
| `InvoicePayButton` | Pay on the invoice page: `PayDialog` plus a refresh |
| `PayDialog` | Confirm, success and error states |
| `PaymentsTable` | Payments tab |
| `FinanceDashboard`, `FinanceDashboardSkeleton` | Tiles, tabs, drawer and dialog wired together; takes data and the two server round trips as props |

`/client/finance/finance-client.tsx` binds `payInvoicesAction` and `getInvoiceDetailAction` to `FinanceDashboard`; `/dev/finance` binds fixture-backed functions to the same component.

## 7. Out of scope

Adding, editing or removing a payment method; partial payments; card payments; credit notes; deposit credit or refund; Finance-side confirmation screens (the `finance` portal settles payments, [tasks-and-workflow.md](./tasks-and-workflow.md)); email receipts.

## 8. Verification

Vitest: `src/lib/__tests__/finance-view.test.ts` (status mapping equals `invoiceDisplayStatus`, lines sum to the invoice total, summary figures, selection and Pay-all-due totals, filters and search, id parsing, the detail view model: group subtotals add up, proration text, deposit period label, amount due and void reason), `src/lib/__tests__/invoice-lines.test.ts` (`describeInvoiceLine` for every `INVOICE_LINE_CODES` value, derived from `inputs`: changing an input changes the text, no percentage appears that is not in the inputs, malformed inputs keep the title), `src/components/finance/__tests__/invoice-document.test.tsx` (payroll, prorated, deposit, paid, processing, void and failed-payment documents), `src/server/__tests__/invoice-document.test.ts` (the seeded loader, the page's 404 for another company's invoice, the PDF printing the page's facts with the same total), `src/components/finance/__tests__/finance-components.test.tsx` (badges, selection, disabled states, empty states, filters, pay dialog, drawer, payments table, dashboard flow), `src/app/client/people/[caseId]/__tests__/person-payments-tab.test.tsx`, `src/server/__tests__/finance-queries.test.ts` (the real seam over a seeded temporary database: listing and filters reconcile with `billing-queries`, tiles equal the row sums for paid, processing, open, overdue and void, drawer lines sum to the total, a fixed-term person's invoices sum to the quote's term total, cross-client isolation for every method, `payInvoices` selected and all due, each selection error, `NO_PAYMENT_METHOD`, a failed payment becoming payable again, the deposit task completion, and a real `%PDF-` from the PDF input), `src/server/__tests__/finance-pdf.test.ts`, `src/app/client/finance/__tests__/actions.test.ts` and `src/app/client/finance/invoices/[id]/pdf/__tests__/route.test.ts`.

Playwright: `e2e/invoice-detail.spec.ts` opens the page from the list and the drawer (period, person, grouped lines, total equal to the row, every stored line code as its own row on the page and in the PDF, no Terms, start date or "Please pay", the deposit components, Pay dialog, void, the person Payments tab link, the 404 screen for another company's invoice, print emulation). `e2e/client-finance.spec.ts` drives `/dev/finance`: select, totals, Pay dialog, drawer, the unpaid-only list and filters, empty and loading states. `e2e/client-finance-live.spec.ts` drives the real `/client/finance` against the seeded database (sign-in by sealing the session cookie, `e2e/support/live.ts`): tiles and Pay all due, filters and search, the drawer and a real PDF whose total equals the row, the Payments tab (pagination, the "N invoices" dialog with new-tab rows, Escape and focus return) and the person Payments tab, the PDF route's 401 / 403 / 404, Pay selected (the two invoices leave the Invoices tab and appear as one Processing payment, the tiles move, Pay all due then leaves Nothing to pay), Finance settling the payment (Processing becomes Settled) and Finance failing one (the invoice is back under Invoices and the Failed attempt stays under Payments), the unpaid-only filters, the absence of period columns and the new-tab invoice links. The paying tests delete the payments they made, so the spec reruns on the same database. Run it with `DATABASE_FILE=<copy> PLAYWRIGHT_BASE_URL=<server started with the same DATABASE_FILE> pnpm playwright test e2e/client-finance-live.spec.ts` and never against a database a running server is using for something else.

Fixtures (`src/app/dev/finance/fixtures.ts`) are built with `billingRun`, `initiatePayment`, `settlePayment` and `failPayment`, and are imported only by the dev page and tests, never by a read path.
