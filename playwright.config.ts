import path from "node:path"

import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`
const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next")

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: !process.env.CI,
  // One shared temp DB under CI/pre-push: serialize so writers do not race seed rows.
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Prefer the local next binary so husky/pre-push need not have pnpm on PATH.
        command: `"${nextBin}" dev --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
