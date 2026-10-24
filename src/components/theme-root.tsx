import type { ReactNode } from "react"
import { cn } from "cn"

import { ThemeScope } from "@/components/theme-scope"
import { readThemeId } from "@/lib/theme-cookie"
import { DARK_THEMES, type ThemeId } from "@/lib/themes"

/**
 * Applies the active preset to a subtree server-side (no flash). Portal layouts
 * render it inside their Suspense boundary; `force` pins a preset (the picker).
 */
export async function ThemeRoot({
  children,
  force,
  className,
}: {
  children: ReactNode
  force?: ThemeId
  className?: string
}) {
  const themeId = force ?? (await readThemeId())
  return (
    <div
      data-theme={themeId}
      className={cn(
        "flex min-h-full flex-1 flex-col bg-background text-foreground",
        DARK_THEMES.has(themeId) && "dark",
        className
      )}
    >
      <ThemeScope themeId={themeId} dark={DARK_THEMES.has(themeId)} />
      {children}
    </div>
  )
}
