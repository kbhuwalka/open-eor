"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { cn } from "cn"
import { ChevronDownIcon, SearchIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectItemClass,
  selectPopupClass,
  selectTriggerClass,
} from "@/components/ui/select"

export type Option = {
  value: string
  label: string
  /** Quiet secondary text on the right of the row (e.g. an email or a state code). */
  hint?: string
}

/** Lists longer than this get a search box, as in the eor-prototype SearchableSelect. */
export const SEARCH_THRESHOLD = 5

type OptionSelectProps = {
  options: readonly Option[]
  /** Selected option value, or "" for none. */
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  /** Submitted with the surrounding form. */
  name?: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  "data-testid"?: string
}

/**
 * The one dropdown for forms and filters: a themed select that grows a search
 * box once it has more than {@link SEARCH_THRESHOLD} options.
 */
export function OptionSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  name,
  id,
  disabled,
  invalid,
  className,
  "data-testid": testId,
}: OptionSelectProps) {
  if (options.length <= SEARCH_THRESHOLD) {
    return (
      <Select
        name={name}
        value={value || null}
        onValueChange={(v) => onValueChange((v as string | null) ?? "")}
        items={options.map((o) => ({ value: o.value, label: o.label }))}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={cn("w-full", className)}
          aria-invalid={invalid || undefined}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.hint ? <span className="text-xs text-muted-foreground">{o.hint}</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const selected = options.find((o) => o.value === value) ?? null
  return (
    <ComboboxPrimitive.Root
      items={options as Option[]}
      value={selected}
      onValueChange={(o) => onValueChange(o?.value ?? "")}
      itemToStringLabel={(o: Option) => o.label}
      itemToStringValue={(o: Option) => o.value}
      isItemEqualToValue={(a: Option, b: Option) => a.value === b.value}
      name={name}
      disabled={disabled}
    >
      <ComboboxPrimitive.Trigger
        id={id}
        data-slot="select-trigger"
        data-size="default"
        aria-invalid={invalid || undefined}
        data-testid={testId}
        className={cn(selectTriggerClass, "w-full", className)}
      >
        <ComboboxPrimitive.Value placeholder={placeholder}>
          {(o: Option | null) => (o ? o.label : <span className="text-muted-foreground">{placeholder}</span>)}
        </ComboboxPrimitive.Value>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground transition-transform in-data-popup-open:rotate-180" />
      </ComboboxPrimitive.Trigger>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} align="start" collisionPadding={8} className="isolate z-50">
          <ComboboxPrimitive.Popup
            data-slot="select-content"
            className={selectPopupClass}
          >
            <div className="relative border-b border-border">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <ComboboxPrimitive.Input
                placeholder="Search…"
                aria-label="Search options"
                className="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">
              No results found
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-60 overflow-y-auto overscroll-contain">
              {(o: Option) => (
                <ComboboxPrimitive.Item key={o.value} value={o} className={selectItemClass}>
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint ? <span className="text-xs text-muted-foreground">{o.hint}</span> : null}
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
