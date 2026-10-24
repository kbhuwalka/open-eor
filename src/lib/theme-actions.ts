"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { THEME_COOKIE_NAME } from "./theme-cookie"
import { isThemeId } from "./themes"

/** Any persona may pick a preset; it only affects their own browser. */
export async function setThemeId(themeId: string): Promise<void> {
  if (!isThemeId(themeId)) return
  const store = await cookies()
  store.set(THEME_COOKIE_NAME, themeId, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  })
  revalidatePath("/", "layout")
}
