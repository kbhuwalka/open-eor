import { test, expect, type Page } from "@playwright/test"

/**
 * The employee pay dashboard on /dev/pay (dev only): slips computed by the real payroll domain,
 * the clock pinned to 2026-04-24, so the pay history, YTD and visibility are deterministic.
 */

const dashboard = (page: Page) => page.getByTestId("dev-dashboard")
const detail = (page: Page) => page.getByTestId("dev-detail-view")

function dollars(text: string | null): number {
  return Math.round(Number((text ?? "").replace(/[^0-9.]/g, "")) * 100)
}

test("dashboard shows tiles, the year's pay slips and an icon-only download per slip", async ({ page }) => {
  await page.goto("/dev/pay")
  const board = dashboard(page)
  await expect(board.getByRole("heading", { name: "Pay", exact: true })).toBeVisible()
  for (const id of ["tile-latest-net", "tile-ytd-gross", "tile-ytd-taxes", "tile-next-pay-date"]) {
    await expect(board.getByTestId(id)).toBeVisible()
  }
  await expect(board.getByTestId("tile-next-pay-date")).toContainText("May 8, 2026")

  const rows = board.getByTestId("payslip-row")
  await expect(rows).toHaveCount(9)
  await expect(rows.first()).toContainText("Apr 6 – Apr 19, 2026")
  await expect(board.getByTestId("payslip-table").getByRole("columnheader")).toHaveText([
    "Pay period",
    "Gross pay",
    "Net pay",
    "Download",
  ])
  const download = rows.first().getByRole("link", { name: "Download pay slip for Apr 6 – Apr 19, 2026" })
  await expect(download).toHaveAttribute("href", "/worker/pay/fx-2026-04-24/pdf")
  await expect(download).toHaveText("")
  await expect(board.getByTestId("direct-deposit-label")).toHaveText("Checking ••1234")
})

test("a pay slip dated in the future is not listed", async ({ page }) => {
  await page.goto("/dev/pay")
  const periods = await dashboard(page).getByTestId("payslip-row").locator("td:first-child").allTextContents()
  expect(periods).not.toContain("Apr 20 – May 3, 2026")
  expect(periods.at(0)).toBe("Apr 6 – Apr 19, 2026")
  expect(periods.at(-1)).toBe("Dec 15 – Dec 28, 2025")
})

test("year tabs switch the list and keep the choice in the URL", async ({ page }) => {
  await page.goto("/dev/pay")
  const tabs = dashboard(page).getByTestId("pay-year-tabs")
  await expect(tabs.getByTestId("year-tab-2026")).toHaveAttribute("aria-selected", "true")
  await tabs.getByTestId("year-tab-2025").click()
  await expect(page).toHaveURL(/year=2025/)
  const rows = dashboard(page).getByTestId("payslip-row")
  await expect(rows.first()).toContainText("2025")
  for (const text of await rows.allTextContents()) expect(text).toMatch(/2025/)
  await expect(dashboard(page).getByTestId("year-tab-2025")).toHaveAttribute("aria-selected", "true")
})

test("opening a slip shows earnings, deductions, taxes and YTD that add up to net pay", async ({ page }) => {
  await page.goto("/dev/pay")
  await dashboard(page).getByTestId("payslip-row").first().getByRole("link", { name: "Apr 6 – Apr 19, 2026", exact: true }).click()
  await expect(page).toHaveURL(/slip=fx-2026-04-24/)

  const slip = detail(page)
  await expect(slip.getByText("Pay period Apr 6 – Apr 19, 2026")).toBeVisible()
  await expect(slip.getByTestId("earnings").getByText("Year to date")).toBeVisible()
  await expect(slip.getByTestId("pre-tax").getByText("Employee + spouse")).toBeVisible()
  for (const label of ["Federal income tax", "Social Security", "Medicare", "California income tax"]) {
    await expect(slip.getByTestId("taxes").getByText(label, { exact: true })).toBeVisible()
  }

  const gross = dollars(await slip.getByTestId("line-SALARY").getByTestId("current").textContent())
  const take = (id: string) => slip.getByTestId(id).getByTestId("current").textContent()
  // A section with one line shows no separate total row.
  const deductions = dollars(await take("pre-tax-total")) + dollars(await take("line-LEGAL_PLAN"))
  const taxes = dollars(await take("taxes-total"))
  const net = dollars(await slip.getByTestId("net-pay").textContent())
  expect(net).toBe(gross - deductions - taxes)

  const legend = await slip.getByTestId("breakdown-legend").getByRole("listitem").allTextContents()
  const parts = legend.map((text) => dollars(text.match(/\$[\d,]+\.\d{2}$/)?.[0] ?? ""))
  expect(parts.reduce((a, b) => a + b, 0)).toBe(gross)
  await expect(slip.getByTestId("download-pdf")).toHaveAttribute("href", "/worker/pay/fx-2026-04-24/pdf")
})

test("a state with its own payroll insurance lists those lines; a no-tax state lists none", async ({ page }) => {
  await page.goto("/dev/pay?state=NY")
  const taxes = detail(page).getByTestId("taxes")
  await expect(taxes.getByText("NY Disability Benefits (DBL)")).toBeVisible()
  await expect(taxes.getByText("NY Paid Family Leave")).toBeVisible()
  await page.goto("/dev/pay?state=TX")
  await expect(detail(page).getByTestId("taxes").getByText(/income tax/i)).toHaveCount(1)
  await expect(detail(page).getByTestId("taxes").getByTestId("line-TX_INCOME")).toHaveCount(0)
})

test("before the first pay date the empty state names it", async ({ page }) => {
  await page.goto("/dev/pay?scenario=new-hire")
  const board = dashboard(page)
  await expect(board.getByTestId("payslips-empty")).toHaveText(
    "Your first pay slip appears on your first pay date — Fri, May 22, 2026.",
  )
  await expect(board.getByTestId("payslip-table")).toHaveCount(0)
  await expect(board.getByTestId("tile-next-pay-date")).toContainText("May 22, 2026")
  await expect(page.getByTestId("dev-detail-view")).toHaveCount(0)
})

test("without a known pay date the empty state is generic", async ({ page }) => {
  await page.goto("/dev/pay?scenario=no-schedule")
  await expect(dashboard(page).getByTestId("payslips-empty")).toHaveText("Your pay slips appear here once you have been paid.")
  await expect(dashboard(page).getByTestId("direct-deposit-card")).toContainText("No account on file")
})

test("loading skeletons are available and the dark theme renders the dashboard", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "eor_theme", value: "dark", url: baseURL! }])
  await page.goto("/dev/pay")
  await expect(page.locator("div[data-theme='dark']")).toHaveClass(/\bdark\b/)
  await expect(page.getByTestId("pay-skeleton")).toBeVisible()
  await expect(page.getByTestId("payslip-skeleton")).toBeVisible()
  await expect(dashboard(page).getByTestId("payslip-row")).toHaveCount(9)
})
