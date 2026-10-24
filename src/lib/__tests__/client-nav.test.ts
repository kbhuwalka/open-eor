import { describe, expect, it } from "vitest"

import { ROLE_HOME } from "@/auth/session"
import { isNavItemActive } from "@/components/app-shell/sidebar-nav"
import { CLIENT_HOME_PATH, CLIENT_PEOPLE_PATH, clientNav } from "@/lib/client-nav"
import { portalHomeHref } from "@/lib/task-ui-registry"

const activeLabels = (pathname: string) =>
  clientNav(0)
    .filter((item) => isNavItemActive(item, pathname))
    .map((item) => item.label)

describe("client navigation", () => {
  it("lists Home, People, Finance and Cost calculator in that order", () => {
    expect(clientNav(0).map((item) => item.label)).toEqual(["Home", "People", "Finance", "Cost calculator"])
  })

  it("puts the open-task count on Home and on nothing else", () => {
    const items = clientNav(4)
    expect(items.find((item) => item.label === "Home")?.count).toBe(4)
    expect(items.filter((item) => item.count !== undefined).map((item) => item.label)).toEqual(["Home"])
  })

  it("makes Home the portal home: sign-in, the task flow and the notice all land on it", () => {
    expect(ROLE_HOME.client_hr).toBe(CLIENT_HOME_PATH)
    expect(portalHomeHref("client")).toBe(CLIENT_HOME_PATH)
  })

  it.each([
    ["/client", "Home"],
    ["/client/tasks/task_1", "Home"],
    ["/client/people", "People"],
    ["/client/people/new", "People"],
    ["/client/people/case_1", "People"],
    ["/client/finance", "Finance"],
    ["/client/finance/invoices/inv_1", "Finance"],
    ["/client/calculator", "Cost calculator"],
  ])("%s highlights only %s", (pathname, label) => {
    expect(activeLabels(pathname)).toEqual([label])
  })

  it("keeps the People list at its own route", () => {
    expect(CLIENT_PEOPLE_PATH).toBe("/client/people")
    expect(clientNav(0).find((item) => item.label === "People")?.href).toBe(CLIENT_PEOPLE_PATH)
  })
})
