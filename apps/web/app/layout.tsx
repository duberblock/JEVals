import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'

import { AppHeader } from '../components/layout/app-header'
import { MobileNav } from '../components/layout/mobile-nav'
import './globals.css'
import { Geist, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

// No font preloads at all: preloading made Firefox log "preloaded but not
// used" on surfaces that paint no glyph from a given face for a few seconds
// (post-run views, history), which the §73 e2e gate rightly fails as
// console noise. Fonts load on demand via their @font-face; the swap cost
// is negligible for this app and the console stays clean on every surface.
const geist = Geist({subsets:['latin'],variable:'--font-sans',preload:false});
const spaceGrotesk = Space_Grotesk({subsets:['latin'],variable:'--font-display',preload:false});
const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono',preload:false});

export const metadata: Metadata = {
  title: 'jevals Playground',
  description: 'SystemOneRequest validation playground'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes mutates the html class before
    // hydration (attribute="class", defaultTheme="system").
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable, spaceGrotesk.variable, jetbrainsMono.variable)}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AppHeader />
          <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 md:pb-8">{children}</main>
          <MobileNav />
        </ThemeProvider>
      </body>
    </html>
  )
}
