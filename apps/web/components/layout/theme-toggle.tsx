'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import type { Dictionary } from '../../lib/i18n'

// Light/dark toggle for the header utility area (R12/P11: ShadCN theme
// wiring). Cycles light <-> dark and persists through next-themes.
export function ThemeToggle({ dictionary }: { dictionary: Dictionary['theme'] }) {
  const { resolvedTheme, setTheme } = useTheme()
  // R37 (closure finding): with a STORED theme the server tree renders the
  // light icon while the client's first render resolves dark — React 19
  // turns that into a hydration error (and console noise the §73 gate
  // rightly rejects) on every load for such users. The icon stays
  // SSR-stable (Sun) until mounted; the button's accessible name never
  // depended on the theme, so semantics are unchanged.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <button
      aria-label={dictionary.toggle}
      // §16: size-11 (~44px) on mobile; the desktop header keeps size-9.
      // Owner ruling: the toggle is SACRIFICED below lg — at those widths
      // the utility band cannot fit theme + language + help + settings, and
      // theme is the least valuable of the four there (the stored preference
      // still applies; only the switching is desktop-only).
      className="hidden size-11 items-center justify-center rounded-lg text-foreground hover:bg-muted lg:inline-flex sm:size-9"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={dictionary.toggle}
      type="button"
    >
      {isDark ? <Moon aria-hidden="true" size={18} /> : <Sun aria-hidden="true" size={18} />}
    </button>
  )
}
