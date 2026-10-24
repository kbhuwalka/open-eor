import { test, expect } from "@playwright/test"

test("home redirects to persona picker", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/pick/)
  await expect(
    page.getByRole("heading", { name: /choose who you.re signing in as/i })
  ).toBeVisible()
})

test("the picker has Clients by company, Northwind staff and an employee search", async ({ page }) => {
  await page.goto("/pick")
  const clients = page.getByRole("region", { name: /^Clients/ })
  await expect(clients.getByTestId("persona-tile")).toHaveText([
    /Acme Robotics\s*Alex Harper, HR/,
    /Brightwave Labs\s*Priya Raman, HR/,
    /Harbor Foods Co\.\s*Marcus Hale, HR/,
  ])
  const northwind = page.getByRole("region", { name: /^Northwind/ })
  await expect(northwind.getByTestId("persona-tile")).toHaveText([
    /Sam Ortiz\s*Onboarding specialist/,
    /Morgan Reyes\s*Finance/,
  ])
  await expect(page.getByRole("region", { name: /^Employees/ }).getByTestId("employee-search")).toBeVisible()
})

test("the employee search signs in as the chosen employee", async ({ page }) => {
  await page.goto("/pick")
  await test.step("search for Jordan", async () => {
    await page.getByTestId("employee-search").click()
    await page.getByRole("combobox", { name: "Search employees" }).fill("jordan lee")
  })
  await test.step("pick the match", async () => {
    await page.getByRole("option", { name: /Jordan Lee/ }).first().click()
    await page.waitForURL(/\/worker/)
  })
})

test("the in-portal switcher offers the same groups and switches persona", async ({ page }) => {
  await page.goto("/pick")
  await page.getByRole("button", { name: /^Acme Robotics/ }).click()
  await page.waitForURL(/\/client/)

  const popup = page.getByRole("dialog", { name: "Switch persona" })
  await test.step("open the switcher", async () => {
    await page.getByRole("button", { name: /^Signed in as Acme Robotics, Alex Harper, HR/ }).click()
    await expect(popup.getByRole("list", { name: /^Clients/ })).toContainText("Brightwave Labs")
    await expect(popup.getByRole("list", { name: /^Northwind/ })).toContainText("Morgan Reyes")
    await expect(popup.getByRole("button", { name: "Search employees" })).toBeVisible()
  })
  await test.step("switch to Finance", async () => {
    await popup.getByRole("button", { name: /Morgan Reyes/ }).click()
    await page.waitForURL(/\/finance/)
  })
})
