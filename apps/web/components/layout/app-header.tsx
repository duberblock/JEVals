'use client'

import Link from 'next/link'
import { CircleHelp, Settings as SettingsIcon } from 'lucide-react'

import { useDictionary } from '../../lib/i18n/use-locale'
import { RELEASE_VERSION } from '../../lib/version'
import { LanguageSelector } from './language-selector'
import { MainNav } from './main-nav'
import { ThemeToggle } from './theme-toggle'

// Client component (J1): the header reads the reactive locale through
// useDictionary — the same mechanism as Principal — so switching language in
// the selector updates the whole tree at once (plan 15 never-mix rule).
//
// C4 (FASE C): the prototype's header treatment — the wordmark in the
// display face + '// PLAYGROUND' badge in the label-caps idiom over a
// primary tint, h-14 band with the nav's active border-b-2 on the header
// edge. P34 (FB7): the prototype's decorative avatar is ELIMINATED (owner:
// purely decorative, no value) — supersession R36/C4 registered in ADR-021;
// every other C4 parity element stands. F5: the prototype's KERNEL-style
// status chip is BANNED from the header (never pseudo-OS telemetry) —
// execution context lives in the C5 context bar.
//
// FB5 (R40/P32) PARTIALLY supersedes the R36/C4 no-version ruling: the
// wordmark is now the mixed-case 'JEVals' (the span carries NO uppercase
// class — the real casing must render, never JEVALS) and a REAL release
// version badge — derived from package.json via lib/version.ts, the single
// source — renders after '// PLAYGROUND' in the same badge idiom.
// Invented/pseudo-OS version numbers (the prototype's V10.5) remain BANNED.
export function AppHeader() {
  const { dictionary } = useDictionary()

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/95 px-4 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4">
        <Link className="flex items-center gap-2 text-foreground hover:text-primary" href="/">
          <span className="font-display text-lg font-bold tracking-tight">{dictionary.app.name}</span>
          <span className="border border-border bg-primary/10 px-1 py-0.5 font-mono uppercase text-label-caps text-primary">
            {dictionary.app.badge}
          </span>
          {/* FB5 (P32): REAL release version from package.json (single
              source, lib/version.ts) — same badge idiom, deliberately
              WITHOUT uppercase so 'v1.0.0' keeps its real casing. F11-style
              registered decision: the badge hides below sm (640px) — at 375
              the h-14 band cannot fit three badges + nav + controls, and the
              §16 no-overflow gate wins (26px overflow measured); ≥640 the
              header already carried it green. */}
          <span className="hidden border border-border bg-primary/10 px-1 py-0.5 font-mono text-label-caps text-primary sm:inline">
            v{RELEASE_VERSION}
          </span>
        </Link>
        <MainNav />
        <div className="flex items-center gap-2">
          {/* FB4 (P31): /how-it-works access from the utility zone — OUTSIDE
              MainNav (§3 keeps exactly three canonical sections). Desktop-only
              (md+, mirrors MainNav's breakpoint): the mobile access point is the
              Principal recents empty state per the FB4 ruling. */}
          <Link
            aria-label={dictionary.howItWorks.title}
            className="hidden size-11 items-center justify-center rounded-lg text-foreground hover:bg-muted md:inline-flex sm:size-9"
            href="/how-it-works"
          >
            <CircleHelp aria-hidden="true" className="size-4" size={16} />
          </Link>
          {/* Provider settings — the simple environment configuration (the
              four integration cards with encrypted-at-rest keys). Beside the
              help link in the utility zone, but from lg only: at 768 the
              h-14 band fits exactly ONE utility icon beside nav + controls
              (the §16 sweep gate measures a 1px overflow with two) — the
              screen stays reachable by URL below lg. */}
          <Link
            aria-label={dictionary.settings.headerTitle}
            className="hidden size-11 items-center justify-center rounded-lg text-foreground hover:bg-muted lg:inline-flex sm:size-9"
            data-testid="header-settings-link"
            href="/settings"
          >
            <SettingsIcon aria-hidden="true" className="size-4" size={16} />
          </Link>
          <ThemeToggle dictionary={dictionary.theme} />
          <LanguageSelector />
        </div>
      </div>
    </header>
  )
}
