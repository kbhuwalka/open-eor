import { describe, expect, it } from "vitest"

import { GET } from "../route"

const call = (id: string) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) })

describe("GET /finance/invoices/[id]", () => {
  it("redirects to the Invoices list with the invoice open", async () => {
    const response = await call("inv_1")
    expect(response.status).toBe(307)
    expect(response.headers.get("Location")).toBe("/finance/invoices?open=inv_1")
  })

  it("keeps an id with colons intact, encoded once", async () => {
    const response = await call("payroll%3Ahire_1%3A3")
    expect(response.headers.get("Location")).toBe("/finance/invoices?open=payroll%3Ahire_1%3A3")
  })
})
