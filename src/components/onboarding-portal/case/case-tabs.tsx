"use client"

import type { ReactNode } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type CaseTab = { id: string; label: string; content: ReactNode }

/**
 * The case detail's underline tabs (ui-guidelines C13). The open tab is kept in `?tab=` with
 * `history.replaceState`, so a refresh or a shared link lands on the same tab without a server round trip.
 */
export function CaseTabs({ tabs, initial }: { tabs: CaseTab[]; initial: string }) {
  return (
    <Tabs
      defaultValue={tabs.some((tab) => tab.id === initial) ? initial : tabs[0]?.id}
      onValueChange={(value) => {
        const url = new URL(window.location.href)
        url.searchParams.set("tab", String(value))
        window.history.replaceState(null, "", url)
      }}
    >
      <TabsList aria-label="Case sections">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} data-testid={`tab-${tab.id}`}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} data-testid={`tabpanel-${tab.id}`}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
