"use client"

import type { ReactNode } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type ProfileTab = { id: string; label: string; content: ReactNode }

/**
 * Only the tabs that apply to this person are passed in; the first is the default. A single
 * tab renders without the tab list.
 */
export function ProfileTabs({ tabs }: { tabs: ProfileTab[] }) {
  return (
    <Tabs defaultValue={tabs[0]?.id}>
      {tabs.length > 1 ? (
        <TabsList aria-label="Person sections">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      ) : null}
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} data-testid={`tabpanel-${tab.id}`}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
