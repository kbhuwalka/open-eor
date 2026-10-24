# Finance portal

## 1. Purpose and assumptions

This spec owns the screens Northwind's Finance staff (`finance` role) use to move money through the product: reconcile the payments clients start, confirm deposits, find and void invoices, see what clients owe, and run billing. Invoice and payment rules (pay calendar, statuses, payment lifecycle, the billing run, deposits) live in [billing-and-invoicing.md](./billing-and-invoicing.md); this document says how they are shown and which operations each button calls. The client's view of the same data is [client-finance.md](./client-finance.md).

Assumptions:

- Every read goes through `src/server/billing-queries.ts` (invoices, payments, receivables) or `src/server/finance-portal-queries.ts` (deposits, home tiles, company options, the PDF input) and every write through `src/server/billing.ts`. The screens contain no billing arithmetic.
- Everything here is for `finance` only. Each query and operation asserts the role itself (`FORBIDDEN_ROLE`), the pages sit under the `/finance` portal guard (acl F2), and the Server Actions call `requireRole("finance")` first (acl F1, §6).
- Money is whole US cents shown through `formatCents`; days are `YYYY-MM-DD` and print through `formatIsoDay`. "Settled" is how the UI says a payment whose stored status is `succeeded`.
- The Finance home (`/finance`) belongs to the task inbox ([task-inbox.md](./task-inbox.md)): the same shared `TaskInboxTable` as the Onboarding home, configured for Finance (`TASK_INBOX_CONFIG.finance`): one list of the deposits waiting on Finance, whole-row links to `/finance/deposits` (the registry href of `confirm_deposit`), search and Client, Task and Status filters, empty copy "Nothing needs you right now". This slice only exports `FinanceOverviewTiles` for it to embed.

## 2. Routes and screens

