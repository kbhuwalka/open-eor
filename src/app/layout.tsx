import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import { themeStylesheet } from "@/lib/themes"

import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Northwind EOR",
  description: "EOR worker onboarding demo — persona picker and portals",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Preset variables generated from src/lib/themes.ts; switching is an attribute flip. */}
        <style dangerouslySetInnerHTML={{ __html: themeStylesheet() }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
