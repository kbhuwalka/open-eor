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
| `/client/finance` | page | `PageHeader` "Finance", a summary (Due now, and Overdue when there is any), underline `Tabs` (ui-guidelines C13): **Invoices** and **Payments**, and the Finance drawer (section 2a). Nav item "Finance" in the client sidebar. |
| `/client/finance?open=<invoiceId>` | deep link | Opens that invoice in the drawer on load, whatever its status (section 2a). Built only by `invoiceDrawerHref` (`src/lib/invoice-links.ts`), the one way the client app links to an invoice. An id that is not one of the client's invoices opens nothing and the page renders as usual; closing the drawer drops `?open=` with `router.replace`. There is no invoice page. |
| `/client/finance/invoices/[id]/pdf` | route handler | Invoice PDF as a private attachment. 401 no session, 403 wrong role, 404 when the invoice is not the client's (the same JSON as for an unknown id), 200 `application/pdf` from `generateInvoicePdf` otherwise. |
| `/client/people/[caseId]` | tab | **Payments** tab (`PersonPaymentsTab`), present only when the person has a deposit invoice. |
| `/dev/finance` | dev page | Every component over fixtures built from the real billing domain; 404 in production. |

Summary (`FinanceSummaryTiles`, one `SummaryCard`; no counts and no hints):

| Figure | Meaning |
| --- | --- |
| Due now | Every payable invoice (status `open` or `overdue`): exactly what "Pay all due" pays. |
| Overdue | The part of Due now whose due date has passed. Shown only when it is above zero, in the danger tone, with a **View** button that opens the Invoices tab filtered to Overdue. |

Payments that are settling are not summarised at the top; they show as **Processing** in the Payments tab. The Invoices tab lists only what is still unpaid.

Invoices tab: **only unpaid invoices** (status `open` or `overdue`). Paid, processing and void invoices are not listed here; paid and processing ones are reached through the Payments tab, and any invoice opens in the drawer from its link (`/client/finance?open=<invoiceId>`).

- F1. Filter bar: search (person name or invoice number, every word must match) and a status select: **All unpaid**, **Due** (open, not yet past due) and **Overdue**. Changing a filter clears the selection, so nothing hidden can be paid. The summary's **View** button on Overdue selects the Overdue filter.
- F2. Table (`InvoiceTable`): checkbox, Invoice (number, kind), Person (name, job title under it), Due, Amount and Status badge (Due or Overdue). There is no service period, pay date or period column: the period is in the drawer. Sortable on Invoice, Person, Due and Amount (none → asc → desc → none, C6); pagination bar above ten rows (C11). Clicking a row opens the drawer, whose Previous and Next walk the filtered rows in their current sort, across pages.
- F3. Sticky action bar (`InvoicesPanel`), part of the Invoices tab only (the Payments tab has no pay controls), shown while any invoice is payable: the summary ("N selected · $X" or "N invoices due · $X"), **Pay all due** (outline) and **Pay selected (n) · $X** (primary, disabled at zero). Totals are the integer sum of the selected invoices' cents.
- F4. When payment is unavailable (no saved method) every Pay control and checkbox is disabled and the bar says why.
- F5. Empty: no invoices at all: "No invoices yet. Invoices are issued 7 days before each pay date once a person starts." with an outline **Start a hire** button; invoices exist but none is unpaid: "Nothing to pay right now. Invoices you have paid, and payments still processing, are under Payments." No match for the filters: "No unpaid invoices match these filters." and a "Clear filters" link. Loading: `FinanceDashboardSkeleton` mirrors the layout.

Pay dialog (`PayDialog`): the invoices being paid, the total, the saved method read-only ("ACH ••1234 — Northwind demo bank"), and the timing note: the ACH payment is initiated now and settles after Finance confirms it. **Pay $X** runs `payInvoicesAction`; success replaces the body with "Payment initiated" and the invoices read as Processing; an error stays in the dialog as an alert and nothing changes. Confirm is disabled with no saved method; while the payment starts, both buttons are disabled. Its footer follows ui-guidelines C46.

