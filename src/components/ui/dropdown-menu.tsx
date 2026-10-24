"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "cn"

import { selectItemClass, selectPopupClass } from "@/components/ui/select"

const DropdownMenu = MenuPrimitive.Root

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

/** A menu of commands under a trigger (an overflow "More actions" button), styled like a select popup. */
function DropdownMenuContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "end",
  children,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} collisionPadding={8} className="isolate z-50">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(selectPopupClass, "w-auto min-w-44 py-1 outline-none", className)}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        selectItemClass,
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10! data-[variant=destructive]:data-highlighted:text-destructive",
        className,
      )}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger }
