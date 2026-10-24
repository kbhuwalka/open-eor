"use client"

import Link from "next/link"
import {
  Banknote,
  CalendarClock,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  FileText,
  HandCoins,
  HeartPulse,
  House,
  Inbox,
  Landmark,
  Scale,
  Users,
  type LucideIcon,
} from "lucide-react"
import { usePathname } from "next/navigation"
import { cn } from "cn"

import { useCloseSidebar } from "./sidebar-shell"

const ICONS = {
  people: Users,
  calculator: Calculator,
  queue: Inbox,
  checklist: ClipboardList,
  review: ClipboardCheck,
  finance: Landmark,
  home: House,
  payments: Banknote,
  deposits: HandCoins,
  invoices: FileText,
  documents: FileText,
  benefits: HeartPulse,
  receivables: Scale,
  billing: CalendarClock,
} satisfies Record<string, LucideIcon>

export type NavIcon = keyof typeof ICONS

export type NavItem = {
  label: string
  /** A name, not a component: nav items cross from server layouts into this client component. */
  icon?: NavIcon
  href: string
  /** Optional count badge (e.g. pending reviews). Hidden when 0. */
  count?: number
  /** Match nested routes too (e.g. /onboarding/cases/[id] highlights Cases). */
  prefix?: boolean
  /** Extra path prefixes this item owns (e.g. People owns /client/people). */
  also?: string[]
}

function isActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true
  if (item.prefix && pathname.startsWith(`${item.href}/`)) return true
  return (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Ported from eor-prototype Sidebar nav list; active state and count badge preserved. */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const close = useCloseSidebar()
  return (
    <nav className="flex-1 overflow-y-auto px-3 pt-6" aria-label="Portal">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item, pathname)
          const Icon = item.icon ? ICONS[item.icon] : null
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-3 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-3">
                  {Icon ? <Icon className="size-[18px] shrink-0" aria-hidden /> : null}
                  {item.label}
                </span>
                {item.count ? (
                  <span
                    aria-label={`${item.count} pending`}
                    className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground"
                  >
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