Payments tab (`PaymentsList`, grouping in `src/lib/payment-sections.ts`): every payment, in the specialist Home's dense list look (ui-guidelines C43): sections with a toggle header and a count, 40px rows with only a bottom border, no box and no column headers.

- F6. Sections, in this order: **In progress** (payments still `initiated`), **Failed** (failed payments whose money is still owed: at least one invoice they covered is Due or Overdue again), then **one section per month** ("October 2026", newest first, by the America/New_York day the payment started) for settled payments and failures whose invoices were paid since (still marked Failed). Empty sections are left out. The newest two months start open; older months start collapsed, their count showing.
- F7. A row: the amount (`tabular-nums`, right-aligned in a fixed column) and what it covered (the invoice number, or "N invoices") on the left, the method and start day muted (hidden below `sm`), the payment status badge on the right. The whole row is one button that opens the payment drawer; `j`/`k` (or the arrow keys) move a cursor through the open sections and Enter opens it. There is no pagination: the sections are the paging.
- F8. A failed payment is not a dead end: a failed payment does not reduce what is owed, so its invoices read Due or Overdue again and are back in the Invoices tab (nothing is stored for this, the status is derived), while the failed attempt stays here, first under Failed, with its reason in the drawer.
- F9. Empty: "No payments yet. When you pay invoices, each payment appears here with its status and the invoices it covers."

Person Payments tab (`PersonPaymentsTab`, bound to the server actions by `person-payments.tsx`): totals card (Total paid, Outstanding = open, overdue and processing; void counts in neither), then the person's deposit and payroll invoices as dense 40px rows like the Payments tab: invoice number and period ("Deposit", the range, "· Prorated: 9 of 14 days") on the left, the amount, then the status badge. A row is a link to `invoiceDrawerHref(id)`: a plain click opens the same invoice drawer in place (Previous and Next walk this person's invoices, Pay opens the shared `PayDialog`), and a cmd, ctrl or middle click opens the invoice on the Finance page in a new tab. `j`/`k` and Enter work as on the Payments tab. The list uses the shared pagination bar above ten invoices; the totals card always counts every invoice. The tab ends at the list: it has no closing paragraph pointing to Finance. Empty list: "No invoices yet. Invoices are issued 7 days before each pay date once this person starts." The profile adds the tab only when `listPersonInvoices` returns a deposit invoice.

### 2a. The Finance drawer

One right-hand drawer (`FinanceDrawer` over the shared `DrawerShell`, ui-guidelines C45) shows an invoice or a payment. It never stacks: opening a covered invoice from a payment swaps the content and a **Back** button ("‹ Payment of $X") returns to the payment. What it shows is a view of ids (`src/lib/finance-drawer.ts`): the shown id, the ids of the list it was opened from (for "N of M" with Previous and Next, hidden for a list of one), and for an invoice opened from a payment, that payment. Rows are resolved from the page's data on every render. Escape, the corner X and a click outside close it; there is no footer and no Close button.

Invoice (`InvoicePanel`, `InvoiceDrawer` when used alone):

- D1. Header (fixed): the number and the status badge, "Payroll invoice" or "Deposit invoice" under it; then the actions on one row, primary first: **Pay $X** (only while the invoice is payable and the viewer can pay: hidden, not disabled, otherwise) and **Download PDF** as an outline icon button with a tooltip and `aria-label` (the PDF route, `download`). Overdue is said once, by the header badge.
- D2. Facts, one compact two-column block: For (name · job title), Service period (or "Deposit", with the proration note under it), Pay date (payroll), Due, Paid (when paid) and Void (the reason, when void). There is no start date, issue date or terms.
- D3. Line items, flat and dense: each group (Wages, Employer payroll taxes, Benefits, Northwind service fee, Security deposit) is a small muted subhead with its subtotal on the right when the group has more than one line and is not the invoice's only group (a deposit's would repeat the total), then one row per stored line (title, the basis muted under it, the amount). No nested cards and no tinted bars. They end in Total, and Amount due unless paid ("Amount due (void)" on a void invoice).
- D4. Payment history (status, method, started and settled days, failure reason, amount), only when the invoice has payments.
- D5. The header comes from the row at once; the facts' person comes from the detail once loaded; the lines load behind a skeleton through `getInvoiceDetail`. Lines are never dropped silently: when the detail cannot be loaded (null or an error) a destructive alert says the invoice total and that its breakdown is missing, that nothing has been changed, with **Try again**.
- D6. **Pay $X** closes the drawer and opens `PayDialog` for that invoice.

