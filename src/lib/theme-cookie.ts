/**
 * Theme selection is a cookie for now (ui-guidelines §3.2 T3). A later slice
 * can persist it per client company and fall back to this cookie.
 */
import { cookies } from "next/headers"
import { connection } from "next/server"

import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themes"

export const THEME_COOKIE_NAME = "eor_theme"

export async function readThemeId(): Promise<ThemeId> {
  await connection()
  const store = await cookies()
  const value = store.get(THEME_COOKIE_NAME)?.value
  return isThemeId(value) ? value : DEFAULT_THEME_ID
}
