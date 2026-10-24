"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

import { selectPopupClass } from "@/components/ui/select"

const Popover = PopoverPrimitive.Root

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/** A floating panel styled like a select popup, for a small form (the Invoices "More" filters). */
function PopoverContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} collisionPadding={8} className="isolate z-50">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(selectPopupClass, "w-auto min-w-0 overflow-visible p-4 outline-none", className)}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent, PopoverTrigger }
