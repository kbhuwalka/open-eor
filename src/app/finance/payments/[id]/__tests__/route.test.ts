import { describe, expect, it } from "vitest"

import { GET } from "../route"

const call = (id: string) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) })

describe("GET /finance/payments/[id]", () => {
  it("redirects to the Payments list with the payment open", async () => {
    const response = await call("pay_422cc2")
    expect(response.status).toBe(307)
    expect(response.headers.get("Location")).toBe("/finance/payments?open=pay_422cc2")
  })

  it("encodes the id once", async () => {
    const response = await call("pay%20x")
    expect(response.headers.get("Location")).toBe("/finance/payments?open=pay%20x")
  })
})
