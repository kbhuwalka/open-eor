import localFont from "next/font/local"

/**
 * Script face for the typed-signature preview only (ui-guidelines F1a). Server-generated PDFs embed
 * the same Dancing Script file, so the preview matches what ends up on the document.
 */
export const signatureFont = localFont({
  src: "../../../assets/fonts/DancingScript.ttf",
  display: "swap",
  weight: "400 700",
})