Payment (`PaymentPanel`):

- D7. Header: "Payment of $X" and the payment status badge, "Covers INV-…" or "Covers N invoices" under it. No actions (a payment has nothing to do).
- D8. Facts: Method, Started, Settled (when settled), Reason (when failed). Then one muted line on what happens next: in progress, the ACH payment settles once Northwind confirms the funds; failed and still owed, its invoices are due again under Invoices; failed and paid since, nothing was paid by this attempt.
- D9. The invoices it covers as rows (number, person · period, amount, status). A row opens that invoice in the drawer (Previous and Next then walk the payment's invoices; Back returns to the payment); on `/client/finance` it is also a link to `invoiceDrawerHref`, so a cmd-click opens it in a new tab. A covered invoice that is not among the client's rows shows its number only.
- D10. A payment row opens the payment drawer even when the payment covers one invoice: the status, method and failure reason belong to the payment, and an invoice can have several payments (a failed attempt, then the one that settled). Previous and Next walk the Payments tab in its section order, collapsed sections included.

Deep link (`?open=<invoiceId>`): the page reads `searchParams` inside `Suspense` and passes `parseOpenParam(open)` (the first value; empty or over 200 characters is ignored) to the dashboard. `linkedInvoiceView` opens it only when it is one of the client's invoice rows (the seam lists every client invoice, whatever its status); an unpaid one steps through the unpaid list, any other opens on its own, and the tab behind it is the one that lists it (`tabForInvoice`: Payments for a paid or processing invoice). A new `?open=` while the page is open opens that invoice (the specialist Home's `seenTask` pattern); closing a drawer a link opened calls `router.replace("/client/finance", { scroll: false })`.

The words come from `src/lib/invoice-lines.ts`, shared by the drawer, `InvoiceDocument` and the PDF: `describeInvoiceLine(line)` returns `{ title, basis, quantity, rate }` from the line's `code` and its stored `inputs` (rates, wage bases, days, premiums, deferrals), never from constants, and `groupInvoiceLines`, `prorationNote`, `invoiceVoidReasonLabel` and `invoiceAmountSummary` do the rest. A line whose `inputs` are missing keeps its title and drops the basis. The stored `description` is only the fallback title of an unknown code (the stored salary description carries ISO dates and is not shown).

Data: `src/server/invoice-document.ts` is the one loader behind `getInvoiceDetail` and `getInvoicePdfInput`, so the drawer and the PDF cannot differ. `loadInvoiceDocument(db, id, scope, now)` joins the invoice to its hire request, case, worker, role and company. `scope.companyId` is the session client's company and is always applied; `null` (every company) is for Finance only, after its own `requireRole("finance")`.

### 2b. The invoice document and the PDF

The PDF (`/client/finance/invoices/[id]/pdf`, `src/server/documents/invoice-pdf.ts`) and `InvoiceDocument` (`src/components/finance/invoice-document.tsx`, the same sections on screen; no client route renders it since the invoice page was replaced by the drawer) print one `InvoiceDetail` as a document:

