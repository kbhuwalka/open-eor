"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"
import { format, parse } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { Calendar } from "@/components/ui/calendar"
import { selectPopupClass, selectTriggerClass } from "@/components/ui/select"

const ISO = "yyyy-MM-dd"

function parseIso(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = parse(value, ISO, new Date())
  return Number.isNaN(date.getTime()) ? undefined : date
}

type DatePickerProps = {
  /** `YYYY-MM-DD`, or "" for none. */
  value: string
  onValueChange: (value: string) => void
  /** Earliest selectable day, `YYYY-MM-DD`. */
  min?: string
  /** Latest selectable day, `YYYY-MM-DD`. */
  max?: string
  placeholder?: string
  /** Submitted with the surrounding form as `YYYY-MM-DD`. */
  name?: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  "data-testid"?: string
}

/** Themed calendar popover, ported from the eor-prototype DatePicker. */
export function DatePicker({
  value,
  onValueChange,
  min,
  max,
  placeholder = "Select date…",
  name,
  id,
  disabled,
  invalid,
  className,
  "data-testid": testId,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = parseIso(value)
  const earliest = parseIso(min)
  const latest = parseIso(max)
  const disabledDays = [
    ...(earliest ? [{ before: earliest }] : []),
    ...(latest ? [{ after: latest }] : []),
  ]

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <PopoverPrimitive.Trigger
        id={id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        data-slot="select-trigger"
        data-size="default"
        className={cn(selectTriggerClass, "w-full", className)}
        render={<button type="button" />}
      >
        <span className={cn("flex-1 text-left", !selected && "text-muted-foreground")}>
          {selected ? format(selected, "MMM d, yyyy") : placeholder}
        </span>
        <CalendarIcon className="pointer-events-none size-4 text-muted-foreground" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={4} align="start" collisionPadding={8} className="isolate z-50">
          <PopoverPrimitive.Popup
            aria-label="Choose a date"
            className={cn(selectPopupClass, "w-auto min-w-0 overflow-visible p-3 outline-none")}
          >
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected ?? earliest ?? latest}
              disabled={disabledDays.length > 0 ? disabledDays : undefined}
              onSelect={(day) => {
                if (!day) return
                onValueChange(format(day, ISO))
                setOpen(false)
              }}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
