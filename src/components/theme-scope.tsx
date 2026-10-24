"use client"

import { useEffect } from "react"

/**
 * Popups (selects, calendars, dialogs, tooltips) portal to `<body>`, outside the
 * themed wrapper, so they would fall back to the default theme. Mirroring the
 * active theme onto `<body>` keeps them on the same tokens as the page.
 */
export function ThemeScope({ themeId, dark }: { themeId: string; dark: boolean }) {
  useEffect(() => {
    const body = document.body
    const previous = body.dataset.theme
    body.dataset.theme = themeId
    body.classList.toggle("dark", dark)
    return () => {
      if (previous === undefined) delete body.dataset.theme
      else body.dataset.theme = previous
      body.classList.remove("dark")
    }
  }, [themeId, dark])

  return null
}
