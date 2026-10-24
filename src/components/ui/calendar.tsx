"use client"

import * as React from "react"
import { cn } from "cn"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { DayPicker } from "react-day-picker"

/**
 * Themed month calendar. react-day-picker's own stylesheet is not used: every
 * part is styled from the design tokens so the calendar follows the theme.
 */
function Calendar({ className, classNames, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays
      className={cn("text-sm", className)}
      classNames={{
        root: "relative w-fit",
        months: "flex flex-col",
        month: "flex flex-col gap-2",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between",
        button_previous:
          "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
        button_next:
          "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
        month_grid: "border-collapse",
        weekdays: "flex",
        weekday: "size-9 py-2 text-center text-xs font-medium text-muted-foreground",
        weeks: "flex flex-col",
        week: "flex",
        day: "size-9 p-0 text-center",
        day_button:
          "inline-flex size-9 items-center justify-center rounded-md transition-colors outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none",
        selected:
          "[&>button]:bg-primary [&>button]:font-medium [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        today: "[&>button:not(:hover)]:bg-muted [&>button]:font-medium",
        outside: "text-muted-foreground/50",
        disabled: "[&>button]:opacity-35",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === "left" ? (
            <ChevronLeftIcon className={cn("size-4", chevronClass)} />
          ) : (
            <ChevronRightIcon className={cn("size-4", chevronClass)} />
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