| Route | Kind | Notes |
| --- | --- | --- |
| `/finance/payments` | page | Underline `Tabs` (C13) **Initiated**, **Settled**, **Failed**, each with its count; URL state `tab`, `page`, `size`. Table: payment id (links to the detail), client, invoices covered (one invoice is its number as a new-tab link; several are one "N invoices" button that opens a dialog, see 2.2), method, initiated date, amount; the Initiated tab adds a checkbox column and per-row **Settle** and **Mark failed** (failing a deposit's payment also reopens the client's Pay the deposit step, billing-and-invoicing B8); the other tabs show the outcome (badge, the settled day for a settled payment or the failed day for a failed one, failure reason; days are America/New_York days). The payment detail lists Settled and Failed as separate rows, each only when it applies. Selecting rows shows a sticky bar ("N payments selected · $total") with **Settle selected**. |
| `/finance/payments/[id]` | page | One payment: status, client, method, started, settled, failure reason, amount; the invoices it covers; **Settle** and **Mark failed** while it is initiated. Unknown id: `notFound()`. |
| `/finance/deposits` | page | Orders (open cases) whose deposit invoice is `open` or `processing` (`depositState`), the ones waiting on Finance first. Columns: person (links to the order's Confirm deposit task page, [task-inbox.md](./task-inbox.md), and start date), client, deposit invoice (links to it), due, amount, status, actions **Confirm received** and, only while the client's payment is in flight (state Processing), **Not received**. A row whose client has not paid yet (or paid again after a failure) reads "Awaiting payment" and has no Not received: there is no payment to fail. Rows without a ready deposit task show "Not ready for Finance yet". Paginated with the shared bar above ten (`?page`, `?size`, C11). |
| `/finance/invoices` | page | Every company's invoices. Search (person, invoice number), filters status, client, kind (payroll or deposit) and issue date range, sortable columns, pagination (C6, C11); all state in the URL. |
| `/finance/invoices/[id]` | page | Summary, line items, payments on it, status history, **Download PDF** and **Void invoice** (open or overdue invoices only). |
| `GET /finance/invoices/[id]/pdf` | route handler | Invoice PDF for any company's invoice from `generateInvoicePdf`, private attachment named `<number>.pdf`. 401 no session, 403 other role, 404 unknown id, 200 `application/pdf`. |
| `/finance/receivables` | page | Summary tiles (Total outstanding, Current, Overdue, In flight), one row per client with the four ageing buckets, total and in-flight, a total row, and `?company=<id>` for that client's open invoices. The client rows page through the shared bar (`?page`, `?size`) with the total row staying the whole report; the drilldown is server-paginated (`?ipage`, `?isize`) with no row cap. |
| `/finance/billing` | page | Preview of what Run billing would issue now, the **Run billing** button with its result, the next pay periods and the recent issue dates. |

Nav (in order): Home, Payments (count of initiated payments), Deposits (count awaiting), Invoices, Receivables, Billing run. Detail pages keep their list item active (`prefix`).

Page states: every data page is a synchronous export wrapping an async child in `Suspense` with a skeleton that mirrors the layout (L2a); empty results use `EmptyState` (C7); a throw lands on `src/app/finance/error.tsx` (an `Alert` with Try again). Pending list navigation dims the rows and shows a pulse bar.

### 2.0 Lists and pagination

Every Finance list uses the shared pagination bar (C11), shown only above ten rows, with page sizes 10, 25, 50 and 100: Payments (server, `?page`, `?size` per tab), Invoices (server), Deposits and Receivables (the read model is team-sized, so the page slices it with `parsePaging` and `sliceRows` in `src/lib/pagination.ts` and the bar is the client `UrlPagination`, which keeps the other URL parameters and takes a `prefix` for a second list on a screen). Only Invoices has a client filter. Receivables already is one row per client with a drilldown; Deposits and Payments are action queues that are searched by eye, so a Client filter there is left as a follow-up if the lists grow.

### 2.2 Invoices a payment covers

A payment can settle many invoices (a client pays a month's payroll in one go). The Payments cell therefore never prints invoice numbers inline: one invoice is its number as a link, several are one text button "N invoices" opening a dialog. It is the one shared `CoveredInvoices` / `CoveredInvoicesDialog` (`src/components/finance/covered-invoices-dialog.tsx`), also used by the client Payments tab ([client-finance.md](./client-finance.md)); it is presentational and takes normalized `CoveredInvoiceItem`s plus the payment (amount, day, status), so each portal only supplies an adapter (`itemsFromCovered` here, `itemsFromInvoiceRows` for the client, in `src/lib/covered-invoices.ts`). The dialog is titled "Payment of $X" with the day and status badge, names the client in the description, and has one whole-row link per invoice (number, person and title, period or "Deposit", and the share of the payment allocated to it, `MoneyCell`). Every invoice opens in a new tab (`target=_blank`, `rel="noopener noreferrer"`) so the list stays where it is; Escape closes the dialog and focus returns to the button. The data is `coveredInvoicesByPayment` (`src/server/finance-portal-covered.ts`, Finance only), read for the payments of the page from `payment_allocations`.

### 2.1 Settling a payment

`settlePayment` marks the payment `succeeded`, its invoices read as paid and, when an invoice is a deposit whose case has a ready `confirm_deposit` task, completes that task with resolution `settled` in the same transaction, so onboarding moves on. Failing needs a reason; the invoices are payable again. Both are refused (`ILLEGAL_TRANSITION`) for a payment that is no longer initiated; the UI says "That payment is no longer waiting on Finance: it was already settled or marked failed. Refresh the page." Failing the payment of a deposit invoice also reopens the order's `pay_deposit` step for the client, as Not received does (§2.2).

Bulk settle runs `settlePayment` once per payment, each in its own transaction, so one stale payment does not hold the rest back. The result lists what settled and what did not; if nothing settled the action returns an error.

### 2.2 Deposits

- **Confirm received** calls `markDepositReceived(caseId)`: an unpaid deposit is recorded as paid outside the product (a settled payment without a saved method); a processing one settles the client's payment. The `confirm_deposit` (or `pay_deposit`) task completes.
- **Not received** calls `markDepositNotReceived(caseId, reason?)`, available only when the deposit is Processing (the client's payment is `initiated`). It fails that payment through the same `failPayment` path as Payments > Mark failed, with the reason "Deposit not received" followed by Finance's optional detail ("Deposit not received: The ACH debit was returned"). Nothing else is stored: the deposit invoice derives to Due (or Overdue past its date) and appears again in the client's Invoices tab with Pay available, and the client's Pay the deposit step reopens with a note (billing-and-invoicing B8, tasks-and-workflow §5.8), so the case shows a deposit payment to redo. The row stays on the Deposits list as **Awaiting payment**, now with only Confirm received. A payment that covers other invoices fails as a whole; the dialog says how many others become payable again, and each deposit in it reopens its own step.
- **Awaiting payment** (no payment in flight) has nothing to fail, so no Not received button; Confirm received stays for a deposit paid outside the product. After a Not received it completes the reopened Pay the deposit step and Confirm deposit in one go.
- A cancelled case with a processing deposit has no ready task; its payment is settled or failed from Payments. Failing it voids the unpaid deposit (nobody is left to pay) instead of reopening a step.

### 2.3 Voiding an invoice

`voidInvoice(invoiceId, reason)` cancels an invoice nothing has paid or started to pay, and withdraws its pay slip. The reason is required and kept on the invoice. An invoice with a payment (processing or paid) or one already void is refused; the dialog says so ("That invoice has a payment (processing or paid), so it cannot be voided. Fail the payment first." or "That invoice is already void."). Void invoices are left out of the default invoice list; filter by status Void to see them.

### 2.4 Billing run

`previewBillingRun` is read-only. It plans with the same pure function the run uses (`planInvoices` in `billing-core.ts`), so what the preview lists is what Run billing issues. It returns what would be issued today (counts of payroll and deposit invoices, pay slips, totals, by client, the invoices), the next three pay periods with an estimate for the people billable today, and the most recent issue dates with what was issued on each (runs are not logged, so history is invoices grouped by issue date).

**Run billing** calls `runBilling` for today and reports invoices issued (payroll and deposit), pay slips created and the total; it is idempotent, so pressing it again says "Nothing to issue. Everything due as of <day> is already billed." The machine trigger `POST /api/billing/run` (see the route table in [architecture.md](./architecture.md)) is unchanged.

## 3. Server Actions (`src/app/finance/actions.ts`)

All return `ActionResult` (acl §6): `requireRole("finance")` before anything else, identity from the session only, ids narrowed to non-empty strings of at most 120 characters, reasons trimmed and capped at 300. A success revalidates `/finance` and `/client` (layouts), so counts, nav badges and the client's invoice list refresh.

| Action | Calls | Notes |
| --- | --- | --- |
| `settlePaymentAction(paymentId)` | `settlePayment` | |
| `settlePaymentsAction(paymentIds)` | `settlePayment` per id | 1 to 100 distinct ids; returns `{ settled, failed[] }` |
| `failPaymentAction(paymentId, reason)` | `failPayment` | reason required |
| `markDepositReceivedAction(caseId)` | `markDepositReceived` | |
| `markDepositNotReceivedAction(caseId, reason?)` | `markDepositNotReceived` | reason optional (trimmed, 300 at most); refused when the order has no deposit payment in flight |
| `voidInvoiceAction(invoiceId, reason)` | `voidInvoice` | reason required |
| `runBillingAction()` | `runBilling` | returns `{ today, invoices, payrollInvoices, depositInvoices, payslips, totalCents }` |

A refused role is `forbidden`, no session `unauthenticated`, a bad argument `validation` (with the field in `details`), a domain refusal its `DomainErrorCode`. `ILLEGAL_TRANSITION` is turned into a sentence by what was attempted (`illegalTransitionMessage` in `src/server/action-result.ts`): the payment, invoice and deposit wordings above and below, and the order lifecycle ones ("This person has already started, so the order can no longer be cancelled. End their employment instead."); an unrecognised one reads "That is not possible right now. Refresh the page and try again." Users never see the code. The deposit ones: "This order has no deposit payment in flight, so there is nothing to mark as not received. Refresh the page." and "This order has no deposit step waiting for Finance. Refresh the page."

## 4. Read models

`src/server/finance-portal-queries.ts` (all assert `finance`):

| Function | Returns |
| --- | --- |
| `listPendingDeposits(db, actor, now)` | `PendingDeposit[]` for open cases: ids, person, client, start date, invoice, amount, `state` (`open` or `processing`), issue and due dates, `overdue`, the client's in-flight `paymentId` and how many invoices it covers (`paymentInvoiceCount`), and the ready `taskId` and `taskKey` (`confirm_deposit` or `pay_deposit`) or `null` |
| `financeOverview(db, actor, now)` | the four home figures: payments to reconcile (count, cents), deposits awaiting (count, cents), overdue receivables (count, cents, every bucket after current), billing (invoices the run would issue and their total, the next issue date) |
| `listCompanyOptions`, `paymentStatusCounts` | the client filter, the tab counts |
| `financeInvoicePdfInput(db, actor, invoiceId)` | the invoice, payments, client and (payroll) person for `generateInvoicePdf`; `null` when unknown |

`src/server/billing-preview.ts` holds `previewBillingRun`, `upcomingPayPeriods` and `recentIssueDays`. `listFinanceInvoices` also accepts `issuedFrom` and `issuedTo` (inclusive, by issue date).

`FinanceOverviewTiles` (`src/components/finance-portal/overview-tiles.tsx`) is a server component that suspends on its own skeleton and renders `FinanceOverviewTilesView`: one `SummaryCard` of four linked tiles (Payments to reconcile, Deposits awaiting, Overdue receivables, Next billing). The Finance home is where it goes, above the inbox (the home page is owned by the task inbox slice).

## 5. Dynamic ids

Next passes `params` still percent-encoded and invoice ids contain colons (`payroll:hire_1:12` arrives as `payroll%3Ahire_1%3A12`). Pages and the PDF route decode with `decodeIdParam` before looking up; links encode with `encodeURIComponent`.

## 6. UI rules

The visual rules are ui-guidelines §5.5 (C30 to C33; the Finance home is C43). Component test ids are the contract for the e2e spec (`payment-row`, `settle-row`, `fail-row`, `settle-selected`, `deposit-row`, `confirm-deposit`, `confirm-deposit-dialog`, `not-received-deposit`, `not-received-dialog`, `invoice-row`, `void-invoice`, `run-billing`, `run-result-text`, `reason-input`, `action-confirm`, `tile-*`).

## 7. Out of scope

Refunds and credit notes; partial payments; editing an invoice; adding or changing the client's bank account; a separate log of billing runs; exporting to accounting; notifications to the client when a payment fails (they see the invoice payable again); email.

## 8. Verification

1. `src/server/__tests__/finance-portal.test.ts`: settling makes the invoice paid and a deposit payment completes `confirm_deposit` so the remaining blocking tasks can finish; failing makes it payable again and needs a reason, and for a deposit reopens the client's payment step (`deposit-not-received.test.ts`: Not received and Mark failed, a multi-invoice payment, a case past `confirm_deposit`, a cancelled order, paying again, Confirm received afterwards, Finance only); an order cancelled while its deposit payment was processing keeps that payment in the queue, where it can be settled or failed; void needs an open invoice and is refused for a covered or already void one; the preview writes nothing and equals the run; a second run issues nothing; the overview tiles agree with the queries; `client_hr`, `worker` and `onboarding_specialist` get `FORBIDDEN_ROLE` from every operation and query and nothing changes.
2. `src/app/finance/__tests__/actions.test.ts`: the actions return `forbidden` for the three other roles and `unauthenticated` without a session, validate ids and reasons, bulk settle reports partial failures, refusals use the entity wording; `src/server/__tests__/action-result.test.ts`: every `ILLEGAL_TRANSITION` reads as a sentence, never the code.
3. `src/app/finance/invoices/[id]/pdf/__tests__/route.test.ts`: 401, 403, 404 and 200, with the id decoded.
4. `src/components/finance-portal/__tests__/finance-portal-components.test.tsx` and `src/lib/__tests__/finance-portal.test.ts`: dialogs, selection and bulk settle, deposits, tiles, billing panel, receivables, history, URL parsing, pagination of Deposits and Receivables. `src/components/finance/__tests__/covered-invoices-dialog.test.tsx` (the shared dialog), `src/lib/__tests__/covered-invoices.test.ts` (both adapters), `src/components/data-table/__tests__/url-pagination.test.tsx`, `src/lib/__tests__/pagination-url.test.ts` and `src/server/__tests__/finance-portal-covered.test.ts` (covered invoices equal the list's, allocations add up to the payment, Finance only).
5. `e2e/finance-portal.spec.ts`, against a copy of the seeded database as Morgan Reyes: settle a deposit payment (invoice paid, task done), fail a payment, mark a deposit Not received (the client's Finance Invoices tab lists the deposit invoice again and the Pay the deposit step shows the note), confirm a deposit, check an Awaiting payment row offers Confirm received only, run billing twice, void an invoice, download a PDF, drill into receivables; other roles never reach these pages.