- I1. Header: the issuer ("Northwind EOR, Inc." and its address), the title, the number and the status badge; below it the prominent amount: "Amount due" (open, overdue, processing; a note says "Due <day>", "Overdue: was due <day>" or "A payment of $X is processing"), "Amount paid" with "Paid in full on <day>", or "Amount due $0.00" with "Void: <reason>".
- I2. **Bill to** (client legal name and address when stored), **For** (the person's legal name, job title, work state, the last day worked for a terminated person, and "Prorated: 9 of 14 days" for a part period), and the details: issue date, due date, terms ("2 business days before pay date" or "5 business days after the order", read from the pay calendar), service period (or "None (security deposit)"), pay date and tax year.
- I3. Line items grouped Wages, Employer payroll taxes, Benefits, Northwind service fee, or Security deposit. **Every stored line is its own row**: salary, each employer tax by name and rate or basis, benefits, workers' compensation, the EOR fee, one-time fees, and each component of a deposit (one month of each committed quote line, allocated by largest remainder so the rows add up to the deposit exactly; legacy single `DEPOSIT` rows still render). Each line has a title, a basis sentence and the Quantity and Rate columns (below `sm` the basis carries them), the amount, and each group of more than one line a subtotal. The total equals the stored `totalCents`, and the group subtotals add up to it.
- I4. Payments (status, method, started and settled days, the allocated amount, the failure reason), then the notes: the deposit note on a deposit, the void reason on a void invoice. There is no "Please pay $X by <date>" sentence, anywhere; the due date is a header fact.

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
- A3. `payInvoicesAction` and `getInvoiceDetailAction` call `requireRole("client_hr")` first, take the actor from the session, narrow ids with `parseInvoiceIds` (distinct non-empty strings, 1 to 200) and return `ActionResult`: a refused payment is `code: "validation"` with a user-safe `message` and the machine code in `details.error`. On success they revalidate `/client/finance`, the client Home (`/client`) and the person pages.
- A4. The PDF route resolves the session before reading input and loads the invoice only through the seam. Client portal pages never link to `/api/documents/*` (acl F6); the PDF route is a different path.

## 6. UI rules for the finance components

`ui-guidelines.md` rule C24 (added there):

> - C24. Finance (`src/components/finance/`): invoice and payment statuses use the §6 status tokens with the S2 badge anatomy, mapped only by `InvoiceStatusBadge` and `PaymentStatusBadge`. Invoice: `open` "Due" → `neutral`, `overdue` "Overdue" → `danger`, `processing` "Processing" → `info`, `paid` "Paid" → `success`, `void` "Void" → `neutral`. Payment: `initiated` "Processing" → `info`, `settled` "Settled" → `success`, `failed` "Failed" → `danger`. Colour never carries the status alone (A3). The summary sits in one `SummaryCard`: Due now always, Overdue only when it is above zero. Each figure is a prominent value (`text-xl font-semibold tabular-nums`) with its label beneath in `text-sm` muted, and no counts or hints; Overdue takes the `danger` foreground and carries a "View" outline button that filters the invoice table. Payments in flight are not summarised there: Processing is a status. The Invoices tab lists unpaid invoices only (Due, Overdue; its filter reads All unpaid / Due / Overdue) with no service-period, pay-date or period column; the Payments tab is the C43 dense list in sections (In progress, Failed while its money is still owed, then one per month, newest first; months after the newest two start collapsed), one 40px row per payment with no column headers: the amount and what it covered (the number, or "N invoices") on the left, the method and start day muted, the status badge on the right; the whole row opens the payment drawer. The person Payments tab uses the same rows for the person's invoices, each opening the invoice drawer. The pay bar belongs to the Invoices tab only. Amounts are right-aligned `tabular-nums` (`MoneyCell`). The pay bar is a bordered `bg-card` strip pinned with `sticky bottom-4`, with no shadow (D3). The invoice and payment drawers are one `FinanceDrawer` on C45: header Pay $X (payable and payable by this viewer only) then the Download PDF icon; a payment's covered invoices are rows that swap the drawer to that invoice, with Back to the payment. Row and select-all checkboxes use `ui/checkbox` (added to the C1 allowed set).

Components in `src/components/finance/`:

| Component | Role |
| --- | --- |
| `InvoiceStatusBadge`, `PaymentStatusBadge` | The only status to token mapping |
| `MoneyCell` | Cents as right-aligned tabular dollars |
| `FinanceSummaryTiles`, `FinanceSummarySkeleton` | The summary and its skeleton |
| `InvoiceTable` | Sortable, paginated table with row checkboxes |
| `InvoicesPanel` | Filter bar, table, sticky pay bar, empty states |
| `InvoicePanel`, `InvoiceDrawer` | One invoice on the drawer shell (section 2a); `InvoiceDrawer` is the panel in its own drawer (person Payments tab) |
| `PaymentPanel` | One payment on the drawer shell, its covered invoices as rows |
| `FinanceDrawer` | The Finance page's one drawer: resolves a `FinanceDrawerView` to an invoice or payment panel, stepper and Back |
| `InvoiceDocument`, `InvoiceDocumentSkeleton` | The invoice as a document, the on-screen twin of the PDF; no client route renders it |
| `PayDialog` | Confirm, success and error states |
| `PaymentsList` | Payments tab: sections and dense rows |
| `FinanceDashboard`, `FinanceDashboardSkeleton` | Tiles, tabs, drawer and dialog wired together; takes data, the two server round trips and the deep link as props |

The shared pieces they build on: `DrawerShell` and its parts (`src/components/drawer/drawer-shell.tsx`, ui-guidelines C45) and the dense list pieces (`src/components/dense-list.tsx`). The pure logic: `src/lib/finance-drawer.ts` (views, stepping, the deep link), `src/lib/payment-sections.ts` (grouping), `src/lib/list-navigation.ts` (position, step, cursor), `src/lib/invoice-links.ts` (`invoiceDrawerHref`).

`/client/finance/finance-client.tsx` binds `payInvoicesAction` and `getInvoiceDetailAction` (through `client-bindings.ts`, shared with the person page's `person-payments.tsx`) and `invoiceDrawerHref` to `FinanceDashboard`; the client Home's Invoices due card ([task-inbox.md](./task-inbox.md) §8) only links here (`CLIENT_FINANCE_PATH`), so every client payment starts on this page or on the person page; `/dev/finance` binds fixture-backed functions to the same component.

## 7. Out of scope

Adding, editing or removing a payment method; partial payments; card payments; credit notes; deposit credit or refund; Finance-side confirmation screens (the `finance` portal settles payments, [tasks-and-workflow.md](./tasks-and-workflow.md)); email receipts.

## 8. Verification

Vitest: `src/lib/__tests__/finance-view.test.ts` (status mapping equals `invoiceDisplayStatus`, lines sum to the invoice total, summary figures, selection and Pay-all-due totals, filters and search, id parsing, the detail view model: group subtotals add up, proration text, deposit period label, amount due and void reason), `src/lib/__tests__/invoice-lines.test.ts` (`describeInvoiceLine` for every `INVOICE_LINE_CODES` value, derived from `inputs`: changing an input changes the text, no percentage appears that is not in the inputs, malformed inputs keep the title), `src/lib/__tests__/finance-drawer.test.ts` (stepping and position, a payment's covered invoice and Back, `parseOpenParam`, the deep link for unpaid, paid, processing, void, foreign and unknown ids and the tab behind it), `src/lib/__tests__/payment-sections.test.ts` (section order and keys, a failure still owed versus paid since, the business-day month, which months start collapsed, the cover label), `src/lib/__tests__/list-navigation.test.ts`, `src/lib/__tests__/finance-format.test.ts` (days and months in America/New_York), `src/components/drawer/__tests__/drawer-shell.test.tsx` (name and description, fixed header outside the scrolling body, actions in order, the corner X as the only Close, Escape, no focus ring on open, stepper ends, Back, the icon action's name and tooltip, the load error alert), `src/components/__tests__/dense-list.test.tsx` (section toggle, a link row opening in place on a plain click and not on a modified one, `j`/`k`/Enter, fields and modifiers left alone), `src/components/finance/__tests__/invoice-document.test.tsx` (payroll, prorated, deposit, paid, processing, void and failed-payment documents), `src/server/__tests__/invoice-document.test.ts` (the seeded loader and the PDF printing the document's facts with the same total), `src/components/finance/__tests__/finance-components.test.tsx` (badges, selection, disabled states, empty states, filters, pay dialog; the invoice drawer: skeleton then facts and lines, kind subtitle, Pay first and the Download PDF icon link as the only actions, Pay hidden when not payable or no method, no Close button or full-invoice link, history hidden without payments, Overdue only in the header, subtotals, void, stepper, failed and rejected loads with Try again; the Payments list: sections, collapsed months, a failure paid since, row content, open order, keyboard; the payment drawer: facts, notes, stepper, swap to a covered invoice and Back, links, an unknown covered invoice; the dashboard: tabs, a failed payment, View overdue, empty states, paying, the drawer's stepper and Pay, and deep links: unpaid over Invoices, paid over Payments, a foreign id opens nothing, closing drops the link, a new link while open), `src/app/client/people/[caseId]/__tests__/person-payments-tab.test.tsx` (rows, periods, the `invoiceDrawerHref` links, the drawer and its stepper, `j` and Enter, Pay through the shared dialog, no Pay without a method, totals, pagination), `src/server/__tests__/finance-queries.test.ts` (the real seam over a seeded temporary database: listing and filters reconcile with `billing-queries`, tiles equal the row sums for paid, processing, open, overdue and void, drawer lines sum to the total, a fixed-term person's invoices sum to the quote's term total, cross-client isolation for every method, `payInvoices` selected and all due, each selection error, `NO_PAYMENT_METHOD`, a failed payment becoming payable again, the deposit task completion, and a real `%PDF-` from the PDF input), `src/server/__tests__/finance-pdf.test.ts`, `src/app/client/finance/__tests__/actions.test.ts` and `src/app/client/finance/invoices/[id]/pdf/__tests__/route.test.ts`.

Playwright: `e2e/invoice-detail.spec.ts` drives the invoice drawer on the real page: from the list (person, period, grouped lines, total equal to the row, Pay first then the Download PDF icon, one Close, every line title and amount in the PDF, Escape back to `/client/finance`), deep links to a paid payroll invoice (every stored line code as its own row, no amount due, its settled payment, no Pay or stepper, the Payments tab behind it), a deposit (one subhead, no repeated subtotal, its components in the PDF), an overdue invoice (Overdue only in the header, the stepper, Pay into the dialog without paying), a void invoice (Acme's: the reason and "Amount due (void)"), the person Payments tab (rows link to `?open=`, open the drawer in place with the stepper, the link opens it on Finance), another company's id and an unknown id opening nothing while the owner's opens, and the old invoice page answering 404 while its PDF route stays. `e2e/client-finance.spec.ts` drives `/dev/finance` (dev server only; the page is a 404 in production): select, totals, Pay dialog, the drawer and its stepper, the unpaid-only list and filters, empty and loading states. `e2e/client-finance-live.spec.ts` drives the real `/client/finance` against the seeded database (sign-in by sealing the session cookie, `e2e/support/live.ts`): tiles and Pay all due, filters and search, the drawer and a real PDF whose total equals the row, the Payments sections (In progress and Failed first, months newest first, older months collapsed, 40px rows, counts adding up to every payment), the payment drawer (facts, covered invoices adding up to the payment, cmd-click to a new tab on `?open=`, swapping to an invoice and Back, Next payment), the keyboard, the person Payments tab, the PDF route's 401 / 403 / 404, Pay selected (the two invoices leave the Invoices tab and appear as one Processing payment under In progress, its drawer listing both, the tiles move, Pay all due then leaves Nothing to pay), Finance settling the payment (Processing becomes Settled) and Finance failing one (the invoice is back under Invoices; the attempt sits under Failed with its reason in the drawer, and its invoice opens from there with Pay). The paying tests delete the payments they made, so the spec reruns on the same database. Run it with `DATABASE_FILE=<copy> PLAYWRIGHT_BASE_URL=<server started with the same DATABASE_FILE> pnpm playwright test e2e/client-finance-live.spec.ts` and never against a database a running server is using for something else.

Fixtures (`src/app/dev/finance/fixtures.ts`) are built with `billingRun`, `initiatePayment`, `settlePayment` and `failPayment`, and are imported only by the dev page and tests, never by a read path.
