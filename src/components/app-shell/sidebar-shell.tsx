"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Menu, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"

const CloseContext = createContext<() => void>(() => {})

/** Nav links call this so the mobile drawer closes on navigation. */
export function useCloseSidebar() {
  return useContext(CloseContext)
}

/**
 * Ported from eor-prototype SidebarShell. Mobile: fixed overlay and slide-in
 * panel behind a slim menu bar; desktop (md+): static panel and no top bar. Closes on nav click and Escape.
 */
export function SidebarShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <CloseContext.Provider value={close}>
      <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
        {open ? (
          <div
            data-testid="sidebar-overlay"
            className="fixed inset-0 z-40 bg-foreground/40 md:hidden"
            onClick={close}
          />
        ) : null}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-border bg-background transition-transform duration-200 motion-reduce:transition-none md:static md:translate-x-0 print:hidden",
            open ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center justify-end p-2 md:hidden">
            <Button variant="ghost" size="icon-sm" aria-label="Close menu" onClick={close}>
              <X />
            </Button>
          </div>
          {sidebar}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card print:block print:overflow-visible">
          <header className="flex h-12 shrink-0 items-center border-b border-border bg-background px-3 md:hidden print:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle menu"
              onClick={() => setOpen((v) => !v)}
            >
              <Menu />
            </Button>
          </header>
          <main className="flex-1 overflow-y-auto print:overflow-visible">
            <div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
          </main>
        </div>
      </div>
    </CloseContext.Provider>
  )
}
