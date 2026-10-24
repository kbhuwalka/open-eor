import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const { replace, searchParams } = vi.hoisted(() => ({ replace: vi.fn(), searchParams: { current: "" } }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/finance/receivables",
  useSearchParams: () => new URLSearchParams(searchParams.current),
}))

import { UrlPagination } from "../url-pagination"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  searchParams.current = ""
})

describe("UrlPagination", () => {
  const props = { page: 2, totalPages: 3, total: 25, pageSize: 10 }

  it("renders nothing while the list fits on one page", () => {
    const { container } = render(<UrlPagination page={1} totalPages={1} total={10} pageSize={10} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("keeps the other parameters and leaves page 1 out of the URL", async () => {
    searchParams.current = "status=open&page=2"
    render(<UrlPagination {...props} />)
    await userEvent.click(screen.getByRole("button", { name: /previous/i }))
    expect(replace).toHaveBeenCalledWith("/finance/receivables?status=open", { scroll: false })
  })

  it("goes to the next page through the URL", async () => {
    render(<UrlPagination {...props} />)
    await userEvent.click(screen.getByRole("button", { name: /next/i }))
    expect(replace).toHaveBeenCalledWith("/finance/receivables?page=3", { scroll: false })
  })

  it("a prefix keeps a second list's page apart", async () => {
    searchParams.current = "page=4"
    render(<UrlPagination {...props} prefix="i" />)
    await userEvent.click(screen.getByRole("button", { name: /next/i }))
    expect(replace).toHaveBeenCalledWith("/finance/receivables?page=4&ipage=3", { scroll: false })
  })
})
