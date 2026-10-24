"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

import { OptionSelect, type Option } from "@/components/ui/option-select"

export type HomeGroup = "urgency" | "task"

const GROUP_OPTIONS: Option[] = [
  { value: "urgency", label: "Group by urgency" },
  { value: "task", label: "Group by task" },
]

/** The home's URL for a filter query string (`?q=…`, possibly empty) and a grouping; urgency is the default and stays out of it. */
export function homeHref(search: string, group: HomeGroup): string {
  const params = new URLSearchParams(search)
  if (group !== "urgency") params.set("group", group)
  const text = params.toString()
  return `/onboarding${text ? `?${text}` : ""}`
}

/**
 * How the specialist home groups its rows. It is a view choice, not a filter, so it sits in the page
 * header and never competes with the filter row for space. `search` is the filters' query string, kept
 * as it is.
 */
export function SpecialistHomeGroup({ group, search }: { group: HomeGroup; search: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  return (
    <div className="w-48">
      <label htmlFor="task-group-select" className="sr-only">
        Group tasks
      </label>
      <OptionSelect
        id="task-group-select"
        options={GROUP_OPTIONS}
        value={group}
        onValueChange={(value) =>
          startTransition(() => {
            router.replace(homeHref(search, value === "task" ? "task" : "urgency"), { scroll: false })
          })
        }
        data-testid="group-select"
      />
    </div>
  )
}
