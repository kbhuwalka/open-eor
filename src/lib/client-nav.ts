import type { NavItem } from "@/components/app-shell/sidebar-nav"

/** The client portal's routes that more than one page links to. Home is the portal home (`ROLE_HOME`). */
export const CLIENT_HOME_PATH = "/client"
export const CLIENT_PEOPLE_PATH = "/client/people"
export const CLIENT_FINANCE_PATH = "/client/finance"

/**
 * The client sidebar: Home (which owns the task routes and carries the open-task badge), People
 * (the list and every person page under it), Finance and the cost calculator.
 */
export function clientNav(openTaskCount: number): NavItem[] {
  return [
    { label: "Home", icon: "home", href: CLIENT_HOME_PATH, also: ["/client/tasks"], count: openTaskCount },
    { label: "People", icon: "people", href: CLIENT_PEOPLE_PATH, prefix: true },
    { label: "Finance", icon: "finance", href: CLIENT_FINANCE_PATH, prefix: true },
    { label: "Cost calculator", icon: "calculator", href: "/client/calculator" },
  ]
}
