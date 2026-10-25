/**
 * The demo's one "fill this in for me" shortcut. A screen that has a long form registers it
 * (`useDemoShortcut`) so a presenter can prefill the form instead of typing while people wait.
 * Option+Shift+D on a Mac (Alt+Shift+D elsewhere): `code` is the physical key, because Option
 * changes the character a Mac types.
 */
export const DEMO_SHORTCUT_LABEL = "Alt+Shift+D"

export function isDemoShortcut(event: Pick<KeyboardEvent, "code" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "repeat">): boolean {
  return event.code === "KeyD" && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.repeat
}
