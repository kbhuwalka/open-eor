/**
 * Theme presets (ui-guidelines §3). Ported from eor-prototype `lib/themes.ts`
 * with two changes: the variable vocabulary is shadcn's (so primitives consume
 * it directly) and values are oklch. Status tokens are shared by all presets and
 * live in globals.css; a preset only restyles surfaces, text, accent, and radius.
 */

export const THEME_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--input",
  "--ring",
  "--radius",
] as const

export type ThemeVar = (typeof THEME_VARS)[number]
export type ThemeDefinition = Record<ThemeVar, string>

export const THEME_IDS = [
  "monochrome",
  "classic",
  "dark",
  "warm",
  "ocean",
  "forest",
  "violet",
] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME_ID: ThemeId = "monochrome"

export const THEME_LABELS: Record<ThemeId, string> = {
  monochrome: "Monochrome",
  classic: "Classic",
  dark: "Dark",
  warm: "Warm",
  ocean: "Ocean",
  forest: "Forest",
  violet: "Violet",
}

/** Presets whose surfaces are dark; toggles the `dark` class for `dark:` utilities. */
export const DARK_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>(["dark"])

type Accent = {
  primary: string
  primaryForeground: string
  ring: string
}

/** Light presets share the same neutral surfaces, differing by hue tint and accent. */
function light(opts: {
  hue: number
  tint: number
  accent: Accent
}): ThemeDefinition {
  const { hue, tint, accent } = opts
  const c = (l: number, chroma = tint) => `oklch(${l} ${chroma} ${hue})`
  return {
    "--background": c(0.985, tint / 2),
    "--foreground": "oklch(0.145 0 0)",
    "--card": "oklch(1 0 0)",
    "--card-foreground": "oklch(0.145 0 0)",
    "--popover": "oklch(1 0 0)",
    "--popover-foreground": "oklch(0.145 0 0)",
    "--primary": accent.primary,
    "--primary-foreground": accent.primaryForeground,
    "--secondary": c(0.96),
    "--secondary-foreground": "oklch(0.205 0 0)",
    "--muted": c(0.96),
    "--muted-foreground": "oklch(0.556 0 0)",
    "--accent": c(0.96),
    "--accent-foreground": "oklch(0.205 0 0)",
    "--border": c(0.91),
    "--input": c(0.91),
    "--ring": accent.ring,
    "--radius": "0.625rem",
  }
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  monochrome: light({
    hue: 0,
    tint: 0,
    accent: {
      primary: "oklch(0.205 0 0)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.708 0 0)",
    },
  }),
  classic: light({
    hue: 255,
    tint: 0.012,
    accent: {
      primary: "oklch(0.546 0.215 262)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.546 0.215 262)",
    },
  }),
  warm: light({
    hue: 60,
    tint: 0.012,
    accent: {
      primary: "oklch(0.55 0.19 40)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.55 0.19 40)",
    },
  }),
  ocean: light({
    hue: 220,
    tint: 0.012,
    accent: {
      primary: "oklch(0.6 0.12 215)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.6 0.12 215)",
    },
  }),
  forest: light({
    hue: 150,
    tint: 0.012,
    accent: {
      primary: "oklch(0.52 0.14 150)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.52 0.14 150)",
    },
  }),
  violet: light({
    hue: 295,
    tint: 0.014,
    accent: {
      primary: "oklch(0.54 0.22 295)",
      primaryForeground: "oklch(0.985 0 0)",
      ring: "oklch(0.54 0.22 295)",
    },
  }),
  dark: {
    "--background": "oklch(0.145 0 0)",
    "--foreground": "oklch(0.985 0 0)",
    "--card": "oklch(0.205 0 0)",
    "--card-foreground": "oklch(0.985 0 0)",
    "--popover": "oklch(0.205 0 0)",
    "--popover-foreground": "oklch(0.985 0 0)",
    "--primary": "oklch(0.922 0 0)",
    "--primary-foreground": "oklch(0.205 0 0)",
    "--secondary": "oklch(0.269 0 0)",
    "--secondary-foreground": "oklch(0.985 0 0)",
    "--muted": "oklch(0.269 0 0)",
    "--muted-foreground": "oklch(0.708 0 0)",
    "--accent": "oklch(0.269 0 0)",
    "--accent-foreground": "oklch(0.985 0 0)",
    "--border": "oklch(1 0 0 / 10%)",
    "--input": "oklch(1 0 0 / 15%)",
    "--ring": "oklch(0.556 0 0)",
    "--radius": "0.625rem",
  },
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value)
}

/** One `[data-theme="id"]` rule per preset, so switching is an attribute flip. */
export function themeStylesheet(): string {
  return THEME_IDS.map((id) => {
    const decls = THEME_VARS.map((v) => `${v}:${THEMES[id][v]}`).join(";")
    return `[data-theme="${id}"]{${decls}}`
  }).join("\n")
}

/** Swatch keys shown on preset cards (Appearance page). */
export const SWATCH_VARS: readonly ThemeVar[] = [
  "--primary",
  "--background",
  "--card",
  "--foreground",
  "--muted-foreground",
  "--border",
]
