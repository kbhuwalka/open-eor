"use client"

import { useEffect, useRef } from "react"

import { isDemoShortcut } from "@/lib/demo-shortcut"

/**
 * Runs `onFill` when the demo shortcut (`DEMO_SHORTCUT_LABEL`) is pressed, anywhere on the page,
 * including from inside a field. It leaves no trace in the UI: the filled form is the feedback.
 * Always runs the latest `onFill`, so it can read current state.
 */
export function useDemoShortcut(onFill: () => void): void {
  const latest = useRef(onFill)
  useEffect(() => {
    latest.current = onFill
  })
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isDemoShortcut(event)) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
